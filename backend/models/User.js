const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: { type: String, trim: true, maxlength: 30 },
    role: {
      type: String,
      enum: [
        "BUYER",
        "SELLER",
        "seller",
        "VENDOR",
        "vendor",
        "ROLE_SELLER",
        "ROLE_VENDOR",
        "ADMIN",
        "DELIVERY_PARTNER",
      ],
      default: "BUYER",
    },
    accountStatus: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED"],
      default: "ACTIVE",
    },
    vendorLimitRevision: { type: Number, default: 0, select: false },
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
        enum: ["NIN", "BVN", "DRIVERS_LICENSE", "PASSPORT", "VOTER_CARD"],
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
    isFeatured: { type: Boolean, default: false },

    // Vendor-Specific Details
    vendorDetails: {
      businessName: { type: String },
      tier: { type: String, enum: ["TIER_1", "TIER_2"], default: "TIER_1" },
      tier1Verified: { type: Boolean, default: false },
      verificationData: {
        legalName: { type: String, trim: true, maxlength: 120 },
        ninNumber: { type: String, select: false },
        ninLast4: { type: String, select: false },
        bvnNumber: { type: String, select: false },
        bvnLast4: { type: String, select: false },
        cacRegistrationNumber: { type: String, select: false },
        cacLast4: { type: String, select: false },
        ninVerifiedAt: { type: Date },
      },
      verificationDocuments: [
        {
          documentType: {
            type: String,
            enum: ["CAC_DOCUMENT", "BANK_STATEMENT", "GOVERNMENT_ID"],
            required: true,
          },
          contentType: {
            type: String,
            enum: ["application/pdf", "image/jpeg", "image/png"],
            required: true,
          },
          submittedAt: { type: Date, required: true },
        },
      ],
      payoutDetails: {
        bankName: { type: String, trim: true, maxlength: 100 },
        bankCode: { type: String, trim: true, maxlength: 20 },
        accountName: { type: String, trim: true, maxlength: 120 },
        accountNumber: { type: String, select: false },
        accountLast4: { type: String },
        transferRecipientCode: { type: String, select: false },
      },
      subscriptionStatus: {
        type: String,
        enum: ["ACTIVE", "INACTIVE", "PENDING", "PAST_DUE", "CANCELLED"],
        default: "INACTIVE",
      },
      subscriptionCode: { type: String, select: false },
      subscriptionEmailToken: { type: String, select: false },
      subscriptionPlanCode: { type: String, select: false },
      subscriptionPeriodEnd: { type: Date },
      subscriptionLastPaidAt: { type: Date },
      subscriptionFailureCount: { type: Number, default: 0 },
      tierEntryPendingTier: {
        type: String,
        enum: ["TIER_1", "TIER_2"],
      },
      tierEntryPaymentReference: { type: String, select: false },
      tierEntryPaymentAmountMinor: { type: Number, select: false },
      tierEntryPaymentCurrency: { type: String, select: false },
      tierEntryPlanCode: { type: String, select: false },
      tierEntryPaidReference: { type: String, select: false },
      tierEntryPaidAmountMinor: { type: Number, select: false },
      tierEntryPaidAt: { type: Date },
      isVendor: { type: Boolean, default: false },
      paystackSubaccountCode: { type: String }, // For Paystack split payouts
      bankDetails: {
        accountNumber: { type: String },
        bankCode: { type: String },
        accountName: { type: String },
      },
      isVerified: { type: Boolean, default: false },
      commissionRate: { type: Number, default: 0.1 }, // Default 10% platform fee
    },
    riderDetails: {
      governmentIdType: {
        type: String,
        enum: ["NIN", "BVN", "DRIVERS_LICENSE", "PASSPORT", "VOTER_CARD"],
      },
      governmentIdNumber: { type: String, select: false },
      governmentIdLast4: { type: String, select: false },
      emergencyContactName: { type: String, select: false },
      emergencyContactPhone: { type: String, select: false },
      vehicleLicensePlate: { type: String, select: false },
      safetyConsentAt: Date,
      locationPermissionGrantedAt: Date,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", UserSchema);
