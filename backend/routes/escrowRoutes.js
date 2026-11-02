const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const https = require("https");
const mongoose = require("mongoose");
const EscrowContract = require("../models/EscrowContract");
const Product = require("../models/Product");
const User = require("../models/User");
const VendorWallet = require("../models/VendorWallet");
const VendorWalletTransaction = require("../models/VendorWalletTransaction");
const VendorWithdrawal = require("../models/VendorWithdrawal");
const authenticateToken = require("../middleware/authenticateToken");
const confirmEscrowPayment = require("../services/confirmEscrowPayment");
const calculateCurrentPrice = require("../services/dynamicPricing");
const isValidDeliveryProof = require("../services/deliveryProof");
const { getEligibleVendorFilter } = require("../services/vendorTiers");
const {
  creditPending,
  getWalletForUpdate,
  refundEscrow,
  releaseEscrow,
} = require("../services/vendorWallet");
const {
  BUYER_ESCROW_FEE_RATE,
  CURRENCY,
  fromMinorUnits,
  getVendorPolicy,
  toMinorUnits,
} = require("../services/financialPolicy");

const RIDER_DELIVERY_FEE = 1500;
const MAX_DELIVERY_PROOF_SIZE = 1024 * 1024;
const deliveryProofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DELIVERY_PROOF_SIZE, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      const error = new Error("Upload a JPEG, PNG, or WebP delivery photo.");
      error.code = "INVALID_DELIVERY_PROOF_TYPE";
      return callback(error);
    }
    return callback(null, true);
  },
}).single("proof");

const parseDeliveryProof = (req, res, next) => {
  deliveryProofUpload(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "Delivery photos must be 1 MB or smaller.",
      });
    }
    if (
      error.code === "INVALID_DELIVERY_PROOF_TYPE" ||
      error instanceof multer.MulterError
    ) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Delivery proof upload could not be processed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to process the delivery proof upload.",
    });
  });
};

const committedStatuses = [
  "FUNDS_LOCKED",
  "LOCKED",
  "DISPATCHED",
  "IN_DISPUTE",
  "RELEASED",
  "COMPLETED",
];

const getDailyVendorVolume = async (sellerId, dayStart, now, session) => {
  const contracts = await EscrowContract.find({
    sellerIds: sellerId,
    createdAt: { $gte: dayStart },
    $or: [
      { status: { $in: committedStatuses } },
      {
        status: "PAYMENT_PENDING",
        paymentExpiresAt: { $gt: now },
      },
    ],
  })
    .select("items")
    .session(session)
    .lean();

  return contracts.reduce(
    (total, contract) =>
      total +
      (contract.items || []).reduce(
        (sum, item) =>
          String(item.vendorId || item.sellerId || "") ===
          sellerId.toString()
            ? sum +
              toMinorUnits(
                item.lineTotal ??
                  Number(item.price || 0) * Number(item.quantity || 0),
              )
            : sum,
        0,
      ),
    0,
  );
};

const createReceipt = (contract, finalizedAt, status = "RELEASED") => ({
  receiptNumber: contract.paymentReference,
  currency: contract.currency || CURRENCY,
  paymentReference: contract.paymentReference,
  escrowStatus: status,
  finalizedAt,
  items: contract.items.map((item) => ({
    productId: item.productId,
    name: item.name,
    vendor: item.vendor,
    vendorId: item.vendorId || item.sellerId,
    quantity: item.quantity,
    unitPrice: item.price,
    lineTotal: item.lineTotal ?? item.price * item.quantity,
    vendorTier: item.vendorTier || "TIER_1",
    commissionRate: item.commissionRate ?? 0.1,
    platformFee:
      status === "RELEASED" ? item.platformFee ?? 0 : 0,
    vendorNetAmount:
      status === "RELEASED"
        ? item.vendorNetAmount ??
          (item.lineTotal ?? item.price * item.quantity) -
            (item.platformFee ?? 0)
        : 0,
  })),
  subtotal: contract.subtotal,
  escrowFee: contract.vaultFee,
  totalPaid: contract.totalHoldAmount,
  totalRefunded: status === "REFUNDED" ? contract.totalHoldAmount : 0,
  vendorPayouts: (contract.vendorPayouts || []).map((payout) => ({
    vendorId: payout.vendorId,
    vendor:
      contract.items.find(
        (item) =>
          String(item.vendorId || item.sellerId || "") ===
          payout.vendorId.toString(),
      )?.vendor || "Vendor",
    grossAmount: payout.grossAmount,
    platformFee: status === "RELEASED" ? payout.platformFee : 0,
    netAmount: status === "RELEASED" ? payout.netAmount : 0,
    tier: payout.tier,
    commissionRate: payout.commissionRate,
  })),
});

