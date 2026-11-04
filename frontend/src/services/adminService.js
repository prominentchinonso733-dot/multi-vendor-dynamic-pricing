import { api } from "../api";

export const adminService = {
  async getOverview(params = {}, config = {}) {
    const { data } = await api.get("/admin/overview", { params, ...config });
    return data;
  },

  async getPendingVerifications(config = {}) {
    const { data } = await api.get("/admin/verification/pending", config);
    return data.users;
  },

  async downloadVerificationDocument(userId) {
    const response = await api.get(
      `/admin/verification/${encodeURIComponent(userId)}/document`,
      { responseType: "blob" },
    );
    return {
      blob: response.data,
      contentType: response.headers["content-type"],
    };
  },

  async updateAccountStatus(userId, status) {
    const { data } = await api.patch(
      `/admin/users/${encodeURIComponent(userId)}/status`,
      { status },
    );
    return data.user;
  },

  async reviewVerification(userId, decision, reviewNote, identityChecked = false) {
    const { data } = await api.patch(
      `/admin/verification/${encodeURIComponent(userId)}`,
      { decision, reviewNote, identityChecked },
    );
    return data.user;
  },

  async createRider(details) {
    const { data } = await api.post("/admin/riders", details);
    return data.user;
  },

  async assignRider(orderId, riderId) {
    const { data } = await api.patch(
      `/admin/orders/${encodeURIComponent(orderId)}/rider`,
      { riderId: riderId || null },
    );
    return data.order;
  },

  async getFeaturedItems(config = {}) {
    const { data } = await api.get("/admin/featured", config);
    return data;
  },

  async setFeatured(entity, id, isFeatured) {
    const { data } = await api.patch(
      `/admin/featured/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
      { isFeatured },
    );
    return data.item;
  },

  async getCommissionLedger(params = {}, config = {}) {
    const { data } = await api.get("/admin/commission-ledger", {
      params,
      ...config,
    });
    return data;
  },
};
