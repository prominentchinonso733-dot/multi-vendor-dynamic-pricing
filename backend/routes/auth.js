const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

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

module.exports = router;
