const mongoose = require("mongoose");

const vendorWithdrawalSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reference: { type: String, required: true, unique: true },
    transferCode: { type: String, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, required: true, default: "NGN" },
    bankName: { type: String, required: true },
    accountLast4: { type: String, required: true },
    status: {
      type: String,
      enum: ["PROCESSING", "COMPLETED", "FAILED", "REVERSED"],
      required: true,
      default: "PROCESSING",
    },
    failureReason: { type: String, maxlength: 300 },
    completedAt: Date,
    resolvedAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model("VendorWithdrawal", vendorWithdrawalSchema);
