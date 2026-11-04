const mongoose = require("mongoose");

const platformCommissionEntrySchema = new mongoose.Schema(
  {
    contractId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EscrowContract",
      required: true,
      unique: true,
    },
    paymentReference: { type: String, required: true, unique: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: "NGN" },
    source: { type: String, required: true, default: "DEMAND_SURGE" },
    status: {
      type: String,
      enum: ["PENDING", "AVAILABLE", "REVERSED"],
      default: "PENDING",
    },
    settledAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "PlatformCommissionEntry",
  platformCommissionEntrySchema,
);
