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

const issueToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return jwt.sign(
    { id: user._id.toString(), role: normalizeRole(user.role) },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
};

const toPublicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: normalizeRole(user.role),
});

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, businessName, tier } = req.body;
    const normalizedRole = normalizeRole(role || "BUYER");

    if (!["BUYER", "SELLER"].includes(normalizedRole)) {
      return res.status(400).json({ msg: "Role must be BUYER or SELLER." });
    }
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ msg: "Name, email, and password are required." });
    }

    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ msg: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = new User({
      name,
      email,
      password: hashedPassword,
      role: normalizedRole,
      vendorDetails:
        normalizedRole === "SELLER"
          ? {
              businessName,
              tier: tier || "TIER_1",
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
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }

    const token = issueToken(user);

    res.json({ token, user: toPublicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
        "name email role storeName storeLogo storeBanner storeDescription vendorDetails.businessName",
      )
      .lean();
    if (!user || user.role !== "SELLER") {
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
      { _id: req.user._id, role: "SELLER" },
      { $set: updates },
      { new: true, runValidators: true },
    )
      .select("name email role storeName storeLogo storeBanner storeDescription")
      .lean();
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Seller profile not found." });
    }

    return res.json({
      success: true,
      profile: { name: user.name, email: user.email, ...toStoreProfile(user) },
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
