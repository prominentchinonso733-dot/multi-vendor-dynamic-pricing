const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["BUYER", "SELLER", "ADMIN"],
      default: "BUYER",
    },

    // Vendor-Specific Details
    vendorDetails: {
      businessName: { type: String },
      tier: { type: String, enum: ["TIER_1", "TIER_2"], default: "TIER_1" }, // $5 vs $10 Tier
      subscriptionStatus: {
        type: String,
        enum: ["ACTIVE", "INACTIVE", "PENDING"],
        default: "INACTIVE",
      },
      paystackSubaccountCode: { type: String }, // For Paystack split payouts
      bankDetails: {
        accountNumber: { type: String },
        bankCode: { type: String },
        accountName: { type: String },
      },
      verificationDocuments: [{ type: String }], // Tier 2 Verification Uploads
      isVerified: { type: Boolean, default: false },
      commissionRate: { type: Number, default: 0.1 }, // Default 10% platform fee
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", UserSchema);
