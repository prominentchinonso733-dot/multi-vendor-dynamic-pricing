const express = require("express");
const { randomUUID } = require("crypto");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const Product = require("../models/Product");
const User = require("../models/User");
const authenticateToken = require("../middleware/authenticateToken");
const mongoose = require("mongoose");
const calculateCurrentPrice = require("../services/dynamicPricing");
const {
  getEligibleVendorFilter,
  getVendorTier,
  isTier2VerifiedVendor,
  isVendorEligibleToSell,
} = require("../services/vendorTiers");
const {
  emitFeaturedUpdate,
  emitProductUpdate,
} = require("../services/realtime");

const router = express.Router();
const marketplaceVendorSelect =
  "name storeName role accountStatus isFeatured vendorDetails.businessName vendorDetails.tier vendorDetails.subscriptionStatus vendorDetails.tier1Verified verification.tier verification.status";
const publishedProductFilter = {
  isApproved: true,
  status: "active",
  isPublished: true,
};

const serializeMarketplaceProduct = (product) => ({
  ...product,
  id: product._id.toString(),
  name: product.title,
  currentPrice: calculateCurrentPrice(product),
  price: calculateCurrentPrice(product),
  vendorId: product.vendor?._id?.toString(),
  vendor:
    product.vendor?.storeName ||
    product.vendor?.vendorDetails?.businessName ||
    product.vendor?.name ||
    "Marketplace seller",
  vendorTier: getVendorTier(product.vendor),
  isVerifiedVendor: isTier2VerifiedVendor(product.vendor),
  isFeatured: product.isFeatured === true,
  vendorFeatured: product.vendor?.isFeatured === true,
});

const findKeywordMatches = async (query) => {
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  const escapedTerms = terms.map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const products = await Product.find({
    ...publishedProductFilter,
    $or: escapedTerms.flatMap((term) => [
      { title: { $regex: term, $options: "i" } },
      { description: { $regex: term, $options: "i" } },
      { category: { $regex: term, $options: "i" } },
    ]),
  })
    .populate({ path: "vendor", select: marketplaceVendorSelect })
    .sort({ createdAt: -1 })
    .limit(250)
    .lean();

  return products
    .map((product) => {
      const title = String(product.title || "").toLowerCase();
      const description = String(product.description || "").toLowerCase();
      const category = String(product.category || "").toLowerCase();
      const score = terms.reduce(
        (total, term) =>
          total +
          (title.includes(term) ? 3 : 0) +
          (category.includes(term) ? 2 : 0) +
          (description.includes(term) ? 1 : 0),
        0,
      );
      return { product, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map(({ product }) => serializeMarketplaceProduct(product));
};

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

const canManageProducts = (user) => ["SELLER", "ADMIN"].includes(user.role);

const requireProductManager = (req, res, next) => {
  if (!canManageProducts(req.user)) {
    return res
      .status(403)
      .json({ success: false, message: "Seller role required." });
  }
  return next();
};

const requireTier1Verification = async (req, res, next) => {
  if (req.user.role === "ADMIN") return next();
  try {
    const seller = await User.findOne({
      _id: req.user._id,
      role: "SELLER",
      accountStatus: { $ne: "SUSPENDED" },
      ...getEligibleVendorFilter(),
    })
      .select("_id")
      .lean();
    if (!seller) {
      return res.status(403).json({
        success: false,
        code: "TIER1_VERIFICATION_REQUIRED",
        message:
          "Complete Tier 1 bank and identity soft-check verification before listing products.",
      });
    }
    return next();
  } catch (error) {
    console.error("Seller listing eligibility could not be checked:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to verify seller listing eligibility.",
    });
  }
};

const canManageProduct = (user, product) =>
  user.role === "ADMIN" ||
  (user.role === "SELLER" && product.vendor.toString() === user.id);

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
  requireTier1Verification,
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
      const currentPrice = calculateCurrentPrice({
        basePrice,
        demandScore,
        priceFloor,
        priceCeiling,
        stock,
      });

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

      emitProductUpdate(product);
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
      product.currentPrice = calculateCurrentPrice(product);
      await product.save();
      emitProductUpdate(product);

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
    const filter = req.user.role === "ADMIN" ? {} : { vendor: req.user._id };
    const products = await Product.find(filter).sort({ updatedAt: -1 }).lean();
    const pricedProducts = products.map((product) => ({
      ...product,
      currentPrice: calculateCurrentPrice(product),
    }));
    return res.json({ success: true, products: pricedProducts });
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
        "name email role accountStatus storeName storeLogo storeBanner storeDescription isFeatured vendorDetails.businessName vendorDetails.tier vendorDetails.subscriptionStatus vendorDetails.tier1Verified verification.tier verification.status createdAt",
      )
      .lean();
    if (
      !vendor ||
      vendor.role !== "SELLER" ||
      vendor.accountStatus === "SUSPENDED" ||
      !isVendorEligibleToSell(vendor)
    ) {
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
        tier: getVendorTier(vendor),
        isVerified: isTier2VerifiedVendor(vendor),
        isFeatured: vendor.isFeatured === true,
        isTier1Verified: vendor.vendorDetails?.tier1Verified === true,
        memberSince: vendor.createdAt,
      },
      products: products.map((product) => ({
        ...product,
        id: product._id.toString(),
        name: product.title,
        currentPrice: calculateCurrentPrice(product),
        price: calculateCurrentPrice(product),
        vendorId: vendor._id.toString(),
        vendor:
          vendor.storeName || vendor.vendorDetails?.businessName || vendor.name,
        vendorTier: getVendorTier(vendor),
        isVerifiedVendor: isTier2VerifiedVendor(vendor),
        isFeatured: product.isFeatured === true,
        vendorFeatured: vendor.isFeatured === true,
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
    const products = await Product.find(publishedProductFilter)
      .populate({
        path: "vendor",
        select: marketplaceVendorSelect,
      })
      .sort({ createdAt: -1 })
      .lean();
    return res.json(products.map(serializeMarketplaceProduct));
  } catch (error) {
    console.error("Marketplace products could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load marketplace products.",
    });
  }
});

