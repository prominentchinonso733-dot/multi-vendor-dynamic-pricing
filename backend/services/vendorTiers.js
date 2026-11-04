const VENDOR_TIER_PRICES_USD = Object.freeze({
  TIER_1: 5,
  TIER_2: 10,
});

const isTier2Verified = (vendor) =>
  vendor?.verification?.tier === "TIER_2" &&
  vendor?.verification?.status === "VERIFIED";

const getVendorTier = (vendor) =>
  vendor?.vendorDetails?.tier ||
  (isTier2Verified(vendor) ? "TIER_2" : "TIER_1");

const isTier2VerifiedVendor = (vendor) =>
  getVendorTier(vendor) === "TIER_2" && isTier2Verified(vendor);

const isVendorEligibleToSell = (vendor) => {
  if (vendor?.vendorDetails?.subscriptionStatus !== "ACTIVE") return false;
  const subscriptionPeriodEnd = new Date(
    vendor.vendorDetails.subscriptionPeriodEnd,
  ).getTime();
  if (
    !Number.isFinite(subscriptionPeriodEnd) ||
    subscriptionPeriodEnd <= Date.now()
  ) {
    return false;
  }
  if (getVendorTier(vendor) === "TIER_2") return isTier2VerifiedVendor(vendor);
  return vendor?.vendorDetails?.tier1Verified === true;
};

const getEligibleVendorFilter = () => ({
  $or: [
    {
      "vendorDetails.subscriptionStatus": "ACTIVE",
      "vendorDetails.subscriptionPeriodEnd": { $gt: new Date() },
      "vendorDetails.tier": "TIER_1",
      "vendorDetails.tier1Verified": true,
    },
    {
      "vendorDetails.subscriptionStatus": "ACTIVE",
      "vendorDetails.subscriptionPeriodEnd": { $gt: new Date() },
      "vendorDetails.tier": "TIER_2",
      "verification.tier": "TIER_2",
      "verification.status": "VERIFIED",
    },
  ],
});

const getCheckoutEligibleVendorFilter = () => {
  const eligibleVendorFilter = getEligibleVendorFilter();
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DEMO_ALLOW_UNVERIFIED_VENDOR_CHECKOUT !== "true"
  ) {
    return eligibleVendorFilter;
  }

  return {
    $or: [
      eligibleVendorFilter,
      { accountStatus: "ACTIVE" },
      { status: "approved" },
      { isActive: true },
    ],
  };
};

const getVendorTierAmountMinor = (
  tier,
  exchangeRate = process.env.VENDOR_TIER_USD_NGN_RATE,
) => {
  const usdPrice = Object.hasOwn(VENDOR_TIER_PRICES_USD, tier)
    ? VENDOR_TIER_PRICES_USD[tier]
    : null;
  const usdToNgnRate = Number(exchangeRate);
  if (
    !usdPrice ||
    !Number.isFinite(usdToNgnRate) ||
    usdToNgnRate <= 0 ||
    usdToNgnRate > 1000000
  ) {
    const error = new Error("Vendor tier payment pricing is not configured.");
    error.code = "VENDOR_TIER_PRICING_NOT_CONFIGURED";
    throw error;
  }
  return Math.round(usdPrice * usdToNgnRate * 100);
};

module.exports = {
  VENDOR_TIER_PRICES_USD,
  getEligibleVendorFilter,
  getCheckoutEligibleVendorFilter,
  getVendorTier,
  getVendorTierAmountMinor,
  isTier2Verified,
  isTier2VerifiedVendor,
  isVendorEligibleToSell,
};
