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

const authenticateOptionalToken = (req, res, next) => {
  if (!req.headers.authorization) return next();
  return authenticateToken(req, res, next);
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== "ADMIN") {
    return res
      .status(403)
      .json({ success: false, message: "Admin role required." });
  }
  return next();
};

const toVendorOrder = (contract, sellerId) => {
  const order = contract.toObject();
  return {
    _id: order._id,
    paymentReference: order.paymentReference,
    status: order.status,
    createdAt: order.createdAt,
    items: (order.items || [])
      .filter(
        (item) =>
          String(item.vendorId || item.sellerId || "") === sellerId.toString(),
      )
      .map(({ name, quantity, vendor, vendorId }) => ({
        name,
        quantity,
        vendor,
        vendorId,
      })),
    fulfillmentStatuses: (order.fulfillmentStatuses || [])
      .filter((entry) => entry.sellerId.toString() === sellerId.toString())
      .map(({ sellerId: fulfillmentSellerId, status, updatedAt }) => ({
        sellerId: fulfillmentSellerId,
        status,
        updatedAt,
      })),
  };
};

// POST /api/escrow/lock-funds
router.post("/lock-funds", authenticateOptionalToken, async (req, res) => {
  try {
    const { buyerId, items, subtotal, isKycVerified } = req.body;
    if (
      req.user?.role === "BUYER" &&
      buyerId !== (req.user._id || req.user.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "You can only create an order for your own account.",
      });
    }
    if (req.user && !["BUYER", "ADMIN"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Buyer role required to create an order.",
      });
    }
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
      fulfillmentStatuses: sellerIds.map((sellerId) => ({
        sellerId,
        status: "PENDING",
      })),
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

// GET /api/escrow/vendor/orders
router.get("/vendor/orders", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SELLER") {
      return res
        .status(403)
        .json({ success: false, message: "Vendor role required." });
    }

    const sellerId = req.user._id || req.user.id;
    if (!mongoose.isValidObjectId(sellerId)) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid vendor account." });
    }

    const contracts = await EscrowContract.find({
      sellerIds: sellerId,
      status: { $in: ["LOCKED", "FUNDS_LOCKED"] },
    }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      contracts: contracts.map((contract) => toVendorOrder(contract, sellerId)),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/escrow/:contractId/vendor-status
router.patch(
  "/:contractId/vendor-status",
  authenticateToken,
  async (req, res) => {
    try {
      if (req.user.role !== "SELLER") {
        return res
          .status(403)
          .json({ success: false, message: "Vendor role required." });
      }

      const { contractId } = req.params;
      const { status } = req.body;
      const sellerId = req.user._id || req.user.id;

      if (!mongoose.isValidObjectId(contractId)) {
        return res.status(400).json({
          success: false,
          message: "A valid contractId is required.",
        });
      }
      if (!mongoose.isValidObjectId(sellerId)) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid vendor account." });
      }
      if (!["PENDING", "PROCESSING", "SHIPPED", "DELIVERED"].includes(status)) {
        return res.status(400).json({
          success: false,
          message:
            "Status must be PENDING, PROCESSING, SHIPPED, or DELIVERED.",
        });
      }

      const contract = await EscrowContract.findOne({
        _id: contractId,
        sellerIds: sellerId,
        status: { $in: ["LOCKED", "FUNDS_LOCKED"] },
      });
      if (!contract) {
        return res.status(404).json({
          success: false,
          message: "Active order not found for this vendor.",
        });
      }

      let fulfillment = contract.fulfillmentStatuses.find(
        (entry) => entry.sellerId.toString() === sellerId.toString(),
      );
      if (!fulfillment) {
        contract.fulfillmentStatuses.push({ sellerId, status });
        fulfillment = contract.fulfillmentStatuses.at(-1);
      } else {
        fulfillment.status = status;
        fulfillment.updatedAt = new Date();
      }

      await contract.save();
      return res.json({
        success: true,
        message: "Order fulfillment status updated.",
        contract: toVendorOrder(contract, sellerId),
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },
);

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

    const currentContract = await EscrowContract.findById(contractId);
    if (
      !currentContract ||
      !["LOCKED", "FUNDS_LOCKED"].includes(currentContract.status)
    ) {
      return res.status(404).json({
        success: false,
        message: "Locked escrow contract not found.",
      });
    }
    if (
      currentContract.fulfillmentStatuses.length > 0 &&
      currentContract.sellerIds.some((sellerId) => {
        const fulfillment = currentContract.fulfillmentStatuses.find(
          (entry) => entry.sellerId.toString() === sellerId.toString(),
        );
        return fulfillment?.status !== "DELIVERED";
      })
    ) {
      return res.status(409).json({
        success: false,
        message: "All vendors must mark their items delivered before release.",
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
router.get("/active", authenticateOptionalToken, async (req, res) => {
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
    if (req.user?.role === "BUYER") {
      const authenticatedBuyerId = req.user._id || req.user.id;
      if (buyerId && buyerId !== authenticatedBuyerId) {
        return res.status(403).json({
          success: false,
          message: "You can only view your own orders.",
        });
      }
      filter.buyerId = authenticatedBuyerId;
    } else if (req.user && req.user.role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Buyer role required.",
      });
    } else if (buyerId) {
      filter.buyerId = buyerId;
    }

    const contracts = await EscrowContract.find(filter).sort({ createdAt: -1 });

    return res.json({ success: true, contracts });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/escrow/completed
router.get("/completed", authenticateOptionalToken, async (req, res) => {
  try {
    const { buyerId } = req.query;
    const isAdmin = req.user?.role === "ADMIN";

    if (buyerId && !isAdmin && !mongoose.isValidObjectId(buyerId)) {
      return res.status(400).json({
        success: false,
        message: "A valid buyerId is required.",
      });
    }

    if (req.user?.role === "BUYER") {
      const authenticatedBuyerId = req.user._id || req.user.id;
      if (buyerId && buyerId !== authenticatedBuyerId) {
        return res.status(403).json({
          success: false,
          message: "You can only view your own orders.",
        });
      }
    } else if (req.user && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Buyer role required.",
      });
    }

    const filter = {
      status: {
        $in: [/^RELEASED$/i, /^COMPLETED$/i, /^REFUNDED$/i, /^CLOSED$/i],
      },
    };
    if (req.user?.role === "BUYER") {
      filter.buyerId = req.user._id || req.user.id;
    } else if (buyerId && !isAdmin) {
      filter.buyerId = buyerId;
    }

    const contracts = await EscrowContract.find(filter).sort({
      completedAt: -1,
      updatedAt: -1,
      createdAt: -1,
    });

    return res.json({ success: true, contracts });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
