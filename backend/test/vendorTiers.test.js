const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const {
  getVendorTierAmountMinor,
  isVendorEligibleToSell,
} = require("../services/vendorTiers");

const originalExchangeRate = process.env.VENDOR_TIER_USD_NGN_RATE;
const originalNodeEnv = process.env.NODE_ENV;
const originalDemoCheckout = process.env.DEMO_ALLOW_UNVERIFIED_VENDOR_CHECKOUT;

afterEach(() => {
  if (originalExchangeRate === undefined) {
    delete process.env.VENDOR_TIER_USD_NGN_RATE;
  } else {
    process.env.VENDOR_TIER_USD_NGN_RATE = originalExchangeRate;
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
  if (originalDemoCheckout === undefined) {
    delete process.env.DEMO_ALLOW_UNVERIFIED_VENDOR_CHECKOUT;
  } else {
    process.env.DEMO_ALLOW_UNVERIFIED_VENDOR_CHECKOUT = originalDemoCheckout;
  }
});

test("calculates monthly NGN subscription amounts from the configured USD exchange rate", () => {
  assert.equal(getVendorTierAmountMinor("TIER_1", 1500), 750000);
  assert.equal(getVendorTierAmountMinor("TIER_2", 1500), 1500000);
  assert.throws(() => getVendorTierAmountMinor("TIER_1", 0), {
    code: "VENDOR_TIER_PRICING_NOT_CONFIGURED",
  });
});

test("requires an unexpired subscription and tier-specific verification to sell", () => {
  const subscriptionPeriodEnd = new Date(Date.now() + 60_000);
  assert.equal(
    isVendorEligibleToSell({
      vendorDetails: {
        tier: "TIER_1",
        subscriptionStatus: "ACTIVE",
        subscriptionPeriodEnd,
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
        subscriptionPeriodEnd,
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
        subscriptionPeriodEnd,
        tier1Verified: true,
      },
      verification: { tier: "TIER_2", status: "PENDING" },
    }),
    false,
  );
  assert.equal(
    isVendorEligibleToSell({
      vendorDetails: {
        tier: "TIER_2",
        subscriptionStatus: "ACTIVE",
        subscriptionPeriodEnd,
      },
      verification: { tier: "TIER_2", status: "VERIFIED" },
    }),
    true,
  );
  assert.equal(
    isVendorEligibleToSell({
      vendorDetails: {
        tier: "TIER_1",
        subscriptionStatus: "ACTIVE",
        subscriptionPeriodEnd: new Date(Date.now() - 60_000),
        tier1Verified: true,
      },
    }),
    false,
  );
  assert.equal(
    isVendorEligibleToSell({
      vendorDetails: {
        tier: "TIER_1",
        subscriptionStatus: "ACTIVE",
        tier1Verified: true,
      },
    }),
    false,
  );
});

test("demo checkout can accept active legacy vendors only outside production", () => {
  const {
    getCheckoutEligibleVendorFilter,
    getEligibleVendorFilter,
  } = require("../services/vendorTiers");

  process.env.NODE_ENV = "development";
  process.env.DEMO_ALLOW_UNVERIFIED_VENDOR_CHECKOUT = "true";
  const demoFilter = getCheckoutEligibleVendorFilter();
  assert.ok(demoFilter.$or.some((filter) => filter.accountStatus === "ACTIVE"));
  assert.ok(demoFilter.$or.some((filter) => filter.status === "approved"));
  assert.ok(demoFilter.$or.some((filter) => filter.isActive === true));

  process.env.NODE_ENV = "production";
  assert.deepEqual(
    getCheckoutEligibleVendorFilter(),
    getEligibleVendorFilter(),
  );
});
