const express = require("express");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Product = require("../models/Product");
const EscrowContract = require("../models/EscrowContract");
const VerificationDocument = require("../models/VerificationDocument");
const authenticateToken = require("../middleware/authenticateToken");
const { decryptDocument } = require("../services/verificationDocuments");

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
    const documents = await VerificationDocument.find({
      userId: { $in: users.map((user) => user._id) },
    })
      .select("userId")
      .lean();
    const usersWithDocument = new Set(
      documents.map((document) => document.userId.toString()),
    );
    return res.json({
      success: true,
      users: users.map((user) => ({
        ...user,
        verification: {
          ...user.verification,
          documentAvailable: usersWithDocument.has(user._id.toString()),
        },
      })),
    });
  } catch (error) {
    console.error("Pending identity reviews could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load pending identity reviews.",
    });
  }
});

router.get("/verification/:userId/document", async (req, res) => {
  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId)) {
    return res
      .status(400)
      .json({ success: false, message: "A valid userId is required." });
  }

  try {
    const user = await User.findOne({
      _id: userId,
      accountStatus: { $ne: "SUSPENDED" },
      "verification.status": "PENDING",
    })
      .select("_id")
      .lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Pending identity document not found.",
      });
    }

    const document = await VerificationDocument.findOne({ userId });
    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Pending identity document not found.",
      });
    }

    let content;
    try {
      content = decryptDocument(document, userId);
    } catch (error) {
      if (error.code === "DOCUMENT_ENCRYPTION_KEY_INVALID") {
        return res.status(503).json({
          success: false,
          message: "Secure identity document access is not configured.",
        });
      }
      throw error;
    }
    const extension = {
      "application/pdf": "pdf",
      "image/jpeg": "jpg",
      "image/png": "png",
    }[document.contentType];
    if (!extension) {
      return res.status(500).json({
        success: false,
        message: "The stored identity document has an unsupported file type.",
      });
    }
    document.lastAccessedAt = new Date();
    document.lastAccessedBy = req.user._id;
    await document.save();
    res.set({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="verification-document.${extension}"`,
      "Content-Type": document.contentType,
      "X-Content-Type-Options": "nosniff",
    });
    return res.send(content);
  } catch (error) {
    console.error("Admin could not retrieve an identity document:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve the identity document.",
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
    const session = await mongoose.startSession();
    let user;
    try {
      await session.withTransaction(async () => {
        if (
          decision === "APPROVE" &&
          !(await VerificationDocument.exists({ userId }).session(session))
        ) {
          const error = new Error(
            "A securely uploaded identity document is required for approval.",
          );
          error.statusCode = 409;
          throw error;
        }

        user = await User.findOneAndUpdate(
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
                "vendorDetails.commissionRate": 0.05,
              }),
              ...(decision === "REJECT" && {
                "vendorDetails.tier": "TIER_1",
                "vendorDetails.isVerified": false,
                "vendorDetails.commissionRate": 0.1,
              }),
            },
          },
          { new: true, runValidators: true, session },
        )
          .select("name email role verification")
          .lean();
        if (!user) {
          const error = new Error("Pending verification request not found.");
          error.statusCode = 404;
          throw error;
        }
        await VerificationDocument.deleteOne({ userId }, { session });
      });
    } finally {
      await session.endSession();
    }
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Pending verification request not found.",
      });
    }
    return res.json({ success: true, user });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
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
    const order = await EscrowContract.findOne({
      _id: orderId,
      status: { $in: ["FUNDS_LOCKED", "LOCKED"] },
      deliveryStatus: "PENDING",
    });
    if (!order) {
      return res.status(409).json({
        success: false,
        message: "Only active, not-yet-picked-up orders can be assigned.",
      });
    }
    order.deliveryPartnerId = riderId;
    order.deliveryUpdatedAt = new Date();
    await order.save();
    const populatedOrder = await EscrowContract.findById(order._id)
      .populate("deliveryPartnerId", "name email")
      .lean();
    return res.json({ success: true, order: populatedOrder });
  } catch (error) {
    console.error("Admin could not assign a delivery partner:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update delivery assignment.",
    });
  }
});

module.exports = router;
