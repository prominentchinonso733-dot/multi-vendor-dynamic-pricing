const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const multer = require("multer");
const User = require("../models/User");
const VerificationDocument = require("../models/VerificationDocument");
const authenticateToken = require("../middleware/authenticateToken");
const { getVendorPolicy } = require("../services/financialPolicy");
const {
  SUPPORTED_CONTENT_TYPES,
  detectContentType,
  encryptDocument,
} = require("../services/verificationDocuments");
const { VENDOR_TIER_PRICES_USD } = require("../services/vendorTiers");

const uploadVerificationDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4, fieldSize: 2048 },
  fileFilter: (_req, file, callback) => {
    if (!SUPPORTED_CONTENT_TYPES.has(file.mimetype)) {
      const error = new Error("Upload a PDF, JPEG, or PNG identity document.");
      error.code = "INVALID_DOCUMENT_TYPE";
      return callback(error);
    }
    return callback(null, true);
  },
}).single("document");

const parseVerificationDocument = (req, res, next) => {
  uploadVerificationDocument(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "Identity documents must be 5 MB or smaller.",
      });
    }
    if (
      error.code === "INVALID_DOCUMENT_TYPE" ||
      error instanceof multer.MulterError
    ) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Identity document upload could not be parsed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to process the identity document upload.",
    });
  });
};

const storeProfileFields = [
  "storeName",
  "storeLogo",
  "storeBanner",
  "storeDescription",
];

const toStoreProfile = (user) => ({
  storeName:
    user.storeName || user.vendorDetails?.businessName || user.name || "",
  storeLogo: user.storeLogo || "",
  storeBanner: user.storeBanner || "",
  storeDescription: user.storeDescription || "",
});

const isValidImageUrl = (value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
};

const normalizeRole = (role) =>
  ({
    ROLE_CUSTOMER: "BUYER",
    ROLE_VENDOR: "SELLER",
    ROLE_ADMIN: "ADMIN",
  })[role] || role;

const hasVendorAccess = (user) => normalizeRole(user.role) === "SELLER";

const issueToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return jwt.sign(
    {
      id: user._id.toString(),
      role: normalizeRole(user.role),
      isVendor: hasVendorAccess(user),
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
};

const toPublicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  ...(user.phone && { phone: user.phone }),
  role: normalizeRole(user.role),
  isVendor: hasVendorAccess(user),
  accountStatus: user.accountStatus || "ACTIVE",
  verification: {
    tier: user.verification?.tier || "TIER_1",
    status: user.verification?.status || "NOT_STARTED",
  },
  ...(hasVendorAccess(user) && {
    vendorTier: user.vendorDetails?.tier || "TIER_1",
    subscriptionStatus: user.vendorDetails?.subscriptionStatus || "INACTIVE",
  }),
});

