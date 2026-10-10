import axios from "axios";

const configuredBaseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  "https://multi-vendor-dynamic-pricing.onrender.com";
const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/, "");

export const API_BASE_URL = /\/api$/i.test(normalizedBaseUrl)
  ? normalizedBaseUrl
  : `${normalizedBaseUrl}/api`;

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const token =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("authToken")
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
