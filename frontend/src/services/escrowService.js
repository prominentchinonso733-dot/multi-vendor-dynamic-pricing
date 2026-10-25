import { api } from "../api";

export const escrowService = {
  async listVendorOrders(config = {}) {
    const { data } = await api.get("/escrow/vendor/orders", config);
    return data.contracts;
  },

  async updateVendorStatus(contractId, status) {
    const { data } = await api.patch(
      `/escrow/${encodeURIComponent(contractId)}/vendor-status`,
      { status },
    );
    return data.contract;
  },
};
