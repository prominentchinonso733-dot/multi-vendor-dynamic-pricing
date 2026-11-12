const assert = require("node:assert/strict");
const { test } = require("node:test");
const EscrowContract = require("../models/EscrowContract");

test("accepts HELD_IN_ESCROW as a paid, unsettled contract status", async () => {
  const contract = new EscrowContract({
    buyerId: "507f1f77bcf86cd799439011",
    subtotal: 100,
    vaultFee: 2.5,
    totalHoldAmount: 102.5,
    buyerEmail: "customer@example.com",
    paymentReference: "ESCROW_TEST",
    status: "HELD_IN_ESCROW",
  });

  await assert.doesNotReject(contract.validate());
});
