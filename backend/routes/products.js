const express = require("express");
const Product = require("../models/Product");
const authenticateToken = require("../middleware/authenticateToken");

const router = express.Router();

router.post("/", authenticateToken, async (req, res) => {
  if (req.user.role !== "SELLER") {
    return res
      .status(403)
      .json({ success: false, message: "Seller role required." });
  }

  const {
    title,
    description,
    category,
    basePrice,
    stock,
    demandScore = 0,
    priceFloor,
    priceCeiling,
    competitorPrice,
  } = req.body || {};

  if (typeof title !== "string" || !title.trim()) {
    return res
      .status(400)
      .json({ success: false, message: "A product title is required." });
  }

  const numericFields = {
    basePrice,
    stock,
    demandScore,
    priceFloor,
    priceCeiling,
  };
  if (
    Object.entries(numericFields).some(
      ([field, value]) =>
        typeof value !== "number" || !Number.isFinite(value),
    )
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Base price, stock, demand score, price floor, and price ceiling must be finite numbers.",
    });
  }
  if (basePrice <= 0 || priceFloor <= 0 || priceCeiling <= 0) {
    return res.status(400).json({
      success: false,
      message: "Base price, price floor, and price ceiling must be positive.",
    });
  }
  if (priceFloor > priceCeiling || stock < 0 || !Number.isInteger(stock)) {
    return res.status(400).json({
      success: false,
      message:
        "Price floor cannot exceed price ceiling, and stock must be a non-negative whole number.",
    });
  }
  if (demandScore < 0 || demandScore > 100) {
    return res.status(400).json({
      success: false,
      message: "Demand score must be between 0 and 100.",
    });
  }
  if (
    competitorPrice !== undefined &&
    competitorPrice !== null &&
    (typeof competitorPrice !== "number" ||
      !Number.isFinite(competitorPrice) ||
      competitorPrice <= 0)
  ) {
    return res.status(400).json({
      success: false,
      message: "Competitor price must be a positive number when provided.",
    });
  }
  if (
    (description !== undefined && typeof description !== "string") ||
    (category !== undefined && typeof category !== "string")
  ) {
    return res.status(400).json({
      success: false,
      message: "Description and category must be text.",
    });
  }

  try {
    const currentPrice = Math.min(
      priceCeiling,
      Math.max(priceFloor, basePrice),
    );
    const product = await Product.create({
      vendor: req.user._id,
      title: title.trim(),
      description: description?.trim() || "",
      category: category?.trim() || "",
      basePrice,
      currentPrice,
      stock,
      demandScore,
      priceFloor,
      priceCeiling,
      competitorPrice: competitorPrice ?? undefined,
    });

    return res.status(201).json({ success: true, product });
  } catch (error) {
    console.error("Vendor product could not be created:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create product.",
    });
  }
});

router.get("/mine", authenticateToken, async (req, res) => {
  if (!["SELLER", "ADMIN"].includes(req.user.role)) {
    return res
      .status(403)
      .json({ success: false, message: "Seller or admin role required." });
  }

  try {
    const filter =
      req.user.role === "ADMIN" ? {} : { vendor: req.user._id };
    const products = await Product.find(filter).sort({ updatedAt: -1 }).lean();
    return res.json({ success: true, products });
  } catch (error) {
    console.error("Vendor products could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load vendor products.",
    });
  }
});

router.get("/", async (_req, res) => {
  try {
    const products = await Product.find()
      .populate("vendor", "name vendorDetails.businessName")
      .sort({ createdAt: -1 })
      .lean();
    return res.json(
      products.map((product) => ({
        ...product,
        id: product._id.toString(),
        name: product.title,
        price: product.currentPrice,
        vendor:
          product.vendor?.vendorDetails?.businessName ||
          product.vendor?.name ||
          "Marketplace seller",
      })),
    );
  } catch (error) {
    console.error("Marketplace products could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load marketplace products.",
    });
  }
});

module.exports = router;
