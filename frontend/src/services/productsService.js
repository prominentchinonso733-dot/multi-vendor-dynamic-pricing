import { api } from "../api";

export const productsService = {
  async create(product) {
    const config =
      typeof FormData !== "undefined" && product instanceof FormData
        ? { headers: { "Content-Type": "multipart/form-data" } }
        : undefined;
    const { data } = await api.post("/products", product, config);
    return data.product;
  },

  async update(productId, product) {
    const config =
      typeof FormData !== "undefined" && product instanceof FormData
        ? { headers: { "Content-Type": "multipart/form-data" } }
        : undefined;
    const { data } = await api.patch(
      `/products/${encodeURIComponent(productId)}`,
      product,
      config,
    );
    return data.product;
  },

  async remove(productId) {
    const { data } = await api.delete(
      `/products/${encodeURIComponent(productId)}`,
    );
    return data;
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