router.post("/register", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      role,
      businessName,
      vendorTier,
    } = req.body;
    const normalizedRole = normalizeRole(role || "BUYER");

    if (!["BUYER", "SELLER", "DELIVERY_PARTNER"].includes(normalizedRole)) {
      return res
        .status(400)
        .json({ msg: "Role must be BUYER, SELLER, or DELIVERY_PARTNER." });
    }
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ msg: "Name, email, and password are required." });
    }
    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 120 ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== "string" ||
      (normalizedRole === "DELIVERY_PARTNER" && password.length < 8)
    ) {
      return res.status(400).json({
        msg:
          normalizedRole === "DELIVERY_PARTNER"
            ? "Enter a valid name and email, and a password of at least 8 characters."
            : "Enter a valid name, email, and password.",
      });
    }
    if (
      normalizedRole === "DELIVERY_PARTNER" &&
      (typeof phone !== "string" ||
        phone.trim().length < 7 ||
        phone.trim().length > 30)
    ) {
      return res.status(400).json({
        msg: "A valid phone number is required for delivery partner registration.",
      });
    }
    if (
      normalizedRole === "SELLER" &&
      !Object.hasOwn(VENDOR_TIER_PRICES_USD, vendorTier)
    ) {
      return res.status(400).json({
        msg: "Choose Tier 1 or Tier 2 for your vendor account.",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });
    if (user) {
      return res.status(400).json({ msg: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = new User({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role: normalizedRole,
      ...(normalizedRole === "DELIVERY_PARTNER" && { phone: phone.trim() }),
      vendorDetails:
        normalizedRole === "SELLER"
          ? {
              businessName,
              tier: vendorTier,
              subscriptionStatus: "INACTIVE",
            }
          : {},
    });

    await user.save();
    const token = issueToken(user);
    res.status(201).json({
      msg: "User registered successfully",
      token,
      user: toPublicUser(user),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login Route
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({
      email: typeof email === "string" ? email.trim().toLowerCase() : "",
    });

    if (!user) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }
    if (user.accountStatus === "SUSPENDED") {
      return res.status(403).json({ msg: "This account has been suspended." });
    }

    const token = issueToken(user);

    res.json({ token, user: toPublicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/verification", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("verification").lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }
    return res.json({
      success: true,
      verification: {
        tier: user.verification?.tier || "TIER_1",
        status: user.verification?.status || "NOT_STARTED",
        legalName: user.verification?.legalName || "",
        documentType: user.verification?.documentType || "",
        submittedAt: user.verification?.submittedAt || null,
        reviewedAt: user.verification?.reviewedAt || null,
        reviewNote: user.verification?.reviewNote || "",
      },
    });
  } catch (error) {
    console.error("Account verification status could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load verification status.",
    });
  }
});

router.post(
  "/verification",
  authenticateToken,
  parseVerificationDocument,
  async (req, res) => {
    const legalName =
      typeof req.body?.legalName === "string" ? req.body.legalName.trim() : "";
    const documentType = req.body?.documentType;
    const allowedDocumentTypes = [
      "NIN",
      "BVN",
      "DRIVERS_LICENSE",
      "PASSPORT",
      "VOTER_CARD",
    ];
    if (legalName.length < 2 || legalName.length > 120) {
      return res.status(400).json({
        success: false,
        message: "Legal name must be between 2 and 120 characters.",
      });
    }
    if (!allowedDocumentTypes.includes(documentType)) {
      return res.status(400).json({
        success: false,
        message: "Choose a supported identity document type.",
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Upload one PDF, JPEG, or PNG identity document.",
      });
    }
    if (detectContentType(req.file.buffer) !== req.file.mimetype) {
      return res.status(400).json({
        success: false,
        message: "The uploaded file content does not match its file type.",
      });
    }

    try {
      const userId = req.user._id || req.user.id;
      const isVendor = req.user.role === "SELLER";
      if (isVendor) {
        const seller = await User.findById(userId)
          .select("vendorDetails.payoutDetails.bankCode")
          .lean();
        if (!seller?.vendorDetails?.payoutDetails?.bankCode) {
          return res.status(400).json({
            success: false,
            message:
              "Verify and save a payout bank account before submitting Tier 2 review.",
          });
        }
      }
      let encryptedDocument;
      try {
        encryptedDocument = encryptDocument(req.file.buffer, userId);
      } finally {
        req.file.buffer.fill(0);
      }
      const session = await mongoose.startSession();
      let verification;
      try {
        await session.withTransaction(async () => {
          const user = await User.findOne({
            _id: userId,
            role: { $in: ["BUYER", "SELLER"] },
            accountStatus: { $ne: "SUSPENDED" },
            "verification.status": { $nin: ["PENDING", "VERIFIED"] },
          }).session(session);
          if (!user) {
            const error = new Error(
              "This account already has a pending verification or is verified.",
            );
            error.statusCode = 409;
            throw error;
          }

          user.verification = {
            ...(user.verification?.toObject?.() || user.verification || {}),
            tier: isVendor ? "TIER_2" : "TIER_1",
            status: "PENDING",
            legalName,
            documentType,
            submittedAt: new Date(),
            reviewedAt: undefined,
            reviewedBy: undefined,
            reviewNote: "",
          };
          await user.save({ session });
          await VerificationDocument.findOneAndUpdate(
            { userId: user._id },
            { $set: { userId: user._id, ...encryptedDocument } },
            { upsert: true, new: true, runValidators: true, session },
          );
          verification = {
            tier: user.verification.tier,
            status: user.verification.status,
            legalName: user.verification.legalName,
            documentType: user.verification.documentType,
            submittedAt: user.verification.submittedAt,
            reviewedAt: null,
            reviewNote: "",
          };
        });
      } finally {
        await session.endSession();
      }

      return res.status(202).json({
        success: true,
        message: "Verification request submitted for review.",
        verification,
      });
    } catch (error) {
      if (error.code === "DOCUMENT_ENCRYPTION_KEY_INVALID") {
        return res.status(503).json({
          success: false,
          message:
            "Secure identity document uploads are not configured. Contact support.",
        });
      }
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }
      console.error(
        "Account verification request could not be submitted:",
        error,
      );
      return res.status(500).json({
        success: false,
        message: "Unable to submit verification request.",
      });
    }
  },
);

router.get("/profile", authenticateToken, async (req, res) => {
  if (req.user.role !== "SELLER") {
    return res
      .status(403)
      .json({ success: false, message: "Seller role required." });
  }

  try {
    const user = await User.findById(req.user._id)
      .select(
        "name email role storeName storeLogo storeBanner storeDescription vendorDetails.businessName vendorDetails.isVendor vendorDetails.tier vendorDetails.subscriptionStatus vendorDetails.tier1Verified vendorDetails.verificationData.legalName vendorDetails.verificationData.ninLast4 vendorDetails.verificationData.ninVerifiedAt vendorDetails.payoutDetails.bankName vendorDetails.payoutDetails.bankCode vendorDetails.payoutDetails.accountName vendorDetails.payoutDetails.accountLast4 verification",
      )
      .lean();
    if (!user || !hasVendorAccess(user)) {
      return res
        .status(404)
        .json({ success: false, message: "Seller profile not found." });
    }

    return res.json({
      success: true,
      profile: {
        name: user.name,
        email: user.email,
        ...toStoreProfile(user),
        verification: {
          tier: user.verification?.tier || "TIER_1",
          status: user.verification?.status || "NOT_STARTED",
        },
        vendorTier: user.vendorDetails?.tier || "TIER_1",
        subscriptionStatus:
          user.vendorDetails?.subscriptionStatus || "INACTIVE",
        isVerified:
          user.vendorDetails?.tier === "TIER_2" &&
          user.verification?.tier === "TIER_2" &&
          user.verification?.status === "VERIFIED",
        tier1Verified: user.vendorDetails?.tier1Verified === true,
        tier1Verification: {
          legalName: user.vendorDetails?.verificationData?.legalName || "",
          ninLast4: user.vendorDetails?.verificationData?.ninLast4 || "",
          ninVerifiedAt:
            user.vendorDetails?.verificationData?.ninVerifiedAt || null,
        },
        payoutDetails: user.vendorDetails?.payoutDetails?.bankCode
          ? {
              bankName: user.vendorDetails.payoutDetails.bankName || "",
              bankCode: user.vendorDetails.payoutDetails.bankCode || "",
              accountName: user.vendorDetails.payoutDetails.accountName || "",
              accountLast4:
                user.vendorDetails.payoutDetails.accountLast4 || "",
            }
          : null,
        financialPolicy: getVendorPolicy(user),
      },
    });
  } catch (error) {
    console.error("Seller store profile could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load store profile.",
    });
  }
});

router.put("/profile", authenticateToken, async (req, res) => {
  if (req.user.role !== "SELLER") {
    return res
      .status(403)
      .json({ success: false, message: "Seller role required." });
  }

  const updates = {};
  for (const field of storeProfileFields) {
    const value = req.body?.[field];
    if (typeof value !== "string") {
      return res.status(400).json({
        success: false,
        message: `${field} must be a string.`,
      });
    }
    updates[field] = value.trim();
  }

  if (!updates.storeName) {
    return res.status(400).json({
      success: false,
      message: "Store name is required.",
    });
  }
  if (updates.storeLogo.length > 2048 || !isValidImageUrl(updates.storeLogo)) {
    return res.status(400).json({
      success: false,
      message: "Store logo must be a valid HTTP or HTTPS URL.",
    });
  }
  if (
    updates.storeBanner.length > 2048 ||
    !isValidImageUrl(updates.storeBanner)
  ) {
    return res.status(400).json({
      success: false,
      message: "Store banner must be a valid HTTP or HTTPS URL.",
    });
  }
  if (updates.storeName.length > 100) {
    return res
      .status(400)
      .json({ success: false, message: "Store name is too long." });
  }
  if (updates.storeDescription.length > 1000) {
    return res
      .status(400)
      .json({ success: false, message: "Store description is too long." });
  }

  try {
    const user = await User.findOneAndUpdate(
      {
        _id: req.user._id,
        $or: [{ role: "SELLER" }, { "vendorDetails.isVendor": true }],
      },
      { $set: updates },
      { new: true, runValidators: true },
    )
      .select(
      "name email role storeName storeLogo storeBanner storeDescription vendorDetails.tier vendorDetails.subscriptionStatus vendorDetails.tier1Verified vendorDetails.verificationData.legalName vendorDetails.verificationData.ninLast4 vendorDetails.verificationData.ninVerifiedAt vendorDetails.payoutDetails.bankName vendorDetails.payoutDetails.bankCode vendorDetails.payoutDetails.accountName vendorDetails.payoutDetails.accountLast4 verification",
      )
      .lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Seller profile not found." });
    }

    return res.json({
      success: true,
      profile: {
        name: user.name,
        email: user.email,
        ...toStoreProfile(user),
        verification: {
          tier: user.verification?.tier || "TIER_1",
          status: user.verification?.status || "NOT_STARTED",
        },
        vendorTier: user.vendorDetails?.tier || "TIER_1",
        subscriptionStatus:
          user.vendorDetails?.subscriptionStatus || "INACTIVE",
        isVerified:
          user.vendorDetails?.tier === "TIER_2" &&
          user.verification?.tier === "TIER_2" &&
          user.verification?.status === "VERIFIED",
        tier1Verified: user.vendorDetails?.tier1Verified === true,
        tier1Verification: {
          legalName: user.vendorDetails?.verificationData?.legalName || "",
          ninLast4: user.vendorDetails?.verificationData?.ninLast4 || "",
          ninVerifiedAt:
            user.vendorDetails?.verificationData?.ninVerifiedAt || null,
        },
        payoutDetails: user.vendorDetails?.payoutDetails?.bankCode
          ? {
              bankName: user.vendorDetails.payoutDetails.bankName || "",
              bankCode: user.vendorDetails.payoutDetails.bankCode || "",
              accountName: user.vendorDetails.payoutDetails.accountName || "",
              accountLast4:
                user.vendorDetails.payoutDetails.accountLast4 || "",
            }
          : null,
        financialPolicy: getVendorPolicy(user),
      },
    });
  } catch (error) {
    console.error("Seller store profile could not be updated:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to save store settings.",
    });
  }
});

module.exports = router;
