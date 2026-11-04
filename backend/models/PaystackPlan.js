const mongoose = require("mongoose");

const paystackPlanSchema = new mongoose.Schema(
  {
    tier: {
      type: String,
      enum: ["TIER_1", "TIER_2"],
      required: true,
      unique: true,
    },
    providerCode: { type: String, required: true, unique: true },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, default: "NGN" },
    interval: { type: String, required: true, default: "monthly" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PaystackPlan", paystackPlanSchema);
