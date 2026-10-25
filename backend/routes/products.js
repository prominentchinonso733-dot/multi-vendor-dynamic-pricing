const express = require("express");
const { randomUUID } = require("crypto");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const Product = require("../models/Product");
const User = require("../models/User");
const authenticateToken = require("../middleware/authenticateToken");
const mongoose = require("mongoose");

const router = express.Router();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const cloudinaryStorage = new CloudinaryStorage({
  cloudinary,
  params: async () => {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      const error = new Error("Cloudinary is not configured.");
      error.code = "CLOUDINARY_CONFIG_MISSING";
      throw error;
    }

    return {
      folder: "products",
      resource_type: "image",
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
      public_id: randomUUID(),
    };
  },
});
const uploadProductImage = multer({
  storage: cloudinaryStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      const error = new Error("Upload a JPEG, PNG, or WebP image.");
      error.code = "INVALID_IMAGE_TYPE";
      return callback(error);
    }
    return callback(null, true);
  },
}).single("image");

const removeCloudinaryImage = async (publicId) => {
  if (!publicId) return;

  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
    });
    if (!["ok", "not found"].includes(result.result)) {
      console.error("Uploaded product image could not be removed:", result);
    }
  } catch (error) {
    console.error("Uploaded product image could not be removed:", error);
  }
};

const parseProductUpload = (req, res, next) => {
  uploadProductImage(req, res, (error) => {
    if (!error) {
      if (req.file) {
        res.once("finish", () => {
          if (![200, 201].includes(res.statusCode)) {
            void removeCloudinaryImage(req.file.filename);
          }
        });
      }
      return next();
    }

    if (error.code === "CLOUDINARY_CONFIG_MISSING") {
      return res.status(503).json({
        success: false,
        message: "Product image uploads are not configured.",
      });
    }
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "Product images must be 5 MB or smaller.",
      });
    }
    if (
      error.code === "INVALID_IMAGE_TYPE" ||
      error instanceof multer.MulterError
    ) {
      return res.status(400).json({ success: false, message: error.message });
    }

    console.error("Product image could not be uploaded to Cloudinary:", error);
    return res.status(502).json({
      success: false,
      message: "Product image could not be uploaded.",
    });
  });
};

const canManageProducts = (user) =>
  ["SELLER", "ADMIN"].includes(user.role) || user.isVendor === true;

const requireProductManager = (req, res, next) => {
  if (!canManageProducts(req.user)) {
    return res
      .status(403)
      .json({ success: false, message: "Seller role required." });
  }
  return next();
};

const canManageProduct = (user, product) =>
  user.role === "ADMIN" || product.vendor.toString() === user.id;

const loadManagedProduct = async (req, res, next) => {
  const { productId } = req.params;
  if (!mongoose.isValidObjectId(productId)) {
    return res
      .status(400)
      .json({ success: false, message: "A valid productId is required." });
  }

  try {
    const product = await Product.findById(productId);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found." });
    }
    if (!canManageProduct(req.user, product)) {
      return res.status(403).json({
        success: false,
        message: "You can only manage your own products.",
      });
    }

    req.product = product;
    return next();
  } catch (error) {
    console.error("Vendor product could not be loaded for management:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load product.",
    });
  }
};

router.post(
  "/",
  authenticateToken,
  requireProductManager,
  parseProductUpload,
  async (req, res) => {
  const toNumber = (value) =>
    typeof value === "string" && value.trim() ? Number(value) : value;
  const { title, description, category } = req.body || {};
  const competitorPrice = toNumber(req.body?.competitorPrice);
  const basePrice = toNumber(req.body?.basePrice);
  const stock = toNumber(req.body?.stock);
  const demandScore = toNumber(req.body?.demandScore ?? 0);
  const priceFloor = toNumber(req.body?.priceFloor);
  const priceCeiling = toNumber(req.body?.priceCeiling);

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
      ([field, value]) => typeof value !== "number" || !Number.isFinite(value),
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
      imageUrl: req.file?.path,
      imagePublicId: req.file?.filename,
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
  },
);

