import { api } from "../api";

export const pricingService = {
  async calculatePrice(input) {
    const { data } = await api.post("/pricing/calculate", input);
    return data;
  },
};
