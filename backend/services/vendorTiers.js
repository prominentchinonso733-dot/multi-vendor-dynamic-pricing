const VENDOR_TIER_PRICES_USD = Object.freeze({
  TIER_1: 10,
  TIER_2: 20,
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
  if (getVendorTier(vendor) === "TIER_2") return isTier2VerifiedVendor(vendor);
  return vendor?.vendorDetails?.tier1Verified === true;
};

const getEligibleVendorFilter = () => ({
  $or: [
    {
      "vendorDetails.subscriptionStatus": "ACTIVE",
      "vendorDetails.tier": "TIER_1",
      "vendorDetails.tier1Verified": true,
    },
    {
      "vendorDetails.subscriptionStatus": "ACTIVE",
      "vendorDetails.tier": "TIER_2",
      "verification.tier": "TIER_2",
      "verification.status": "VERIFIED",
    },
  ],
});

const getVendorTierAmountMinor = (tier, exchangeRate = process.env.VENDOR_TIER_USD_NGN_RATE) => {
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
  getVendorTier,
  getVendorTierAmountMinor,
  isTier2Verified,
  isTier2VerifiedVendor,
  isVendorEligibleToSell,
};
