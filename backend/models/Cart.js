const mongoose = require("mongoose");

const CartSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        vendor: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        quantity: { type: Number, default: 1 },
        priceAtAddition: { type: Number },
      },
    ],
  },
  { timestamps: true },
);

module.exports = mongoose.model("Cart", CartSchema);