const createLegacyVendorPayouts = async (contract, session) => {
  const sellerIds = [
    ...new Set(
      contract.items
        .map((item) => String(item.vendorId || item.sellerId || ""))
        .filter((id) => mongoose.isValidObjectId(id)),
    ),
  ];
  const sellers = await User.find({ _id: { $in: sellerIds }, role: "SELLER" })
    .select("verification.tier verification.status vendorDetails.tier")
    .session(session)
    .lean();
  const sellersById = new Map(
    sellers.map((seller) => [seller._id.toString(), seller]),
  );
  const payouts = new Map();

  for (const item of contract.items) {
    const sellerId = String(item.vendorId || item.sellerId || "");
    const seller = sellersById.get(sellerId);
    if (!seller) {
      throw new Error("Cannot settle this order because a vendor account is unavailable.");
    }
    const policy = getVendorPolicy(seller);
    const grossMinor = toMinorUnits(
      item.lineTotal ?? Number(item.price || 0) * Number(item.quantity || 0),
    );
    const feeMinor = Math.round(grossMinor * policy.commissionRate);
    const payout = payouts.get(sellerId) || {
      grossMinor: 0,
      feeMinor: 0,
      policy,
    };
    payout.grossMinor += grossMinor;
    payout.feeMinor += feeMinor;
    payouts.set(sellerId, payout);
    item.lineTotal = fromMinorUnits(grossMinor);
    item.platformFee = fromMinorUnits(feeMinor);
    item.commissionRate = policy.commissionRate;
    item.vendorTier = policy.tier;
    item.vendorNetAmount = fromMinorUnits(grossMinor - feeMinor);
  }

  contract.vendorPayouts = [...payouts].map(([vendorId, payout]) => ({
    vendorId,
    grossAmount: fromMinorUnits(payout.grossMinor),
    platformFee: fromMinorUnits(payout.feeMinor),
    netAmount: fromMinorUnits(payout.grossMinor - payout.feeMinor),
    tier: payout.policy.tier,
    commissionRate: payout.policy.commissionRate,
  }));
};

const releaseEscrowToWallets = async (
  contractId,
  filter = {},
  allowedStatuses = ["LOCKED", "FUNDS_LOCKED"],
  contractUpdates = {},
) => {
  const session = await mongoose.startSession();
  let releasedContract;

  try {
    await session.withTransaction(async () => {
      const contract = await EscrowContract.findOneAndUpdate(
        {
          _id: contractId,
          status: { $in: allowedStatuses },
          ...filter,
        },
        {
          $set: {
            status: "RELEASED",
            completedAt: new Date(),
            ...contractUpdates,
          },
        },
        { new: true, session, runValidators: true },
      );
      if (!contract) return;

      if (!contract.vendorPayouts?.length && contract.items.length) {
        await createLegacyVendorPayouts(contract, session);
      }

      for (const payout of contract.vendorPayouts || []) {
        const holdTransaction = await VendorWalletTransaction.findOne({
          vendorId: payout.vendorId,
          contractId: contract._id,
          type: "ESCROW_HOLD",
        })
          .session(session)
          .lean();
        await VendorWalletTransaction.create(
          [
            {
              vendorId: payout.vendorId,
              contractId: contract._id,
              paymentReference: contract.paymentReference,
              type: "ESCROW_RELEASE",
              grossAmount: payout.grossAmount,
              platformFee: payout.platformFee,
              amount: payout.netAmount,
              currency: contract.currency || CURRENCY,
              tier: payout.tier,
              commissionRate: payout.commissionRate,
            },
          ],
          { session },
        );
        const wallet = await getWalletForUpdate(payout.vendorId, session);
        const payoutMinor = toMinorUnits(payout.netAmount);
        releaseEscrow(wallet, payoutMinor, Boolean(holdTransaction));
        await wallet.save({ session });
      }

      const finalizedAt = new Date();
      contract.receiptFinalizedAt = finalizedAt;
      contract.receipt = createReceipt(contract, finalizedAt);
      await contract.save({ session });
      releasedContract = contract;
    });
  } finally {
    await session.endSession();
  }

  return releasedContract || null;
};

const finalizeRefundReceipt = async (contractId) => {
  const session = await mongoose.startSession();
  let refundedContract;
  try {
    await session.withTransaction(async () => {
      const contract = await EscrowContract.findOne({
        _id: contractId,
        status: "IN_DISPUTE",
      }).session(session);
      if (!contract) return;

      for (const payout of contract.vendorPayouts || []) {
        const holdTransaction = await VendorWalletTransaction.findOne({
          vendorId: payout.vendorId,
          contractId: contract._id,
          type: "ESCROW_HOLD",
        })
          .session(session)
          .lean();
        if (!holdTransaction) continue;

        await VendorWalletTransaction.create(
          [
            {
              vendorId: payout.vendorId,
              contractId: contract._id,
              paymentReference: contract.paymentReference,
              type: "ESCROW_REFUND",
              grossAmount: payout.grossAmount,
              platformFee: payout.platformFee,
              amount: payout.netAmount,
              currency: contract.currency || CURRENCY,
              tier: payout.tier,
              commissionRate: payout.commissionRate,
            },
          ],
          { session },
        );
        const wallet = await getWalletForUpdate(payout.vendorId, session);
        refundEscrow(wallet, toMinorUnits(payout.netAmount));
        await wallet.save({ session });
      }

      const finalizedAt = new Date();
      contract.status = "REFUNDED";
      contract.completedAt = finalizedAt;
      contract.receiptFinalizedAt = finalizedAt;
      contract.receipt = createReceipt(contract, finalizedAt, "REFUNDED");
      await contract.save({ session });
      refundedContract = contract;
    });
  } finally {
    await session.endSession();
  }
  return refundedContract || null;
};

