const mongoose = require("mongoose");
const EscrowContract = require("../models/EscrowContract");
const Product = require("../models/Product");
const VendorWalletTransaction = require("../models/VendorWalletTransaction");
const PlatformCommissionEntry = require("../models/PlatformCommissionEntry");
const calculateCurrentPrice = require("./dynamicPricing");
const { emitProductUpdate } = require("./realtime");
const { CURRENCY, toMinorUnits } = require("./financialPolicy");
const { creditPending, getWalletForUpdate } = require("./vendorWallet");

const confirmEscrowPayment = async (contractId, paymentReference) => {
  const session = await mongoose.startSession();
  let contract;
  let disputeReason = "";
  let updatedProducts = [];

  try {
    await session.withTransaction(async () => {
      updatedProducts = [];
      contract = await EscrowContract.findOneAndUpdate(
        {
          _id: contractId,
          paymentReference,
          status: "PAYMENT_PENDING",
          $or: [
            { paymentExpiresAt: { $exists: false } },
            { paymentExpiresAt: { $gt: new Date() } },
          ],
        },
        { $set: { status: "HELD_IN_ESCROW" } },
        { new: true, session, runValidators: true },
      );
      if (!contract) return;

      for (const item of contract.items) {
        const product = await Product.findOne({
          _id: item.productId,
          stock: { $gte: item.quantity },
        }).session(session);
        if (!product) {
          const error = new Error(
            "One or more products no longer have enough stock.",
          );
          error.code = "ORDER_STOCK_UNAVAILABLE";
          throw error;
        }
        const now = new Date();
        const lastOrderedWithinDay =
          product.lastOrderAt &&
          product.lastOrderAt.getTime() > now.getTime() - 24 * 60 * 60 * 1000;
        product.stock -= item.quantity;
        product.orderUnitsLast24h =
          (lastOrderedWithinDay ? product.orderUnitsLast24h || 0 : 0) +
          item.quantity;
        product.lastOrderAt = now;
        product.currentPrice = calculateCurrentPrice(product);
        await product.save({ session });
        updatedProducts.push(product.toObject());
      }

      for (const payout of contract.vendorPayouts || []) {
        await VendorWalletTransaction.create(
          [
            {
              vendorId: payout.vendorId,
              contractId: contract._id,
              paymentReference: contract.paymentReference,
              type: "ESCROW_HOLD",
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
        creditPending(wallet, toMinorUnits(payout.netAmount));
        await wallet.save({ session });
      }

      if (contract.demandSurgeCommission > 0) {
        await PlatformCommissionEntry.create(
          [
            {
              contractId: contract._id,
              paymentReference: contract.paymentReference,
              amount: contract.demandSurgeCommission,
              currency: contract.currency || CURRENCY,
              source: "DEMAND_SURGE",
              status: "PENDING",
            },
          ],
          { session },
        );
      }
    });
  } catch (error) {
    if (error.code !== "ORDER_STOCK_UNAVAILABLE") throw error;
    disputeReason = error.message;
  } finally {
    await session.endSession();
  }

  if (contract) {
    for (const product of updatedProducts) emitProductUpdate(product);
  }

  if (!contract) {
    const pending = await EscrowContract.findOne({
      _id: contractId,
      paymentReference,
      status: "PAYMENT_PENDING",
    }).lean();
    if (pending?.paymentExpiresAt && pending.paymentExpiresAt <= new Date()) {
      disputeReason = "Payment was confirmed after the checkout hold expired.";
    } else {
      return {
        contract:
          (await EscrowContract.findOne({
            _id: contractId,
            paymentReference,
          })) || null,
        alreadyProcessed: true,
        disputeReason: "",
      };
    }
  }

  if (disputeReason) {
    const disputed = await EscrowContract.findOneAndUpdate(
      { _id: contractId, paymentReference, status: "PAYMENT_PENDING" },
      {
        $set: { status: "IN_DISPUTE", disputeReason },
        $push: {
          disputeEvents: {
            reason: disputeReason,
            raisedAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    );
    return {
      contract: disputed || (await EscrowContract.findById(contractId)),
      alreadyProcessed: false,
      disputeReason,
    };
  }

  return { contract, alreadyProcessed: false, disputeReason: "" };
};

module.exports = confirmEscrowPayment;
