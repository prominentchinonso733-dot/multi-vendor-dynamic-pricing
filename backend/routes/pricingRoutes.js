const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Product = require("../models/Product");

const router = express.Router();

const authenticateToken = (req, res, next) => {
  const authorization = req.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res
      .status(401)
      .json({ success: false, message: "Authentication required." });
  }
  if (!process.env.JWT_SECRET) {
    return res
      .status(500)
      .json({ success: false, message: "Authentication is not configured." });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res
      .status(401)
      .json({ success: false, message: "Invalid or expired token." });
  }
};

router.post("/calculate", authenticateToken, async (req, res) => {
  if (!["SELLER", "ADMIN"].includes(req.user.role)) {
    return res
      .status(403)
      .json({ success: false, message: "Seller or admin role required." });
  }

  const { productId, competitorPrice } = req.body || {};
  if (typeof productId !== "string" || !mongoose.isValidObjectId(productId)) {
    return res
      .status(400)
      .json({ success: false, message: "A valid productId is required." });
  }
  if (
    competitorPrice !== undefined &&
    (typeof competitorPrice !== "number" ||
      !Number.isFinite(competitorPrice) ||
      competitorPrice <= 0)
  ) {
    return res.status(400).json({
      success: false,
      message: "competitorPrice must be a positive number when provided.",
    });
  }

  try {
    const product = await Product.findById(productId);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found." });
    }
    if (
      req.user.role !== "ADMIN" &&
      product.vendor.toString() !== req.user.id
    ) {
      return res
        .status(403)
        .json({ success: false, message: "You can only reprice your products." });
    }

    const {
      basePrice,
      priceFloor,
      priceCeiling,
      demandScore,
      stock,
    } = product;
    if (
      ![basePrice, priceFloor, priceCeiling, demandScore, stock].every(
        Number.isFinite,
      ) ||
      basePrice <= 0 ||
      priceFloor <= 0 ||
      priceFloor > priceCeiling ||
      stock < 0
    ) {
      return res.status(422).json({
        success: false,
        message: "Product pricing and inventory values are invalid.",
      });
    }

    const normalizedDemand = Math.min(100, Math.max(0, demandScore));
    const demandMultiplier = 1 + (normalizedDemand - 50) / 500;
    const stockMultiplier =
      stock >= 1 && stock <= 5 ? 1.05 : stock >= 50 ? 0.95 : 1;
    const referencePrice =
      competitorPrice === undefined
        ? basePrice
        : Math.min(basePrice, competitorPrice);
    const calculatedPrice = referencePrice * demandMultiplier * stockMultiplier;
    const roundedPrice = Math.round(calculatedPrice * 100) / 100;
    const currentPrice = Math.min(
      priceCeiling,
      Math.max(priceFloor, roundedPrice),
    );

    product.currentPrice = currentPrice;
    await product.save();

    return res.json({
      success: true,
      productId: product.id,
      basePrice,
      competitorPrice: competitorPrice ?? null,
      demandScore: normalizedDemand,
      stock,
      currentPrice,
    });
  } catch (error) {
    console.error("Dynamic pricing calculation failed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to calculate the product price.",
    });
  }
});

module.exports = router;