const verifyPaystackTransaction = (reference) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: "api.paystack.co",
        path: `/transaction/verify/${encodeURIComponent(reference)}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              statusCode: response.statusCode,
              payload: JSON.parse(body),
            });
          } catch {
            reject(new Error("Paystack returned an invalid response."));
          }
        });
      },
    );

    request.on("error", reject);
    request.end();
  });

const authenticateOptionalToken = (req, res, next) => {
  if (!req.headers.authorization) return next();
  return authenticateToken(req, res, next);
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== "ADMIN") {
    return res
      .status(403)
      .json({ success: false, message: "Admin role required." });
  }
  return next();
};

const toVendorOrder = (contract, sellerId) => {
  const order = contract.toObject();
  return {
    _id: order._id,
    paymentReference: order.paymentReference,
    status: order.status,
    deliveryStatus: order.deliveryStatus,
    createdAt: order.createdAt,
    items: (order.items || [])
      .filter(
        (item) =>
          String(item.vendorId || item.sellerId || "") === sellerId.toString(),
      )
      .map(({
        name,
        price,
        quantity,
        vendor,
        vendorId,
        lineTotal,
        platformFee,
        vendorNetAmount,
        vendorTier,
        commissionRate,
      }) => ({
        name,
        price,
        quantity,
        vendor,
        vendorId,
        lineTotal,
        platformFee,
        vendorNetAmount,
        vendorTier,
        commissionRate,
      })),
    fulfillmentStatuses: (order.fulfillmentStatuses || [])
      .filter((entry) => entry.sellerId.toString() === sellerId.toString())
      .map(({ sellerId: fulfillmentSellerId, status, updatedAt }) => ({
        sellerId: fulfillmentSellerId,
        status,
        updatedAt,
      })),
    vendorPayout: (order.vendorPayouts || []).find(
      (payout) => payout.vendorId.toString() === sellerId.toString(),
    ),
  };
};

// POST /api/escrow/lock-funds
router.post("/lock-funds", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "BUYER") {
      return res.status(403).json({
        success: false,
        message: "Buyer role required to create an order.",
      });
    }
    const authenticatedBuyerId = req.user._id || req.user.id;
    if (!mongoose.isValidObjectId(authenticatedBuyerId)) {
      return res.status(403).json({
        success: false,
        message: "A valid buyer account is required.",
      });
    }

    const buyer = await User.findById(authenticatedBuyerId)
      .select("name email phone accountStatus")
      .lean();
    if (!buyer || buyer.accountStatus === "SUSPENDED") {
      return res.status(403).json({
        success: false,
        message: "An active buyer account is required to place an order.",
      });
    }
    const deliveryAddress =
      typeof req.body?.deliveryAddress === "string"
        ? req.body.deliveryAddress.trim()
        : "";
    const customerPhone =
      typeof req.body?.customerPhone === "string"
        ? req.body.customerPhone.trim()
        : buyer.phone || "";
    if (
      deliveryAddress.length < 5 ||
      deliveryAddress.length > 500 ||
      customerPhone.length < 7 ||
      customerPhone.length > 30
    ) {
      return res.status(400).json({
        success: false,
        message:
          "A delivery address and valid customer phone number are required.",
      });
    }

    const requestedItems = req.body?.items;
    if (
      !Array.isArray(requestedItems) ||
      requestedItems.length === 0 ||
      requestedItems.length > 50
    ) {
      return res.status(400).json({
        success: false,
        message: "An order must contain between 1 and 50 product lines.",
      });
    }

    const quantities = new Map();
    for (const item of requestedItems) {
      const productId = String(item?.productId || item?.id || "");
      const quantity = Number(item?.quantity);
      if (!mongoose.isValidObjectId(productId) || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({
          success: false,
          message: "Each order line requires a valid product and positive whole-number quantity.",
        });
      }
      quantities.set(
        productId,
        (quantities.get(productId) || 0) + quantity,
      );
    }

    const products = await Product.find({
      _id: { $in: [...quantities.keys()] },
    }).lean();
    if (products.length !== quantities.size) {
      return res.status(400).json({
        success: false,
        message: "One or more selected products are no longer available.",
      });
    }

    const sellers = await User.find({
      _id: { $in: [...new Set(products.map((product) => product.vendor.toString()))] },
      role: "SELLER",
      accountStatus: { $ne: "SUSPENDED" },
      ...getEligibleVendorFilter(),
    })
      .select(
        "name email role accountStatus verification storeName vendorDetails.businessName vendorDetails.tier",
      )
      .lean();
    const sellersById = new Map(sellers.map((seller) => [seller._id.toString(), seller]));
    if (
      products.some((product) => !sellersById.has(product.vendor.toString()))
    ) {
      return res.status(409).json({
        success: false,
        message: "A seller for one or more products is not currently active.",
      });
    }

    const vendorTotals = new Map();
    const orderItems = products.map((product) => {
      const quantity = quantities.get(product._id.toString());
      if (!Number.isInteger(product.stock) || product.stock < quantity) {
        throw Object.assign(new Error(`${product.title} does not have enough stock.`), {
          statusCode: 409,
        });
      }
      const unitPriceMinor = toMinorUnits(calculateCurrentPrice(product));
      if (unitPriceMinor < 1) {
        throw Object.assign(new Error(`${product.title} has an invalid price.`), {
          statusCode: 409,
        });
      }
      const sellerId = product.vendor.toString();
      const seller = sellersById.get(sellerId);
      const policy = getVendorPolicy(seller);
      const lineTotalMinor = unitPriceMinor * quantity;
      const commissionMinor = Math.round(
        lineTotalMinor * policy.commissionRate,
      );
      const vendorTotal = vendorTotals.get(sellerId) || {
        grossMinor: 0,
        feeMinor: 0,
        policy,
      };
      vendorTotal.grossMinor += lineTotalMinor;
      vendorTotal.feeMinor += commissionMinor;
      vendorTotals.set(sellerId, vendorTotal);

      return {
        productId: product._id.toString(),
        name: product.title,
        price: fromMinorUnits(unitPriceMinor),
        quantity,
        vendor:
          seller.storeName ||
          seller.vendorDetails?.businessName ||
          seller.name,
        vendorId: sellerId,
        lineTotal: fromMinorUnits(lineTotalMinor),
        platformFee: fromMinorUnits(commissionMinor),
        commissionRate: policy.commissionRate,
        vendorTier: policy.tier,
        vendorNetAmount: fromMinorUnits(lineTotalMinor - commissionMinor),
      };
    });

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const vendorPayouts = [];
    const subtotalMinor = orderItems.reduce(
      (sum, item) => sum + toMinorUnits(item.lineTotal),
      0,
    );
    const escrowFeeMinor = Math.round(subtotalMinor * BUYER_ESCROW_FEE_RATE);
    const totalHoldMinor = subtotalMinor + escrowFeeMinor;
    const session = await mongoose.startSession();
    let newContract;
    try {
      await session.withTransaction(async () => {
        vendorPayouts.length = 0;
        const sortedVendorTotals = [...vendorTotals].sort(([left], [right]) =>
          left.localeCompare(right),
        );
        for (const [sellerId, totals] of sortedVendorTotals) {
          const seller = await User.findOneAndUpdate(
            {
              _id: sellerId,
              role: "SELLER",
              accountStatus: "ACTIVE",
              ...getEligibleVendorFilter(),
            },
            { $inc: { vendorLimitRevision: 1 } },
            { new: true, session, runValidators: true },
          )
            .select("_id verification.tier verification.status vendorDetails.tier")
            .lean();
          if (!seller) {
            const error = new Error(
              "A seller for this order is no longer active.",
            );
            error.statusCode = 409;
            throw error;
          }

          totals.policy = getVendorPolicy(seller);
          totals.feeMinor = 0;
          for (const item of orderItems) {
            if (item.vendorId !== sellerId) continue;
            const lineTotalMinor = toMinorUnits(item.lineTotal);
            const platformFeeMinor = Math.round(
              lineTotalMinor * totals.policy.commissionRate,
            );
            totals.feeMinor += platformFeeMinor;
            item.platformFee = fromMinorUnits(platformFeeMinor);
            item.commissionRate = totals.policy.commissionRate;
            item.vendorTier = totals.policy.tier;
            item.vendorNetAmount = fromMinorUnits(
              lineTotalMinor - platformFeeMinor,
            );
          }

          if (totals.grossMinor > toMinorUnits(totals.policy.orderValueLimit)) {
            const error = new Error(
              `This order exceeds the ${totals.policy.tier.replace("_", " ")} seller per-order limit.`,
            );
            error.statusCode = 403;
            throw error;
          }
          const dailyVolume = await getDailyVendorVolume(
            sellerId,
            dayStart,
            now,
            session,
          );
          if (
            dailyVolume + totals.grossMinor >
            toMinorUnits(totals.policy.dailyVolumeLimit)
          ) {
            const error = new Error(
              `This order exceeds the ${totals.policy.tier.replace("_", " ")} seller daily limit.`,
            );
            error.statusCode = 403;
            throw error;
          }
          vendorPayouts.push({
            vendorId: sellerId,
            grossAmount: fromMinorUnits(totals.grossMinor),
            platformFee: fromMinorUnits(totals.feeMinor),
            netAmount: fromMinorUnits(totals.grossMinor - totals.feeMinor),
            tier: totals.policy.tier,
            commissionRate: totals.policy.commissionRate,
          });
        }

        const sellerIds = vendorPayouts.map((payout) => payout.vendorId);
        newContract = new EscrowContract({
          buyerId: authenticatedBuyerId,
          items: orderItems,
          subtotal: fromMinorUnits(subtotalMinor),
          vaultFee: fromMinorUnits(escrowFeeMinor),
          totalHoldAmount: fromMinorUnits(totalHoldMinor),
          currency: CURRENCY,
          vendorPayouts,
          buyerEmail: buyer.email,
          customerName: buyer.name,
          deliveryAddress,
          customerPhone,
          sellerIds,
          fulfillmentStatuses: sellerIds.map((sellerId) => ({
            sellerId,
            status: "PENDING",
          })),
          status: "PAYMENT_PENDING",
          paymentExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
          paymentReference: `ESCROW_${crypto.randomUUID()}`,
        });
        await newContract.save({ session });
      });
    } finally {
      await session.endSession();
    }

    return res.status(201).json({
      success: true,
      message: "Escrow order created. Complete payment to lock the funds.",
      contract: newContract,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    console.error("Escrow order could not be created:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create the escrow order.",
    });
  }
});

// POST /api/escrow/verify
router.post("/verify", authenticateToken, async (req, res) => {
  if (req.user.role !== "BUYER") {
    return res.status(403).json({
      success: false,
      message: "Buyer role required to verify payment.",
    });
  }
  const reference =
    typeof req.body.reference === "string" ? req.body.reference.trim() : "";

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(500).json({
      success: false,
      message: "Paystack verification is not configured.",
    });
  }
  if (!reference) {
    return res.status(400).json({
      success: false,
      message: "A payment reference is required.",
    });
  }

  try {
    const contract = await EscrowContract.findOne({
      paymentReference: reference,
    });
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Escrow order not found for this payment reference.",
      });
    }
    if (contract.buyerId.toString() !== (req.user._id || req.user.id).toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only verify your own payment.",
      });
    }

    if (contract.status === "FUNDS_LOCKED") {
      return res.json({ success: true, contract, alreadyVerified: true });
    }
    if (contract.status !== "PAYMENT_PENDING") {
      return res.status(409).json({
        success: false,
        message: "Escrow order is not awaiting payment.",
      });
    }

    const verification = await verifyPaystackTransaction(reference);
    const payment = verification.payload?.data;
    if (
      verification.statusCode !== 200 ||
      !verification.payload?.status ||
      payment?.status !== "success"
    ) {
      return res.status(402).json({
        success: false,
        message:
          verification.payload?.message ||
          "Paystack payment is not successful.",
      });
    }

    if (
      payment.reference !== contract.paymentReference ||
      String(payment.customer?.email || "")
        .trim()
        .toLowerCase() !== contract.buyerEmail ||
      Number(payment.amount) !== Math.round(contract.totalHoldAmount * 100)
    ) {
      return res.status(400).json({
        success: false,
        message: "Paystack payment does not match the escrow order.",
      });
    }

    const paymentResult = await confirmEscrowPayment(
      contract._id,
      contract.paymentReference,
    );
    if (paymentResult.disputeReason) {
      return res.status(409).json({
        success: false,
        message:
          "Payment was received, but the order requires admin review. The funds remain in escrow.",
        contract: paymentResult.contract,
      });
    }

    return res.json({
      success: true,
      contract: paymentResult.contract,
      alreadyVerified: paymentResult.alreadyProcessed,
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: "Unable to verify the Paystack transaction.",
      error: error.message,
    });
  }
});

// GET /api/escrow/vendor/orders
router.get("/vendor/orders", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SELLER") {
      return res
        .status(403)
        .json({ success: false, message: "Vendor role required." });
    }

    const sellerId = req.user._id || req.user.id;
    if (!mongoose.isValidObjectId(sellerId)) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid vendor account." });
    }

    const contracts = await EscrowContract.find({
      sellerIds: sellerId,
      status: {
        $in: [
          "LOCKED",
          "FUNDS_LOCKED",
          "IN_DISPUTE",
          "RELEASED",
          "COMPLETED",
          "CLOSED",
          "REFUNDED",
        ],
      },
    }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      contracts: contracts.map((contract) => toVendorOrder(contract, sellerId)),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/escrow/:contractId/vendor-status
router.patch(
  "/:contractId/vendor-status",
  authenticateToken,
  async (req, res) => {
    try {
      if (req.user.role !== "SELLER") {
        return res
          .status(403)
          .json({ success: false, message: "Vendor role required." });
      }

      const { contractId } = req.params;
      const { status } = req.body;
      const sellerId = req.user._id || req.user.id;

      if (!mongoose.isValidObjectId(contractId)) {
        return res.status(400).json({
          success: false,
          message: "A valid contractId is required.",
        });
      }
      if (!mongoose.isValidObjectId(sellerId)) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid vendor account." });
      }
      if (!["PENDING", "PROCESSING", "SHIPPED"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Vendors can update fulfillment to PENDING, PROCESSING, or SHIPPED.",
        });
      }

      const contract = await EscrowContract.findOne({
        _id: contractId,
        sellerIds: sellerId,
        status: { $in: ["LOCKED", "FUNDS_LOCKED"] },
      });
      if (!contract) {
        return res.status(404).json({
          success: false,
          message: "Active order not found for this vendor.",
        });
      }

      let fulfillment = contract.fulfillmentStatuses.find(
        (entry) => entry.sellerId.toString() === sellerId.toString(),
      );
      const currentStatus = fulfillment?.status || "PENDING";
      const nextStatuses = {
        PENDING: "PROCESSING",
        PROCESSING: "SHIPPED",
        SHIPPED: null,
      };
      if (status !== currentStatus && nextStatuses[currentStatus] !== status) {
        return res.status(409).json({
          success: false,
          message: `Order fulfillment must advance from ${currentStatus} to ${nextStatuses[currentStatus] || "no further status"}.`,
        });
      }
      if (!fulfillment) {
        contract.fulfillmentStatuses.push({ sellerId, status });
        fulfillment = contract.fulfillmentStatuses.at(-1);
      } else {
        fulfillment.status = status;
        fulfillment.updatedAt = new Date();
      }

      await contract.save();
      return res.json({
        success: true,
        message: "Order fulfillment status updated.",
        contract: toVendorOrder(contract, sellerId),
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },
);

router.post("/rider/seed", authenticateToken, async (req, res) => {
  if (!["DELIVERY_PARTNER", "ADMIN"].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Delivery partner or admin role required.",
    });
  }
  const riderId = req.user._id || req.user.id;
  const session = await mongoose.startSession();
  let contract;
  try {
    await session.withTransaction(async () => {
      const activeDelivery = await EscrowContract.exists({
        deliveryPartnerId: riderId,
        status: { $in: ["FUNDS_LOCKED", "LOCKED", "DISPATCHED"] },
        deliveryStatus: { $ne: "DELIVERED" },
      }).session(session);
      if (activeDelivery) {
        const error = new Error(
          "Complete your active delivery before creating another mock order.",
        );
        error.statusCode = 409;
        throw error;
      }

      const demoEmail = `rider-demo-vendor-${String(riderId)}@invalid.local`;
      let demoVendor = await User.findOne({ email: demoEmail }).session(session);
      if (!demoVendor) {
        [demoVendor] = await User.create(
          [
            {
              name: "Rider Demo Vendor",
              email: demoEmail,
              password: await bcrypt.hash(
                crypto.randomBytes(48).toString("hex"),
                10,
              ),
              role: "SELLER",
              accountStatus: "SUSPENDED",
            },
          ],
          { session },
        );
      }

      const contractId = new mongoose.Types.ObjectId();
      const paymentReference = `MOCK_${crypto.randomUUID()}`;
      const payout = {
        vendorId: demoVendor._id,
        grossAmount: 2500,
        platformFee: 0,
        netAmount: 2500,
        tier: "TIER_1",
        commissionRate: 0,
      };
      [contract] = await EscrowContract.create(
        [
          {
            _id: contractId,
            buyerId: riderId,
            customerName: "Demo Customer",
            customerPhone: "+234 800 000 0000",
            buyerEmail: req.user.email || demoEmail,
            deliveryAddress: "Lekki Phase 1, Lekki, Lagos, Nigeria",
            pickupAddress: "Ikeja City Mall, Alausa, Ikeja, Lagos, Nigeria",
            items: [
              {
                productId: "DEMO-PACKAGE",
                name: "Demo delivery package",
                price: 2500,
                quantity: 1,
                vendor: "Rider Demo Vendor",
                vendorId: demoVendor._id.toString(),
                lineTotal: 2500,
                platformFee: 0,
                commissionRate: 0,
                vendorTier: "TIER_1",
                vendorNetAmount: 2500,
              },
            ],
            subtotal: 2500,
            vaultFee: 0,
            totalHoldAmount: 2500,
            currency: CURRENCY,
            vendorPayouts: [payout],
            sellerIds: [demoVendor._id],
            deliveryPartnerId: riderId,
            deliveryStatus: "ASSIGNED",
            fulfillmentStatuses: [
              { sellerId: demoVendor._id, status: "SHIPPED" },
            ],
            status: "FUNDS_LOCKED",
            paymentReference,
            isMockDelivery: true,
          },
        ],
        { session },
      );

      await VendorWalletTransaction.create(
        [
          {
            vendorId: demoVendor._id,
            contractId,
            paymentReference,
            type: "ESCROW_HOLD",
            grossAmount: payout.grossAmount,
            platformFee: payout.platformFee,
            amount: payout.netAmount,
            currency: CURRENCY,
            tier: payout.tier,
            commissionRate: payout.commissionRate,
          },
        ],
        { session },
      );
      const wallet = await getWalletForUpdate(demoVendor._id, session);
      creditPending(wallet, toMinorUnits(payout.netAmount));
      await wallet.save({ session });
    });

    return res.status(201).json({
      success: true,
      message: "Mock delivery assignment created.",
      contract,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    console.error("Mock delivery assignment could not be created:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create a mock delivery assignment.",
    });
  } finally {
    await session.endSession();
  }
});

router.get("/rider/orders", authenticateToken, async (req, res) => {
  const isAdmin = req.user.role === "ADMIN";
  if (!isAdmin && req.user.role !== "DELIVERY_PARTNER") {
    return res.status(403).json({
      success: false,
      message: "Delivery partner or admin role required.",
    });
  }

  try {
    const filter = {
      status: { $in: ["FUNDS_LOCKED", "LOCKED", "DISPATCHED"] },
      deliveryStatus: { $ne: "DELIVERED" },
      deliveryPartnerId: { $ne: null },
    };
    if (!isAdmin) filter.deliveryPartnerId = req.user._id || req.user.id;

    const riderFilter = isAdmin
      ? {}
      : { deliveryPartnerId: req.user._id || req.user.id };
    const completedFilter = {
      ...riderFilter,
      status: { $in: ["RELEASED", "COMPLETED"] },
      deliveryStatus: "DELIVERED",
    };
    const todayInLagos = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const today = new Date(`${todayInLagos}T00:00:00+01:00`);
    const [contracts, completedCount, todayEarnings, completedContracts] =
      await Promise.all([
        EscrowContract.find(filter)
      .select(
        "paymentReference items vendorPayouts subtotal status deliveryStatus deliveryUpdatedAt fulfillmentStatuses createdAt buyerId customerName deliveryAddress customerPhone pickupAddress isMockDelivery",
      )
      .populate("buyerId", "name phone")
      .sort({ createdAt: -1 })
      .lean(),
        EscrowContract.countDocuments(completedFilter),
        EscrowContract.aggregate([
          {
            $match: {
              ...completedFilter,
              completedAt: { $gte: today },
            },
          },
          { $group: { _id: null, total: { $sum: "$riderEarning" } } },
        ]),
        EscrowContract.find(completedFilter)
          .select(
            "+deliveryProof paymentReference deliveryStatus deliveryUpdatedAt completedAt customerName customerPhone deliveryAddress pickupAddress riderEarning isMockDelivery",
          )
          .sort({ completedAt: -1 })
          .limit(5)
          .lean(),
      ]);
    return res.json({
      success: true,
      contracts: contracts.map((contract) => ({
        ...contract,
        customerName: contract.customerName || contract.buyerId?.name || "Customer",
        customerPhone:
          contract.customerPhone || contract.buyerId?.phone || "Not provided",
        deliveryAddress: contract.deliveryAddress || "Address not provided",
        pickupAddress: contract.pickupAddress || "Vendor pickup, Lagos",
      })),
      stats: {
        totalDeliveriesCompleted: completedCount,
        totalEarningsToday: todayEarnings[0]?.total || 0,
        activeDeliveriesCount: contracts.length,
      },
      completedContracts,
    });
  } catch (error) {
    console.error("Rider assignments could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load assigned deliveries.",
    });
  }
});

router.patch(
  "/:contractId/rider-status",
  authenticateToken,
  parseDeliveryProof,
  async (req, res) => {
  const isAdmin = req.user.role === "ADMIN";
  if (!isAdmin && req.user.role !== "DELIVERY_PARTNER") {
    return res.status(403).json({
      success: false,
      message: "Delivery partner or admin role required.",
    });
  }
  const { contractId } = req.params;
  const { status } = req.body || {};
  if (!mongoose.isValidObjectId(contractId)) {
    return res.status(400).json({
      success: false,
      message: "A valid contractId is required.",
    });
  }
  if (!["ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Status must be ACCEPTED, PICKED_UP, IN_TRANSIT, or DELIVERED.",
    });
  }

  try {
    const contractFilter = {
      _id: contractId,
      status: { $in: ["FUNDS_LOCKED", "LOCKED", "DISPATCHED"] },
    };
    if (isAdmin) {
      contractFilter.deliveryPartnerId = { $ne: null };
    } else {
      contractFilter.deliveryPartnerId = req.user._id || req.user.id;
    }
    const contract = await EscrowContract.findOne(contractFilter);
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Assigned active delivery not found.",
      });
    }

    const nextStatus = {
      PENDING: "ACCEPTED",
      ASSIGNED: "ACCEPTED",
      ACCEPTED: "IN_TRANSIT",
      PICKED_UP: "IN_TRANSIT",
      IN_TRANSIT: "DELIVERED",
      DELIVERED: null,
    };
    if (nextStatus[contract.deliveryStatus] !== status) {
      return res.status(409).json({
        success: false,
        message: `Delivery status must advance from ${contract.deliveryStatus}.`,
      });
    }
    if (
      status === "PICKED_UP" &&
      contract.fulfillmentStatuses.some(
        (fulfillment) => fulfillment.status !== "SHIPPED",
      )
    ) {
      return res.status(409).json({
        success: false,
        message: "All vendors must mark their packages as shipped before pickup.",
      });
    }

    if (status === "DELIVERED") {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Upload a delivery photo before marking this order delivered.",
        });
      }
      if (!isValidDeliveryProof(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: "The uploaded file is not a valid JPEG, PNG, or WebP image.",
        });
      }
      const completedAt = new Date();
      const fulfillmentStatuses = contract.fulfillmentStatuses.map(
        (fulfillment) => ({
          ...fulfillment.toObject(),
          status: "DELIVERED",
          updatedAt: completedAt,
        }),
      );
      const completedContract = await releaseEscrowToWallets(
        contract._id,
        {
          deliveryPartnerId: isAdmin
            ? contract.deliveryPartnerId
            : req.user._id || req.user.id,
          deliveryStatus: contract.deliveryStatus,
        },
        ["FUNDS_LOCKED", "LOCKED", "DISPATCHED"],
        {
          deliveryStatus: "DELIVERED",
          deliveryUpdatedAt: completedAt,
          fulfillmentStatuses,
          deliveryProof: `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`,
          riderEarning: RIDER_DELIVERY_FEE,
        },
      );
      if (!completedContract) {
        return res.status(409).json({
          success: false,
          message: "The delivery has already been completed or changed.",
        });
      }
      return res.json({
        success: true,
        message: "Delivery marked delivered and escrow funds released.",
        contract: completedContract,
      });
    }

    contract.deliveryStatus = status;
    contract.deliveryUpdatedAt = new Date();
    await contract.save();
    return res.json({
      success: true,
      message: `Delivery marked ${status.toLowerCase().replace("_", " ")}.`,
      contract,
    });
  } catch (error) {
    console.error("Rider could not update delivery status:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update delivery status.",
    });
  }
  },
);

router.get("/wallet", authenticateToken, async (req, res) => {
  if (req.user.role !== "SELLER") {
    return res.status(403).json({
      success: false,
      message: "Vendor role required.",
    });
  }
  try {
    const wallet = await VendorWallet.findOne({
      vendorId: req.user._id || req.user.id,
    }).lean();
    const transactions = await VendorWalletTransaction.find({
      vendorId: req.user._id || req.user.id,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const withdrawals = await VendorWithdrawal.find({
      vendorId: req.user._id || req.user.id,
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select("-vendorId")
      .lean();
    const availableBalance =
      wallet?.availableBalance ?? wallet?.balance ?? 0;
    return res.json({
      success: true,
      wallet: {
        ...(wallet || {}),
        balance: availableBalance,
        availableBalance,
        pendingBalance: wallet?.pendingBalance || 0,
        currency: wallet?.currency || CURRENCY,
      },
      transactions,
      withdrawals,
    });
  } catch (error) {
    console.error("Vendor wallet could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load vendor wallet.",
    });
  }
});

// POST /api/escrow/release-funds
router.post("/release-funds", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "BUYER") {
      return res.status(403).json({
        success: false,
        message: "Buyer role required to confirm delivery.",
      });
    }
    const { contractId } = req.body;

    if (!mongoose.isValidObjectId(contractId)) {
      return res.status(400).json({
        success: false,
        message: "A valid contractId is required.",
      });
    }

    const currentContract = await EscrowContract.findOne({
      _id: contractId,
      buyerId: req.user._id || req.user.id,
      status: { $in: ["LOCKED", "FUNDS_LOCKED"] },
    });
    if (!currentContract) {
      return res.status(404).json({
        success: false,
        message: "Active order not found for this buyer.",
      });
    }
    if (
      !currentContract.deliveryPartnerId ||
      currentContract.deliveryStatus !== "DELIVERED"
    ) {
      return res.status(409).json({
        success: false,
        message: "The assigned delivery partner must confirm delivery first.",
      });
    }
    if (
      currentContract.sellerIds.some((sellerId) => {
        const fulfillment = currentContract.fulfillmentStatuses.find(
          (entry) => entry.sellerId.toString() === sellerId.toString(),
        );
        return fulfillment?.status !== "DELIVERED";
      })
    ) {
      return res.status(409).json({
        success: false,
        message: "All vendors must mark their items delivered before release.",
      });
    }

    const contract = await releaseEscrowToWallets(contractId, {
      buyerId: req.user._id || req.user.id,
      deliveryStatus: "DELIVERED",
    });

    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Locked escrow contract not found.",
      });
    }

    return res.json({
      success: true,
      message: "Escrow funds released.",
      contract,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/escrow/dispute
router.post("/dispute", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "BUYER") {
      return res.status(403).json({
        success: false,
        message: "Buyer role required to raise a dispute.",
      });
    }
    const { contractId } = req.body;
    const disputeReason =
      typeof req.body.disputeReason === "string"
        ? req.body.disputeReason.trim()
        : "";

    if (!mongoose.isValidObjectId(contractId)) {
      return res.status(400).json({
        success: false,
        message: "A valid contractId is required.",
      });
    }

    if (!disputeReason || disputeReason.length > 500) {
      return res.status(400).json({
        success: false,
        message: "A dispute reason of 1 to 500 characters is required.",
      });
    }

    const contract = await EscrowContract.findOneAndUpdate(
      {
        _id: contractId,
        buyerId: req.user._id || req.user.id,
        status: { $in: ["LOCKED", "FUNDS_LOCKED"] },
      },
      {
        $set: { status: "IN_DISPUTE", disputeReason },
        $push: {
          disputeEvents: {
            reason: disputeReason,
            raisedBy: req.user._id || req.user.id,
            raisedAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    );

    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Locked escrow contract not found.",
      });
    }

    return res.json({
      success: true,
      message: "Escrow contract marked as in dispute.",
      contract,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/escrow/resolve-dispute
router.post(
  "/resolve-dispute",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { contractId, decision } = req.body;

      if (!mongoose.isValidObjectId(contractId)) {
        return res.status(400).json({
          success: false,
          message: "A valid contractId is required.",
        });
      }

      if (!["RELEASE", "REFUND"].includes(decision)) {
        return res.status(400).json({
          success: false,
          message: "Decision must be RELEASE or REFUND.",
        });
      }

      const contract =
        decision === "RELEASE"
          ? await releaseEscrowToWallets(
              contractId,
              {},
              ["IN_DISPUTE"],
            )
          : await finalizeRefundReceipt(contractId);

      if (!contract) {
        return res.status(404).json({
          success: false,
          message: "Disputed escrow contract not found.",
        });
      }

      return res.json({
        success: true,
        message: `Dispute resolved: contract ${contract.status.toLowerCase()}.`,
        contract,
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },
);

router.get("/:contractId/receipt", authenticateToken, async (req, res) => {
  const { contractId } = req.params;
  if (!mongoose.isValidObjectId(contractId)) {
    return res.status(400).json({
      success: false,
      message: "A valid contractId is required.",
    });
  }
  try {
    const contract = await EscrowContract.findById(contractId)
      .select("buyerId sellerIds items status receipt")
      .lean();
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    const userId = (req.user._id || req.user.id).toString();
    const isSeller =
      req.user.role === "SELLER" &&
      contract.sellerIds.some((sellerId) => sellerId.toString() === userId);
    const canView =
      req.user.role === "ADMIN" ||
      (req.user.role === "BUYER" && contract.buyerId.toString() === userId) ||
      isSeller;
    if (!canView) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this receipt.",
      });
    }
    if (!contract.receipt) {
      return res.status(409).json({
        success: false,
        message: "The receipt is finalized after delivery is confirmed.",
      });
    }
    if (!isSeller) {
      return res.json({ success: true, receipt: contract.receipt });
    }

    const items = (contract.receipt.items || []).flatMap((item, index) => {
      const vendorId =
        item.vendorId || contract.items[index]?.vendorId || contract.items[index]?.sellerId;
      if (String(vendorId || "") !== userId) return [];
      const sellerItem = { ...item };
      delete sellerItem.vendorId;
      return [sellerItem];
    });
    const vendorPayouts = (contract.receipt.vendorPayouts || []).filter(
      (payout) => String(payout.vendorId) === userId,
    );
    return res.json({
      success: true,
      receipt: { ...contract.receipt, items, vendorPayouts },
    });
  } catch (error) {
    console.error("Transaction receipt could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load transaction receipt.",
    });
  }
});

// GET /api/escrow/active
router.get("/active", authenticateToken, async (req, res) => {
  try {
    const { buyerId } = req.query;

    if (buyerId && !mongoose.isValidObjectId(buyerId)) {
      return res.status(400).json({
        success: false,
        message: "A valid buyerId is required.",
      });
    }

    const filter = {
      status: { $in: ["LOCKED", "FUNDS_LOCKED", "IN_DISPUTE"] },
    };
    if (req.user.role === "BUYER") {
      const authenticatedBuyerId = req.user._id || req.user.id;
      if (buyerId && buyerId !== authenticatedBuyerId) {
        return res.status(403).json({
          success: false,
          message: "You can only view your own orders.",
        });
      }
      filter.buyerId = authenticatedBuyerId;
    } else if (req.user.role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Buyer role required.",
      });
    } else if (buyerId) {
      filter.buyerId = buyerId;
    }

    const contracts = await EscrowContract.find(filter).sort({ createdAt: -1 });

    return res.json({ success: true, contracts });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/escrow/completed
router.get("/completed", authenticateToken, async (req, res) => {
  try {
    const { buyerId } = req.query;
    const isAdmin = req.user.role === "ADMIN";

    if (buyerId && !isAdmin && !mongoose.isValidObjectId(buyerId)) {
      return res.status(400).json({
        success: false,
        message: "A valid buyerId is required.",
      });
    }

    if (req.user.role === "BUYER") {
      const authenticatedBuyerId = req.user._id || req.user.id;
      if (buyerId && buyerId !== authenticatedBuyerId) {
        return res.status(403).json({
          success: false,
          message: "You can only view your own orders.",
        });
      }
    } else if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Buyer role required.",
      });
    }

    const filter = {
      status: {
        $in: [/^RELEASED$/i, /^COMPLETED$/i, /^REFUNDED$/i, /^CLOSED$/i],
      },
    };
    if (req.user.role === "BUYER") {
      filter.buyerId = req.user._id || req.user.id;
    } else if (buyerId && !isAdmin) {
      filter.buyerId = buyerId;
    }

    const contracts = await EscrowContract.find(filter).sort({
      completedAt: -1,
      updatedAt: -1,
      createdAt: -1,
    });

    return res.json({ success: true, contracts });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
