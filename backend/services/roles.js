const SELLER_ROLE_VALUES = ["SELLER", "VENDOR", "vendor", "ROLE_VENDOR"];

const normalizeRole = (role) => {
  const normalized = String(role || "").trim().toUpperCase();
  if (["SELLER", "VENDOR", "ROLE_VENDOR"].includes(normalized)) {
    return "SELLER";
  }
  if (normalized === "ROLE_CUSTOMER") return "BUYER";
  if (normalized === "ROLE_ADMIN") return "ADMIN";
  return normalized || null;
};

const isSellerRole = (role) => normalizeRole(role) === "SELLER";

module.exports = { SELLER_ROLE_VALUES, normalizeRole, isSellerRole };
