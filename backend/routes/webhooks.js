const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const EscrowContract = require("../models/EscrowContract");

const router = express.Router();

router.post("/paystack", async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.get("x-paystack-signature");

  if (!secret) {
    return res
      .status(500)
      .json({ success: false, message: "Paystack webhook is not configured." });
  }
  if (
    !Buffer.isBuffer(req.rawBody) ||
    !/^[a-f\d]{128}$/i.test(signature || "")
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Paystack webhook request." });
  }

  const expectedSignature = crypto
    .createHmac("sha512", secret)
    .update(req.rawBody)
    .digest();
  const receivedSignature = Buffer.from(signature, "hex");

  if (
    receivedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid Paystack signature." });
  }

  if (req.body?.event !== "charge.success") {
    return res.status(200).json({ received: true });
  }

  try {
    const payment = req.body.data || {};
    const metadata = payment.metadata || {};
    const orderId = metadata.order_id || metadata.orderId;
    const buyerEmail = String(metadata.buyer_email || metadata.buyerEmail || "")
      .trim()
      .toLowerCase();
    const sellerIds = [
      ...new Set(
        (Array.isArray(metadata.seller_ids)
          ? metadata.seller_ids
          : [metadata.seller_id || metadata.sellerId]
        )
          .filter((id) => mongoose.isValidObjectId(id))
          .map((id) => id.toString()),
      ),
    ];

    if (
      !mongoose.isValidObjectId(orderId) ||
      !buyerEmail ||
      !payment.reference
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Payment metadata is incomplete." });
    }

    const contract = await EscrowContract.findById(orderId);
    if (!contract) {
      return res
        .status(404)
        .json({ success: false, message: "Escrow order not found." });
    }

    if (
      contract.paymentReference !== payment.reference ||
      contract.buyerEmail !== buyerEmail ||
      (contract.sellerIds.length > 0 &&
        (sellerIds.length !== contract.sellerIds.length ||
          !contract.sellerIds.every((id) => sellerIds.includes(id.toString()))))
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Payment metadata does not match the order.",
        });
    }

    if (Number(payment.amount) !== Math.round(contract.totalHoldAmount * 100)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Payment amount does not match the order.",
        });
    }

    if (contract.status === "FUNDS_LOCKED") {
      return res.status(200).json({ received: true, alreadyProcessed: true });
    }
    if (contract.status !== "PAYMENT_PENDING") {
      return res
        .status(409)
        .json({
          success: false,
          message: "Escrow order is not awaiting payment.",
        });
    }

    const updatedContract = await EscrowContract.findOneAndUpdate(
      {
        _id: contract._id,
        paymentReference: payment.reference,
        status: "PAYMENT_PENDING",
      },
      { $set: { status: "FUNDS_LOCKED" } },
      { new: true, runValidators: true },
    );

    if (!updatedContract) {
      const latestContract = await EscrowContract.findById(contract._id);
      if (latestContract?.status === "FUNDS_LOCKED") {
        return res.status(200).json({ received: true, alreadyProcessed: true });
      }
      return res
        .status(409)
        .json({ success: false, message: "Escrow order could not be locked." });
    }

    return res
      .status(200)
      .json({ received: true, status: updatedContract.status });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
