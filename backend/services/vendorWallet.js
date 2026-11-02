const VendorWallet = require("../models/VendorWallet");
const {
  CURRENCY,
  fromMinorUnits,
  toMinorUnits,
} = require("./financialPolicy");

const validateMinorAmount = (amountMinor) => {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new TypeError("Wallet amounts must be non-negative minor units.");
  }
};

const getWalletForUpdate = async (vendorId, session) => {
  let wallet = await VendorWallet.findOne({ vendorId }).session(session);
  if (!wallet) {
    wallet = new VendorWallet({
      vendorId,
      balance: 0,
      availableBalance: 0,
      pendingBalance: 0,
      currency: CURRENCY,
    });
  }
  if (wallet.availableBalance == null) {
    wallet.availableBalance = wallet.balance || 0;
  }
  if (wallet.pendingBalance == null) wallet.pendingBalance = 0;
  wallet.balance = wallet.availableBalance;
  return wallet;
};

const creditPending = (wallet, amountMinor) => {
  validateMinorAmount(amountMinor);
  wallet.pendingBalance = fromMinorUnits(
    toMinorUnits(wallet.pendingBalance) + amountMinor,
  );
};

const releaseEscrow = (wallet, amountMinor, hasPendingHold) => {
  validateMinorAmount(amountMinor);
  const pendingMinor = toMinorUnits(wallet.pendingBalance);
  if (hasPendingHold && pendingMinor < amountMinor) {
    throw new Error("Escrow hold is missing from the vendor pending balance.");
  }
  if (hasPendingHold) {
    wallet.pendingBalance = fromMinorUnits(pendingMinor - amountMinor);
  }
  wallet.availableBalance = fromMinorUnits(
    toMinorUnits(wallet.availableBalance) + amountMinor,
  );
  wallet.balance = wallet.availableBalance;
};

const refundEscrow = (wallet, amountMinor) => {
  validateMinorAmount(amountMinor);
  const pendingMinor = toMinorUnits(wallet.pendingBalance);
  if (pendingMinor < amountMinor) {
    throw new Error("Escrow refund exceeds the vendor pending balance.");
  }
  wallet.pendingBalance = fromMinorUnits(pendingMinor - amountMinor);
};

const reserveAvailable = (wallet) => {
  const amountMinor = toMinorUnits(wallet.availableBalance);
  if (amountMinor < 1) return 0;
  wallet.availableBalance = 0;
  wallet.balance = 0;
  return amountMinor;
};

const restoreAvailable = (wallet, amountMinor) => {
  validateMinorAmount(amountMinor);
  wallet.availableBalance = fromMinorUnits(
    toMinorUnits(wallet.availableBalance) + amountMinor,
  );
  wallet.balance = wallet.availableBalance;
};

module.exports = {
  creditPending,
  getWalletForUpdate,
  refundEscrow,
  releaseEscrow,
  reserveAvailable,
  restoreAvailable,
};
