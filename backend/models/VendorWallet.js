const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    balance: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, required: true, default: "NGN", immutable: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("VendorWallet", walletSchema);
