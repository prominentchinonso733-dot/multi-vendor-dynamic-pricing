import { api } from "../api";

export const aiService = {
  async support(message, history = []) {
    const { data } = await api.post("/ai/support", { message, history });
    return data;
  },
};
