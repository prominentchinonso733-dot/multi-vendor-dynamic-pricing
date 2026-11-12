import { api } from "../api";

export const authService = {
  async login(credentials) {
    const { data } = await api.post("/auth/login", credentials);
    return data;
  },

  async register(details) {
    const { data } = await api.post("/auth/register", details);
    return data;
  },

  async getStoreProfile(config = {}) {
    const { data } = await api.get("/auth/profile", config);
    return data.profile;
  },

  async updateStoreProfile(profile) {
    const { data } = await api.put("/auth/profile", profile);
    return data.profile;
  },

  async getVerificationStatus(config = {}) {
    const { data } = await api.get("/auth/verification", config);
    return data.verification;
  },

  async submitVerificationRequest(details) {
    const { data } = await api.post("/auth/verification", details, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data.verification;
  },

  async getTier1Banks(config = {}) {
    const { data } = await api.get("/vendor/banks", config);
    return data.banks;
  },

  async verifyTier1Vendor(details) {
    const { data } = await api.post("/vendor/verify-tier1", details);
    return data.verification;
  },

  async submitVendorTier2Verification(details) {
    const { data } = await api.post(
      "/vendor/verification/tier-2",
      details,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return data.verification;
  },

  async saveVendorPayoutBank(details) {
    const { data } = await api.post("/vendor/save-payout-bank", details);
    return data.payoutDetails;
  },

  async getVendorTierPlans(config = {}) {
    const { data } = await api.get("/vendor/tier-entry/options", config);
    return data;
  },

  async initializeVendorTierPayment(tier) {
    const { data } = await api.post("/vendor/tier-entry/initialize", { tier });
    return data.payment;
  },

  async verifyVendorTierPayment(reference) {
    const { data } = await api.post("/vendor/tier-entry/verify", { reference });
    return data;
  },

  async cancelVendorTierSubscription() {
    const { data } = await api.post("/vendor/tier-subscription/cancel");
    return data;
  },
};
