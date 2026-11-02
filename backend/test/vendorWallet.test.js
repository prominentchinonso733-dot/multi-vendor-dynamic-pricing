const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  creditPending,
  refundEscrow,
  releaseEscrow,
  reserveAvailable,
  restoreAvailable,
} = require("../services/vendorWallet");

test("moves vendor net proceeds from escrow to available balance in minor units", () => {
  const wallet = {
    balance: 0,
    availableBalance: 0,
    pendingBalance: 0,
  };

  creditPending(wallet, 12345);
  assert.equal(wallet.pendingBalance, 123.45);
  assert.equal(wallet.availableBalance, 0);

  releaseEscrow(wallet, 12345, true);
  assert.equal(wallet.pendingBalance, 0);
  assert.equal(wallet.availableBalance, 123.45);
  assert.equal(wallet.balance, 123.45);
});

test("refunds held proceeds without making them withdrawable", () => {
  const wallet = {
    balance: 0,
    availableBalance: 0,
    pendingBalance: 75,
  };

  refundEscrow(wallet, 7500);
  assert.equal(wallet.pendingBalance, 0);
  assert.equal(wallet.availableBalance, 0);
  assert.throws(() => refundEscrow(wallet, 1), /exceeds the vendor pending balance/);
});

test("reserves available funds once and restores them after a failed transfer", () => {
  const wallet = {
    balance: 42.5,
    availableBalance: 42.5,
    pendingBalance: 12,
  };

  const reserved = reserveAvailable(wallet);
  assert.equal(reserved, 4250);
  assert.equal(wallet.availableBalance, 0);
  assert.equal(wallet.pendingBalance, 12);
  assert.equal(reserveAvailable(wallet), 0);

  restoreAvailable(wallet, reserved);
  assert.equal(wallet.availableBalance, 42.5);
  assert.equal(wallet.balance, 42.5);
  assert.equal(wallet.pendingBalance, 12);
});
