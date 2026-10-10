const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true },
    description: { type: String },
    category: { type: String },
    stock: { type: Number, required: true, default: 0 },

    // Real-Time Dynamic Pricing Controls
    basePrice: { type: Number, required: true },
    currentPrice: { type: Number, required: true },
    priceFloor: { type: Number, required: true }, // Seller minimum limit
    priceCeiling: { type: Number, required: true }, // Seller maximum limit
    competitorPrice: { type: Number },

    demandScore: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Product", ProductSchema);