router.patch(
  "/:productId",
  authenticateToken,
  requireProductManager,
  loadManagedProduct,
  parseProductUpload,
  async (req, res) => {
    const { title, description, category } = req.body || {};
    if (
      (title !== undefined &&
        (typeof title !== "string" || !title.trim() || title.length > 160)) ||
      (description !== undefined &&
        (typeof description !== "string" || description.length > 2000)) ||
      (category !== undefined &&
        (typeof category !== "string" || category.length > 80))
    ) {
      return res.status(400).json({
        success: false,
        message: "Product title, description, or category is invalid.",
      });
    }
    if (
      title === undefined &&
      description === undefined &&
      category === undefined &&
      !req.file
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide product details or a replacement image.",
      });
    }

    try {
      const product = req.product;
      const oldImagePublicId = product.imagePublicId;
      if (title !== undefined) product.title = title.trim();
      if (description !== undefined) product.description = description.trim();
      if (category !== undefined) product.category = category.trim();
      if (req.file) {
        product.imageUrl = req.file.path;
        product.imagePublicId = req.file.filename;
        product.image = undefined;
      }
      await product.save();

      if (req.file && oldImagePublicId) {
        await removeCloudinaryImage(oldImagePublicId);
      }
      return res.json({ success: true, product });
    } catch (error) {
      console.error("Vendor product could not be updated:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to update product.",
      });
    }
  },
);

router.delete(
  "/:productId",
  authenticateToken,
  requireProductManager,
  loadManagedProduct,
  async (req, res) => {
    try {
      const product = req.product;
      await product.deleteOne();
      await removeCloudinaryImage(product.imagePublicId);
      return res.json({ success: true, productId: product.id });
    } catch (error) {
      console.error("Vendor product could not be deleted:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to delete product.",
      });
    }
  },
);

router.get("/mine", authenticateToken, async (req, res) => {
  if (!canManageProducts(req.user)) {
    return res
      .status(403)
      .json({ success: false, message: "Seller or admin role required." });
  }

  try {
    const filter =
      req.user.role === "ADMIN" && req.user.isVendor !== true
        ? {}
        : { vendor: req.user._id };
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

router.get("/store/:vendorId", async (req, res) => {
  const { vendorId } = req.params;
  if (!mongoose.isValidObjectId(vendorId)) {
    return res
      .status(400)
      .json({ success: false, message: "A valid vendorId is required." });
  }

  try {
    const vendor = await User.findById(vendorId)
      .select(
        "name email role storeName storeLogo storeBanner storeDescription vendorDetails.businessName vendorDetails.tier vendorDetails.isVerified createdAt",
      )
      .lean();
    if (!vendor || !["SELLER", "ADMIN"].includes(vendor.role)) {
      return res
        .status(404)
        .json({ success: false, message: "Vendor store not found." });
    }

    const products = await Product.find({ vendor: vendor._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      vendor: {
        id: vendor._id.toString(),
        name: vendor.name,
        email: vendor.email,
        storeName:
          vendor.storeName || vendor.vendorDetails?.businessName || vendor.name,
        storeLogo: vendor.storeLogo || "",
        storeBanner: vendor.storeBanner || "",
        storeDescription: vendor.storeDescription || "",
        tier: vendor.vendorDetails?.tier || null,
        isVerified: Boolean(vendor.vendorDetails?.isVerified),
        memberSince: vendor.createdAt,
      },
      products: products.map((product) => ({
        ...product,
        id: product._id.toString(),
        name: product.title,
        price: product.currentPrice,
        vendorId: vendor._id.toString(),
        vendor:
          vendor.storeName || vendor.vendorDetails?.businessName || vendor.name,
      })),
    });
  } catch (error) {
    console.error("Vendor storefront could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load vendor store.",
    });
  }
});

router.get("/", async (_req, res) => {
  try {
    const products = await Product.find()
      .populate("vendor", "name storeName vendorDetails.businessName")
      .sort({ createdAt: -1 })
      .lean();
    return res.json(
      products.map((product) => ({
        ...product,
        id: product._id.toString(),
        name: product.title,
        price: product.currentPrice,
        vendorId: product.vendor?._id?.toString(),
        vendor:
          product.vendor?.storeName ||
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
