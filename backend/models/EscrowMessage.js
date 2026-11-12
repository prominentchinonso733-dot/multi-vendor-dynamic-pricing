const mongoose = require("mongoose");

const escrowMessageSchema = new mongoose.Schema(
  {
    contractId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EscrowContract",
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["BUYER", "SELLER"],
      required: true,
    },
    message: { type: String, trim: true, required: true, maxlength: 2000 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("EscrowMessage", escrowMessageSchema);
