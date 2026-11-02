const mongoose = require("mongoose");

const escrowContractSchema = new mongoose.Schema(
  {
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    items: [
      {
        productId: String,
        name: String,
        price: Number,
        quantity: Number,
        vendor: String,
        vendorId: String,
        lineTotal: Number,
        platformFee: Number,
        commissionRate: Number,
        vendorTier: String,
        vendorNetAmount: Number,
      },
    ],
    subtotal: {
      type: Number,
      required: true,
    },
    vaultFee: {
      type: Number,
      required: true, // 2.5% fee
    },
    totalHoldAmount: {
      type: Number,
      required: true,
    },
    currency: { type: String, default: "NGN", required: true },
    vendorPayouts: [
      {
        vendorId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        grossAmount: { type: Number, required: true, min: 0 },
        platformFee: { type: Number, required: true, min: 0 },
        netAmount: { type: Number, required: true, min: 0 },
        tier: { type: String, enum: ["TIER_1", "TIER_2"], required: true },
        commissionRate: { type: Number, required: true, min: 0, max: 1 },
      },
    ],
    buyerEmail: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
    },
    sellerIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    deliveryPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    deliveryStatus: {
      type: String,
      enum: ["PENDING", "PICKED_UP", "IN_TRANSIT", "DELIVERED"],
      default: "PENDING",
    },
    deliveryUpdatedAt: { type: Date },
    receiptFinalizedAt: { type: Date },
    receipt: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    fulfillmentStatuses: [
      {
        sellerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        status: {
          type: String,
          enum: ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED"],
          default: "PENDING",
        },
        updatedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    status: {
      type: String,
      enum: [
        "PAYMENT_PENDING",
        "LOCKED",
        "FUNDS_LOCKED",
        "DISPATCHED",
        "RELEASED",
        "COMPLETED",
        "REFUNDED",
        "CLOSED",
        "DISPUTED",
        "IN_DISPUTE",
      ],
      default: "FUNDS_LOCKED",
    },
    disputeReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    paymentReference: {
      type: String,
      required: true,
      unique: true,
    },
    paymentExpiresAt: { type: Date },
    disputeEvents: [
      {
        reason: { type: String, trim: true, maxlength: 500 },
        raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        raisedAt: { type: Date, default: Date.now },
      },
    ],
    completedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("EscrowContract", escrowContractSchema);
