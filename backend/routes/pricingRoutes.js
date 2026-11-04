const express = require("express");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const User = require("../models/User");
const authenticateToken = require("../middleware/authenticateToken");
const { getEligibleVendorFilter } = require("../services/vendorTiers");
const calculateCurrentPrice = require("../services/dynamicPricing");

const router = express.Router();

router.post("/calculate", authenticateToken, async (req, res) => {
  if (!["SELLER", "ADMIN"].includes(req.user.role)) {
    return res
      .status(403)
      .json({ success: false, message: "Seller or admin role required." });
  }
  if (req.user.role === "SELLER") {
    try {
      const eligibleSeller = await User.exists({
        _id: req.user._id,
        role: "SELLER",
        accountStatus: { $ne: "SUSPENDED" },
        ...getEligibleVendorFilter(),
      });
      if (!eligibleSeller) {
        return res.status(403).json({
          success: false,
          code: "TIER1_VERIFICATION_REQUIRED",
          message:
            "Complete Tier 1 bank and identity soft-check verification before changing listing prices.",
        });
      }
    } catch (error) {
      console.error("Seller pricing eligibility could not be checked:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to verify seller pricing eligibility.",
      });
    }
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
      (req.user.role !== "SELLER" ||
        product.vendor.toString() !== req.user.id)
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

    const normalizedDemand = demandScore;
    const referencePrice = basePrice;
    const currentPrice = calculateCurrentPrice({
      basePrice,
      demandScore: normalizedDemand,
      priceFloor,
      priceCeiling,
      stock,
      orderUnitsLast24h:
        product.lastOrderAt &&
        product.lastOrderAt.getTime() > Date.now() - 24 * 60 * 60 * 1000
          ? product.orderUnitsLast24h
          : 0,
    });
    const adjustedDemandScore =
      calculateCurrentPrice.adjustDemandScore?.({
        demandScore: normalizedDemand,
        stock,
        orderUnitsLast24h:
          product.lastOrderAt &&
          product.lastOrderAt.getTime() > Date.now() - 24 * 60 * 60 * 1000
            ? product.orderUnitsLast24h
            : 0,
      }) ?? normalizedDemand;
    const calculatedPrice =
      basePrice * (1 + (adjustedDemandScore - 50) / 100);

    const floorCeilingStatus =
      calculatedPrice <= priceFloor
        ? "FLOOR"
        : calculatedPrice >= priceCeiling
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
    require("../services/realtime").emitProductUpdate(product);

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
      calculatedPrice,
      currentPrice,
      adjustedDemandScore,
      adjustments: {
        competitorPriceApplied:
          competitorPrice !== undefined &&
          competitorPrice !== null &&
          competitorPrice < basePrice,
        demandPercent: adjustedDemandScore - 50,
        stockPercent: adjustedDemandScore - normalizedDemand,
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
