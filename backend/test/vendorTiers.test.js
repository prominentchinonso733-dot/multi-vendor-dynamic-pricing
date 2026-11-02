const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const {
  getVendorTierAmountMinor,
  isVendorEligibleToSell,
} = require("../services/vendorTiers");

const originalExchangeRate = process.env.VENDOR_TIER_USD_NGN_RATE;

afterEach(() => {
  if (originalExchangeRate === undefined) {
    delete process.env.VENDOR_TIER_USD_NGN_RATE;
  } else {
    process.env.VENDOR_TIER_USD_NGN_RATE = originalExchangeRate;
  }
});

test("calculates NGN entry fees from the configured USD exchange rate", () => {
  assert.equal(getVendorTierAmountMinor("TIER_1", 1500), 1500000);
  assert.equal(getVendorTierAmountMinor("TIER_2", 1500), 3000000);
  assert.throws(() => getVendorTierAmountMinor("TIER_1", 0), {
    code: "VENDOR_TIER_PRICING_NOT_CONFIGURED",
  });
});

test("requires active entry payment and tier-specific verification to sell", () => {
  assert.equal(
    isVendorEligibleToSell({
      vendorDetails: {
        tier: "TIER_1",
        subscriptionStatus: "ACTIVE",
        tier1Verified: true,
      },
    }),
    true,
  );
  assert.equal(
    isVendorEligibleToSell({
      vendorDetails: {
        tier: "TIER_1",
        subscriptionStatus: "INACTIVE",
        tier1Verified: true,
      },
    }),
    false,
  );
  assert.equal(
    isVendorEligibleToSell({
      vendorDetails: {
        tier: "TIER_2",
        subscriptionStatus: "ACTIVE",
        tier1Verified: true,
      },
      verification: { tier: "TIER_2", status: "PENDING" },
    }),
    false,
  );
  assert.equal(
    isVendorEligibleToSell({
      vendorDetails: { tier: "TIER_2", subscriptionStatus: "ACTIVE" },
      verification: { tier: "TIER_2", status: "VERIFIED" },
    }),
    true,
  );
});
