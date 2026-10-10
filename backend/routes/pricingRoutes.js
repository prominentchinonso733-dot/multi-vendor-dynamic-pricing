const express = require("express");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const authenticateToken = require("../middleware/authenticateToken");

const router = express.Router();

router.post("/calculate", authenticateToken, async (req, res) => {
  if (!["SELLER", "ADMIN"].includes(req.user.role)) {
    return res
      .status(403)
      .json({ success: false, message: "Seller or admin role required." });
  }

  const {
    productId,
    competitorPrice,
    basePrice: requestedBasePrice,
    demandScore: requestedDemandScore,
    stock: requestedStock,
    priceFloor: requestedPriceFloor,
    priceCeiling: requestedPriceCeiling,
  } = req.body || {};
  if (typeof productId !== "string" || !mongoose.isValidObjectId(productId)) {
    return res
      .status(400)
      .json({ success: false, message: "A valid productId is required." });
  }
  const optionalNumbers = {
    competitorPrice,
    basePrice: requestedBasePrice,
    demandScore: requestedDemandScore,
    stock: requestedStock,
    priceFloor: requestedPriceFloor,
    priceCeiling: requestedPriceCeiling,
  };
  const invalidNumber = Object.entries(optionalNumbers).find(
    ([key, value]) =>
      value !== undefined &&
      value !== null &&
      (typeof value !== "number" || !Number.isFinite(value)),
  );
  if (invalidNumber) {
    return res.status(400).json({
      success: false,
      message: `${invalidNumber[0]} must be a finite number.`,
    });
  }
  if (
    competitorPrice !== undefined &&
    competitorPrice !== null &&
    competitorPrice <= 0
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
        .json({
          success: false,
          message: "You can only reprice your products.",
        });
    }

    const basePrice = requestedBasePrice ?? product.basePrice;
    const priceFloor = requestedPriceFloor ?? product.priceFloor;
    const priceCeiling = requestedPriceCeiling ?? product.priceCeiling;
    const demandScore = requestedDemandScore ?? product.demandScore;
    const stock = requestedStock ?? product.stock;
    if (
      ![basePrice, priceFloor, priceCeiling, demandScore, stock].every(
        Number.isFinite,
      ) ||
      basePrice <= 0 ||
      priceFloor <= 0 ||
      priceCeiling <= 0 ||
      priceFloor > priceCeiling ||
      demandScore < 0 ||
      demandScore > 100 ||
      stock < 0 ||
      !Number.isInteger(stock)
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
      competitorPrice === undefined || competitorPrice === null
        ? basePrice
        : Math.min(basePrice, competitorPrice);
    const demandAdjustmentPercent = (normalizedDemand - 50) / 5;
    const stockAdjustmentPercent =
      stock >= 1 && stock <= 5 ? 5 : stock >= 50 ? -5 : 0;
    const calculatedPrice = referencePrice * demandMultiplier * stockMultiplier;
    const roundedPrice = Math.round(calculatedPrice * 100) / 100;
    const currentPrice = Math.min(
      priceCeiling,
      Math.max(priceFloor, roundedPrice),
    );

    const floorCeilingStatus =
      roundedPrice <= priceFloor
        ? "FLOOR"
        : roundedPrice >= priceCeiling
          ? "CEILING"
          : "WITHIN_RANGE";

    product.basePrice = basePrice;
    product.demandScore = normalizedDemand;
    product.stock = stock;
    product.priceFloor = priceFloor;
    product.priceCeiling = priceCeiling;
    product.competitorPrice = competitorPrice ?? null;
    product.currentPrice = currentPrice;
    await product.save();

    return res.json({
      success: true,
      productId: product.id,
      basePrice,
      competitorPrice: competitorPrice ?? null,
      demandScore: normalizedDemand,
      stock,
      priceFloor,
      priceCeiling,
      referencePrice,
      calculatedPrice: roundedPrice,
      currentPrice,
      adjustments: {
        competitorPriceApplied:
          competitorPrice !== undefined &&
          competitorPrice !== null &&
          competitorPrice < basePrice,
        demandPercent: demandAdjustmentPercent,
        stockPercent: stockAdjustmentPercent,
      },
      floorCeilingStatus,
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
