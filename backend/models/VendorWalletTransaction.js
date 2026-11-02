const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    contractId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EscrowContract",
      required: true,
    },
    paymentReference: { type: String, required: true },
    type: {
      type: String,
      enum: ["ESCROW_HOLD", "ESCROW_RELEASE", "ESCROW_REFUND"],
      required: true,
      default: "ESCROW_RELEASE",
    },
    grossAmount: { type: Number, required: true, min: 0 },
    platformFee: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: "NGN" },
    tier: { type: String, enum: ["TIER_1", "TIER_2"], required: true },
    commissionRate: { type: Number, required: true, min: 0, max: 1 },
  },
  { timestamps: true },
);

walletTransactionSchema.index(
  { vendorId: 1, contractId: 1, type: 1 },
  { unique: true },
);

module.exports = mongoose.model(
  "VendorWalletTransaction",
  walletTransactionSchema,
);
