const express = require("express");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Product = require("../models/Product");
const EscrowContract = require("../models/EscrowContract");
const authenticateToken = require("../middleware/authenticateToken");

const router = express.Router();
router.use(authenticateToken, (req, res, next) => {
  if (req.user.role !== "ADMIN") {
    return res
      .status(403)
      .json({ success: false, message: "Admin role required." });
  }
  return next();
});

router.get("/overview", async (req, res) => {
  const parsePage = (value) => {
    const page = Number(value || 1);
    return Number.isInteger(page) && page > 0 ? page : null;
  };
  const usersPage = parsePage(req.query.usersPage);
  const ordersPage = parsePage(req.query.ordersPage);
  if (!usersPage || !ordersPage) {
    return res.status(400).json({
      success: false,
      message: "Page numbers must be positive whole numbers.",
    });
  }
  const usersRole = req.query.usersRole || "accounts";
  const userFilter =
    usersRole === "vendors"
      ? { role: "SELLER" }
      : usersRole === "riders"
        ? { role: "DELIVERY_PARTNER" }
        : usersRole === "accounts"
          ? { role: { $in: ["BUYER", "SELLER"] } }
          : null;
  if (!userFilter) {
    return res.status(400).json({
      success: false,
      message: "Choose a supported account list.",
    });
  }
  const userPageFilter = { ...userFilter };
  const pageSize = 100;
  try {
    const [
      vendorCount,
      customerCount,
      riderCount,
      productCount,
      orderCount,
      pendingVerificationCount,
      usersTotal,
      ordersTotal,
      users,
      orders,
    ] = await Promise.all([
      User.countDocuments({ role: "SELLER" }),
      User.countDocuments({ role: "BUYER" }),
      User.countDocuments({ role: "DELIVERY_PARTNER" }),
      Product.countDocuments(),
      EscrowContract.countDocuments(),
      User.countDocuments({ "verification.status": "PENDING" }),
      User.countDocuments(userPageFilter),
      EscrowContract.countDocuments(),
      User.find(userPageFilter)
        .select(
          "name email role accountStatus createdAt verification vendorDetails.isVerified",
        )
        .sort({ createdAt: -1 })
        .skip((usersPage - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      EscrowContract.find()
        .populate("deliveryPartnerId", "name email")
        .sort({ createdAt: -1 })
        .skip((ordersPage - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    return res.json({
      success: true,
      summary: {
        vendorCount,
        customerCount,
        riderCount,
        productCount,
        orderCount,
        pendingVerificationCount,
      },
      users,
      orders,
      pagination: {
        pageSize,
        usersPage,
        usersTotal,
        ordersPage,
        ordersTotal,
      },
    });
  } catch (error) {
    console.error("Admin marketplace overview could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load marketplace oversight data.",
    });
  }
});

router.get("/verification/pending", async (_req, res) => {
  try {
    const users = await User.find({ "verification.status": "PENDING" })
      .select("name email role createdAt verification")
      .sort({ "verification.submittedAt": 1 })
      .lean();
    return res.json({ success: true, users });
  } catch (error) {
    console.error("Pending identity reviews could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load pending identity reviews.",
    });
  }
});

router.patch("/users/:userId/status", async (req, res) => {
  const { userId } = req.params;
  const { status } = req.body || {};
  if (!mongoose.isValidObjectId(userId)) {
    return res
      .status(400)
      .json({ success: false, message: "A valid userId is required." });
  }
  if (!["ACTIVE", "SUSPENDED"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Status must be ACTIVE or SUSPENDED.",
    });
  }
  if (String(req.user._id) === userId) {
    return res.status(400).json({
      success: false,
      message: "You cannot suspend your own admin account.",
    });
  }

  try {
    const user = await User.findOneAndUpdate(
      { _id: userId, role: { $ne: "ADMIN" } },
      { $set: { accountStatus: status } },
      { new: true, runValidators: true },
    )
      .select("name email role accountStatus")
      .lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Manageable user account not found.",
      });
    }
    return res.json({ success: true, user });
  } catch (error) {
    console.error("Admin could not update account status:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update account status.",
    });
  }
});

