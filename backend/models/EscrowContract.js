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
    completedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("EscrowContract", escrowContractSchema);
