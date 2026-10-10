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
};
