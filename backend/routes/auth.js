const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const authenticateToken = require("../middleware/authenticateToken");

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
  role: normalizeRole(user.role),
  isVendor: hasVendorAccess(user),
  accountStatus: user.accountStatus || "ACTIVE",
  verification: {
    tier: user.verification?.tier || "TIER_1",
    status: user.verification?.status || "NOT_STARTED",
  },
});

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, businessName } = req.body;
    const normalizedRole = normalizeRole(role || "BUYER");

    if (!["BUYER", "SELLER"].includes(normalizedRole)) {
      return res.status(400).json({ msg: "Role must be BUYER or SELLER." });
    }
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ msg: "Name, email, and password are required." });
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
      vendorDetails:
        normalizedRole === "SELLER"
          ? {
              businessName,
              tier: "TIER_1",
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

router.post("/verification", authenticateToken, async (req, res) => {
  const legalName =
    typeof req.body?.legalName === "string" ? req.body.legalName.trim() : "";
  const documentType = req.body?.documentType;
  const allowedDocumentTypes = [
    "NIN",
    "BVN",
    "DRIVERS_LICENSE",
    "PASSPORT",
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

  try {
    const user = await User.findOne({
      _id: req.user._id,
      role: { $in: ["BUYER", "SELLER"] },
      accountStatus: { $ne: "SUSPENDED" },
      "verification.status": { $nin: ["PENDING", "VERIFIED"] },
    });
    if (!user) {
      return res.status(409).json({
        success: false,
        message:
          "This account already has a pending verification or is verified.",
      });
    }

    user.verification = {
      ...(user.verification?.toObject?.() || user.verification || {}),
      tier: "TIER_1",
      status: "PENDING",
      legalName,
      documentType,
      submittedAt: new Date(),
      reviewedAt: undefined,
      reviewedBy: undefined,
      reviewNote: "",
    };
    await user.save();
    return res.status(202).json({
      success: true,
      message: "Verification request submitted for review.",
      verification: {
        tier: user.verification.tier,
        status: user.verification.status,
        legalName: user.verification.legalName,
        documentType: user.verification.documentType,
        submittedAt: user.verification.submittedAt,
        reviewedAt: null,
        reviewNote: "",
      },
    });
  } catch (error) {
    console.error("Account verification request could not be submitted:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to submit verification request.",
    });
  }
});

router.get("/profile", authenticateToken, async (req, res) => {
  if (req.user.role !== "SELLER") {
    return res
      .status(403)
      .json({ success: false, message: "Seller role required." });
  }

  try {
    const user = await User.findById(req.user._id)
      .select(
        "name email role storeName storeLogo storeBanner storeDescription vendorDetails.businessName vendorDetails.isVendor verification",
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
        "name email role storeName storeLogo storeBanner storeDescription verification",
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
