const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["BUYER", "SELLER", "ADMIN", "DELIVERY_PARTNER"],
      default: "BUYER",
    },
    accountStatus: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED"],
      default: "ACTIVE",
    },
    verification: {
      tier: { type: String, enum: ["TIER_1", "TIER_2"], default: "TIER_1" },
      status: {
        type: String,
        enum: ["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"],
        default: "NOT_STARTED",
      },
      legalName: { type: String, trim: true, maxlength: 120 },
      documentType: {
        type: String,
        enum: ["NIN", "BVN", "DRIVERS_LICENSE", "PASSPORT"],
      },
      submittedAt: Date,
      reviewedAt: Date,
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reviewNote: { type: String, trim: true, maxlength: 500 },
    },
    storeName: { type: String, trim: true, maxlength: 100 },
    storeLogo: { type: String, trim: true, maxlength: 2048 },
    storeBanner: { type: String, trim: true, maxlength: 2048 },
    storeDescription: { type: String, trim: true, maxlength: 1000 },

    // Vendor-Specific Details
    vendorDetails: {
      businessName: { type: String },
      tier: { type: String, enum: ["TIER_1", "TIER_2"], default: "TIER_1" },
      subscriptionStatus: {
        type: String,
        enum: ["ACTIVE", "INACTIVE", "PENDING"],
        default: "INACTIVE",
      },
      isVendor: { type: Boolean, default: false },
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
