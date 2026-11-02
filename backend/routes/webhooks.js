const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const EscrowContract = require("../models/EscrowContract");
const VendorWithdrawal = require("../models/VendorWithdrawal");
const confirmEscrowPayment = require("../services/confirmEscrowPayment");
const { toMinorUnits } = require("../services/financialPolicy");
const {
  getWalletForUpdate,
  restoreAvailable,
} = require("../services/vendorWallet");

const router = express.Router();

const settleTransferWebhook = async (event, transfer) => {
  const reference =
    typeof transfer.reference === "string" ? transfer.reference : "";
  const transferCode =
    typeof transfer.transfer_code === "string" ? transfer.transfer_code : "";
  if (!reference && !transferCode) return;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const withdrawal = await VendorWithdrawal.findOne({
        $or: [
          ...(reference ? [{ reference }] : []),
          ...(transferCode ? [{ transferCode }] : []),
        ],
      }).session(session);
      if (!withdrawal) return;

      if (event === "transfer.success") {
        await VendorWithdrawal.updateOne(
          { _id: withdrawal._id, status: "PROCESSING" },
          {
            $set: {
              status: "COMPLETED",
              transferCode: transferCode || withdrawal.transferCode,
              completedAt: new Date(),
            },
          },
          { session },
        );
        return;
      }

      const allowedStatuses =
        event === "transfer.reversed"
          ? ["PROCESSING", "COMPLETED"]
          : ["PROCESSING"];
      const changed = await VendorWithdrawal.findOneAndUpdate(
        { _id: withdrawal._id, status: { $in: allowedStatuses } },
        {
          $set: {
            status: event === "transfer.reversed" ? "REVERSED" : "FAILED",
            transferCode: transferCode || withdrawal.transferCode,
            failureReason:
              typeof transfer.reason === "string"
                ? transfer.reason.slice(0, 300)
                : event === "transfer.reversed"
                  ? "Paystack reversed the transfer."
                  : "Paystack could not complete the transfer.",
            resolvedAt: new Date(),
          },
        },
        { new: true, session },
      );
      if (!changed) return;

      const wallet = await getWalletForUpdate(withdrawal.vendorId, session);
      restoreAvailable(wallet, toMinorUnits(withdrawal.amount));
      await wallet.save({ session });
    });
  } finally {
    await session.endSession();
  }
};

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

  if (
    ["transfer.success", "transfer.failed", "transfer.reversed"].includes(
      req.body?.event,
    )
  ) {
    try {
      await settleTransferWebhook(req.body.event, req.body.data || {});
      return res.status(200).json({ received: true });
    } catch (error) {
      console.error("Paystack transfer webhook could not be processed:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to process the transfer event.",
      });
    }
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

    const paymentResult = await confirmEscrowPayment(
      contract._id,
      payment.reference,
    );
    if (!paymentResult.contract) {
      return res
        .status(409)
        .json({ success: false, message: "Escrow order could not be locked." });
    }

    return res.status(200).json({
      received: true,
      status: paymentResult.contract.status,
      alreadyProcessed: paymentResult.alreadyProcessed,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
