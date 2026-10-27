const ROLE_ALIASES = {
  ADMIN: "ADMIN",
  ROLE_ADMIN: "ADMIN",
  SELLER: "SELLER",
  VENDOR: "SELLER",
  ROLE_VENDOR: "SELLER",
  BUYER: "BUYER",
  CUSTOMER: "BUYER",
  ROLE_CUSTOMER: "BUYER",
};

const ROLE_HOME_ROUTES = {
  ADMIN: "/admin",
  SELLER: "/vendor/dashboard",
  BUYER: "/",
};

export const normalizeRole = (role) => {
  const normalized = String(role || "").trim().toUpperCase();
  return ROLE_ALIASES[normalized] || normalized || null;
};

export const getRoleHomeRoute = (role) =>
  ROLE_HOME_ROUTES[normalizeRole(role)] || null;
