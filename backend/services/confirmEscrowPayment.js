const mongoose = require("mongoose");
const EscrowContract = require("../models/EscrowContract");
const Product = require("../models/Product");

const confirmEscrowPayment = async (contractId, paymentReference) => {
  const session = await mongoose.startSession();
  let contract;
  let disputeReason = "";

  try {
    await session.withTransaction(async () => {
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
        { $set: { status: "FUNDS_LOCKED" } },
        { new: true, session, runValidators: true },
      );
      if (!contract) return;

      for (const item of contract.items) {
        const product = await Product.findOneAndUpdate(
          {
            _id: item.productId,
            stock: { $gte: item.quantity },
          },
          { $inc: { stock: -item.quantity } },
          { new: true, session, runValidators: true },
        );
        if (!product) {
          const error = new Error(
            "One or more products no longer have enough stock.",
          );
          error.code = "ORDER_STOCK_UNAVAILABLE";
          throw error;
        }
      }
    });
  } catch (error) {
    if (error.code !== "ORDER_STOCK_UNAVAILABLE") throw error;
    disputeReason = error.message;
  } finally {
    await session.endSession();
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
