import { api } from "../api";

export const productsService = {
  async create(product) {
    const { data } = await api.post("/products", product);
    return data.product;
  },

  async listMine(config = {}) {
    const { data } = await api.get("/products/mine", config);
    return data.products;
  },

  async getStore(vendorId, config = {}) {
    const { data } = await api.get(
      `/products/store/${encodeURIComponent(vendorId)}`,
      config,
    );
    return data;
  },

  async list(config = {}) {
    const { data } = await api.get("/products", config);
    return data;
  },
};
