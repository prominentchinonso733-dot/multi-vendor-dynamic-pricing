const ROLE_ALIASES = {
  ADMIN: "ADMIN",
  ROLE_ADMIN: "ADMIN",
  SELLER: "SELLER",
  ROLE_SELLER: "SELLER",
  VENDOR: "SELLER",
  ROLE_VENDOR: "SELLER",
  BUYER: "BUYER",
  CUSTOMER: "BUYER",
  ROLE_CUSTOMER: "BUYER",
  RIDER: "DELIVERY_PARTNER",
  DELIVERY: "DELIVERY_PARTNER",
  ROLE_RIDER: "DELIVERY_PARTNER",
  ROLE_DELIVERY_PARTNER: "DELIVERY_PARTNER",
};

const ROLE_HOME_ROUTES = {
  ADMIN: "/admin",
  SELLER: "/vendor/dashboard",
  BUYER: "/",
  DELIVERY_PARTNER: "/rider/dashboard",
};

export const normalizeRole = (role) => {
  const normalized = String(role || "").trim().toUpperCase();
  return ROLE_ALIASES[normalized] || normalized || null;
};

export const getRoleHomeRoute = (role) =>
  ROLE_HOME_ROUTES[normalizeRole(role)] || null;