router.get("/featured", async (_req, res) => {
  try {
    const products = await Product.find()
      .populate({
        path: "vendor",
        select:
          "name storeName role accountStatus isFeatured vendorDetails.businessName vendorDetails.tier vendorDetails.subscriptionStatus vendorDetails.tier1Verified verification.tier verification.status",
        match: {
          role: "SELLER",
          accountStatus: { $ne: "SUSPENDED" },
          ...getEligibleVendorFilter(),
        },
      })
      .sort({ updatedAt: -1 })
      .limit(250)
      .lean();
    const featuredProducts = products
      .filter(
        (product) =>
          product.vendor &&
          (product.isFeatured === true || product.vendor.isFeatured === true),
      )
      .slice(0, 12)
      .map((product) => ({
        ...product,
        id: product._id.toString(),
        name: product.title,
        currentPrice: calculateCurrentPrice(product),
        price: calculateCurrentPrice(product),
        vendorId: product.vendor._id.toString(),
        vendor:
          product.vendor.storeName ||
          product.vendor.vendorDetails?.businessName ||
          product.vendor.name,
        vendorTier: getVendorTier(product.vendor),
        isVerifiedVendor: isTier2VerifiedVendor(product.vendor),
        isFeatured: true,
        vendorFeatured: product.vendor.isFeatured === true,
      }));
    return res.json({ success: true, products: featuredProducts });
  } catch (error) {
    console.error("Featured marketplace products could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load featured products.",
    });
  }
});

router.post("/search/semantic", async (req, res) => {
  const query =
    typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query || query.length > 300) {
    return res.status(400).json({
      success: false,
      message: "Search query must contain between 1 and 300 characters.",
    });
  }
  try {
    const {
      isGeminiCredentialError,
      semanticProductSearch,
    } = require("../services/gemini");
    const products = await semanticProductSearch(query);
    return res.json({ success: true, products });
  } catch (error) {
    const { isGeminiCredentialError } = require("../services/gemini");
    if (isGeminiCredentialError(error)) {
      try {
        const products = await findKeywordMatches(query);
        return res.json({ success: true, products, searchMode: "keyword" });
      } catch (fallbackError) {
        console.error("Keyword product search failed:", fallbackError.message);
        return res.status(500).json({
          success: false,
          message: "Unable to complete product search.",
        });
      }
    }
    console.error("Semantic product search failed:", error.message);
    return res.status(502).json({
      success: false,
      message: "Unable to complete semantic product search.",
    });
  }
});

module.exports = router;
