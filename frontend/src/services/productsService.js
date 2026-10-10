import { api } from "../api";

export const productsService = {
  async listMine(config = {}) {
    const { data } = await api.get("/products/mine", config);
    return data.products;
  },

  async list(config = {}) {
    const { data } = await api.get("/products", config);
    return data;
  },
};
