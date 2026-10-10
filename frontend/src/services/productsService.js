import { api } from "../api";

export const productsService = {
  async list(config = {}) {
    const { data } = await api.get("/products", config);
    return data;
  },
};
