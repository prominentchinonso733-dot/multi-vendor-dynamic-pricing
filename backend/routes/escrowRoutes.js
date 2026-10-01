const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const https = require("https");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const EscrowContract = require("../models/EscrowContract");

const verifyPaystackTransaction = (reference) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: "api.paystack.co",
        path: `/transaction/verify/${encodeURIComponent(reference)}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              statusCode: response.statusCode,
              payload: JSON.parse(body),
            });
          } catch {
            reject(new Error("Paystack returned an invalid response."));
          }
        });
      },
    );

    request.on("error", reject);
    request.end();
  });

const authenticateToken = (req, res, next) => {
  const authorization = req.headers.authorization;
  const [scheme, token] = authorization ? authorization.split(" ") : [];

  if (scheme !== "Bearer" || !token) {
    return res
      .status(401)
      .json({ success: false, message: "Authentication required." });
  }
  if (!process.env.JWT_SECRET) {
    return res
      .status(500)
      .json({ success: false, message: "Authentication is not configured." });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res
      .status(401)
      .json({ success: false, message: "Invalid or expired token." });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== "ADMIN") {
    return res
      .status(403)
      .json({ success: false, message: "Admin role required." });
  }
  return next();
};

// POST /api/escrow/lock-funds
router.post("/lock-funds", async (req, res) => {
  try {
    const { buyerId, items, subtotal, isKycVerified } = req.body;
    const buyerEmail =
      typeof req.body.buyerEmail === "string"
        ? req.body.buyerEmail.trim().toLowerCase()
        : "";

    // Server-side KYC Guardrail check
    if (!isKycVerified) {
      return res.status(403).json({
        success: false,
        message: "KYC Verification required to initiate escrow contract.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      return res.status(400).json({
        success: false,
        message: "A valid buyerEmail is required for payment.",
      });
    }

    const sellerIds = [
      ...new Set(
        [
          ...(Array.isArray(req.body.sellerIds) ? req.body.sellerIds : []),
          ...(Array.isArray(items)
            ? items.flatMap((item) => [
                item.sellerId,
                item.vendorId,
                item.vendor,
              ])
            : []),
        ]
          .filter((id) => mongoose.isValidObjectId(id))
          .map((id) => id.toString()),
      ),
    ];

    // Recalculate precision fee server-side to prevent tampering
    const calculatedFee = Math.round(subtotal * 0.025);
    const totalHoldAmount = subtotal + calculatedFee;

    const newContract = new EscrowContract({
      buyerId,
      items,
      subtotal,
      vaultFee: calculatedFee,
      totalHoldAmount,
      buyerEmail,
      sellerIds,
      status: "PAYMENT_PENDING",
      paymentReference: `ESCROW_${crypto.randomUUID()}`,
    });

    await newContract.save();

    res.status(201).json({
      success: true,
      message: "Funds successfully locked in escrow vault.",
      contract: newContract,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/escrow/verify
router.post("/verify", async (req, res) => {
  const reference =
    typeof req.body.reference === "string" ? req.body.reference.trim() : "";

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(500).json({
      success: false,
      message: "Paystack verification is not configured.",
    });
  }
  if (!reference) {
    return res.status(400).json({
      success: false,
      message: "A payment reference is required.",
    });
  }

  try {
    const contract = await EscrowContract.findOne({
      paymentReference: reference,
    });
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Escrow order not found for this payment reference.",
      });
    }

    if (contract.status === "FUNDS_LOCKED") {
      return res.json({ success: true, contract, alreadyVerified: true });
    }
    if (contract.status !== "PAYMENT_PENDING") {
      return res.status(409).json({
        success: false,
        message: "Escrow order is not awaiting payment.",
      });
    }

    const verification = await verifyPaystackTransaction(reference);
    const payment = verification.payload?.data;
    if (
      verification.statusCode !== 200 ||
      !verification.payload?.status ||
      payment?.status !== "success"
    ) {
      return res.status(402).json({
        success: false,
        message:
          verification.payload?.message ||
          "Paystack payment is not successful.",
      });
    }

    if (
      payment.reference !== contract.paymentReference ||
      String(payment.customer?.email || "")
        .trim()
        .toLowerCase() !== contract.buyerEmail ||
      Number(payment.amount) !== Math.round(contract.totalHoldAmount * 100)
    ) {
      return res.status(400).json({
        success: false,
        message: "Paystack payment does not match the escrow order.",
      });
    }

    const updatedContract = await EscrowContract.findOneAndUpdate(
      { _id: contract._id, status: "PAYMENT_PENDING" },
      { $set: { status: "FUNDS_LOCKED" } },
      { new: true, runValidators: true },
    );

    return res.json({
      success: true,
      contract:
        updatedContract || (await EscrowContract.findById(contract._id)),
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: "Unable to verify the Paystack transaction.",
      error: error.message,
    });
  }
});

// POST /api/escrow/release-funds
router.post("/release-funds", async (req, res) => {
  try {
    const { contractId } = req.body;

    if (!mongoose.isValidObjectId(contractId)) {
      return res.status(400).json({
        success: false,
        message: "A valid contractId is required.",
      });
    }

    const contract = await EscrowContract.findOneAndUpdate(
      { _id: contractId, status: { $in: ["LOCKED", "FUNDS_LOCKED"] } },
      { $set: { status: "RELEASED", completedAt: new Date() } },
      { new: true, runValidators: true },
    );

    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Locked escrow contract not found.",
      });
    }

    return res.json({
      success: true,
      message: "Escrow funds released.",
      contract,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/escrow/dispute
router.post("/dispute", async (req, res) => {
  try {
    const { contractId } = req.body;
    const disputeReason =
      typeof req.body.disputeReason === "string"
        ? req.body.disputeReason.trim()
        : "";

    if (!mongoose.isValidObjectId(contractId)) {
      return res.status(400).json({
        success: false,
        message: "A valid contractId is required.",
      });
    }

    if (!disputeReason || disputeReason.length > 500) {
      return res.status(400).json({
        success: false,
        message: "A dispute reason of 1 to 500 characters is required.",
      });
    }

    const contract = await EscrowContract.findOneAndUpdate(
      { _id: contractId, status: { $in: ["LOCKED", "FUNDS_LOCKED"] } },
      { $set: { status: "IN_DISPUTE", disputeReason } },
      { new: true, runValidators: true },
    );

    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Locked escrow contract not found.",
      });
    }

    return res.json({
      success: true,
      message: "Escrow contract marked as in dispute.",
      contract,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/escrow/resolve-dispute
router.post(
  "/resolve-dispute",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { contractId, decision } = req.body;

      if (!mongoose.isValidObjectId(contractId)) {
        return res.status(400).json({
          success: false,
          message: "A valid contractId is required.",
        });
      }

      if (!["RELEASE", "REFUND"].includes(decision)) {
        return res.status(400).json({
          success: false,
          message: "Decision must be RELEASE or REFUND.",
        });
      }

      const status = decision === "RELEASE" ? "RELEASED" : "REFUNDED";
      const contract = await EscrowContract.findOneAndUpdate(
        { _id: contractId, status: "IN_DISPUTE" },
        { $set: { status, completedAt: new Date() } },
        { new: true, runValidators: true },
      );

      if (!contract) {
        return res.status(404).json({
          success: false,
          message: "Disputed escrow contract not found.",
        });
      }

      return res.json({
        success: true,
        message: `Dispute resolved: contract ${status.toLowerCase()}.`,
        contract,
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },
);

// GET /api/escrow/active
router.get("/active", async (req, res) => {
  try {
    const { buyerId } = req.query;

    if (buyerId && !mongoose.isValidObjectId(buyerId)) {
      return res.status(400).json({
        success: false,
        message: "A valid buyerId is required.",
      });
    }

    const filter = {
      status: { $in: ["LOCKED", "FUNDS_LOCKED", "IN_DISPUTE"] },
    };
    if (buyerId) filter.buyerId = buyerId;

    const contracts = await EscrowContract.find(filter).sort({ createdAt: -1 });

    return res.json({ success: true, contracts });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/escrow/completed
router.get("/completed", async (req, res) => {
  try {
    const { buyerId } = req.query;

    if (buyerId && !mongoose.isValidObjectId(buyerId)) {
      return res.status(400).json({
        success: false,
        message: "A valid buyerId is required.",
      });
    }

    const filter = {
      status: { $in: ["RELEASED", "REFUNDED"] },
    };
    if (buyerId) filter.buyerId = buyerId;

    const contracts = await EscrowContract.find(filter).sort({
      completedAt: -1,
      updatedAt: -1,
    });

    return res.json({ success: true, contracts });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
