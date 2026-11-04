const VENDOR_POLICY = {
  TIER_1: {
    commissionRate: 0.1,
    dailyVolumeLimit: 500000,
    orderValueLimit: 100000,
  },
  TIER_2: {
    commissionRate: 0.05,
    dailyVolumeLimit: 5000000,
    orderValueLimit: 1000000,
  },
};

const BUYER_ESCROW_FEE_RATE = 0.025;
const DEMAND_SURGE_PROFIT_SHARE = 0.2;
const CURRENCY = "NGN";

const getVendorPolicy = (vendor) => {
  const tier =
    (vendor?.vendorDetails?.tier === "TIER_2" ||
      (!vendor?.vendorDetails?.tier &&
        vendor?.verification?.tier === "TIER_2")) &&
    vendor?.verification?.tier === "TIER_2" &&
    vendor?.verification?.status === "VERIFIED"
      ? "TIER_2"
      : "TIER_1";
  return { tier, ...VENDOR_POLICY[tier] };
};

const toMinorUnits = (amount) => Math.round(Number(amount) * 100);
const fromMinorUnits = (amount) => amount / 100;

module.exports = {
  BUYER_ESCROW_FEE_RATE,
  DEMAND_SURGE_PROFIT_SHARE,
  CURRENCY,
  VENDOR_POLICY,
  fromMinorUnits,
  getVendorPolicy,
  toMinorUnits,
};
