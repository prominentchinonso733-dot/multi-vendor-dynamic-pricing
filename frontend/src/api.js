import axios from "axios";

const configuredBaseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  "https://multi-vendor-dynamic-pricing.onrender.com";
const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/, "");

export const API_BASE_URL = /\/api$/i.test(normalizedBaseUrl)
  ? normalizedBaseUrl
  : `${normalizedBaseUrl}/api`;

const BACKEND_BASE_URL = normalizedBaseUrl.replace(/\/api$/i, "");

export const getAssetUrl = (url) => {
  if (typeof url !== "string" || !/^\/?uploads\//i.test(url)) {
    return url;
  }

  return `${BACKEND_BASE_URL}/${url.replace(/^\/+/, "")}`;
};

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const roleToTokenKey = {
    ADMIN: "adminToken",
    SELLER: "vendorToken",
    BUYER: "buyerToken",
  };
  const activeRole =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("activeAuthRole")
      : null;
  const tokenKey = roleToTokenKey[activeRole];
  const token =
    tokenKey && typeof localStorage !== "undefined"
      ? localStorage.getItem(tokenKey)
      : null;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isCancel(error)) {
      return Promise.reject(error);
    }

    const responseMessage =
      error.response?.data?.msg ||
      error.response?.data?.message ||
      error.response?.data?.error;
    error.message =
      responseMessage ||
      (error.response
        ? `Request failed with status ${error.response.status}.`
        : "Unable to connect to the backend. Check the API URL and try again.");

    return Promise.reject(error);
  },
);

export const getApiErrorMessage = (error, fallback = "The request failed.") =>
  error?.message || fallback;