router.patch("/verification/:userId", async (req, res) => {
  const { userId } = req.params;
  const { decision, reviewNote = "", identityChecked } = req.body || {};
  if (!mongoose.isValidObjectId(userId)) {
    return res
      .status(400)
      .json({ success: false, message: "A valid userId is required." });
  }
  if (!["APPROVE", "REJECT"].includes(decision)) {
    return res.status(400).json({
      success: false,
      message: "Decision must be APPROVE or REJECT.",
    });
  }
  if (typeof reviewNote !== "string" || reviewNote.trim().length > 500) {
    return res.status(400).json({
      success: false,
      message: "Review notes must be 500 characters or fewer.",
    });
  }
  if (decision === "APPROVE" && identityChecked !== true) {
    return res.status(400).json({
      success: false,
      message: "Confirm that identity was checked through the approved process.",
    });
  }

  try {
    const status = decision === "APPROVE" ? "VERIFIED" : "REJECTED";
    const tier = decision === "APPROVE" ? "TIER_2" : "TIER_1";
    const user = await User.findOneAndUpdate(
      {
        _id: userId,
        role: { $in: ["BUYER", "SELLER"] },
        accountStatus: { $ne: "SUSPENDED" },
        "verification.status": "PENDING",
      },
      {
        $set: {
          "verification.status": status,
          "verification.tier": tier,
          "verification.reviewedAt": new Date(),
          "verification.reviewedBy": req.user._id,
          "verification.reviewNote": reviewNote.trim(),
          ...(decision === "APPROVE" && {
            "vendorDetails.tier": tier,
            "vendorDetails.isVerified": true,
          }),
          ...(decision === "REJECT" && {
            "vendorDetails.isVerified": false,
          }),
        },
      },
      { new: true, runValidators: true },
    )
      .select("name email role verification")
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Pending verification request not found.",
      });
    }
    return res.json({ success: true, user });
  } catch (error) {
    console.error("Admin could not review identity verification:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to review this verification request.",
    });
  }
});

router.post("/riders", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.trim().length > 120 ||
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof password !== "string" ||
    password.length < 12
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Provide a name, valid email, and a temporary password of at least 12 characters.",
    });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) {
      return res.status(409).json({
        success: false,
        message: "An account already uses this email.",
      });
    }
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: await bcrypt.hash(password, 12),
      role: "DELIVERY_PARTNER",
      accountStatus: "ACTIVE",
    });
    return res.status(201).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
      },
    });
  } catch (error) {
    console.error("Admin could not create delivery partner account:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create delivery partner account.",
    });
  }
});

router.patch("/orders/:orderId/rider", async (req, res) => {
  const { orderId } = req.params;
  const { riderId = null } = req.body || {};
  if (!mongoose.isValidObjectId(orderId)) {
    return res
      .status(400)
      .json({ success: false, message: "A valid orderId is required." });
  }
  if (riderId !== null && !mongoose.isValidObjectId(riderId)) {
    return res
      .status(400)
      .json({ success: false, message: "A valid riderId is required." });
  }

  try {
    if (riderId) {
      const rider = await User.findOne({
        _id: riderId,
        role: "DELIVERY_PARTNER",
        accountStatus: "ACTIVE",
      });
      if (!rider) {
        return res.status(404).json({
          success: false,
          message: "Active delivery partner not found.",
        });
      }
    }
    const order = await EscrowContract.findByIdAndUpdate(
      orderId,
      { $set: { deliveryPartnerId: riderId } },
      { new: true, runValidators: true },
    )
      .populate("deliveryPartnerId", "name email")
      .lean();
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found." });
    }
    return res.json({ success: true, order });
  } catch (error) {
    console.error("Admin could not assign a delivery partner:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update delivery assignment.",
    });
  }
});

module.exports = router;
