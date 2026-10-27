import { createContext, useCallback, useContext, useState } from "react";
import { authService } from "../services/authService";
import { normalizeRole } from "../services/roleRoutes";

const AuthContext = createContext(null);

const ROLE_SESSION_KEYS = {
  ADMIN: { token: "adminToken", user: "adminUser" },
  SELLER: { token: "vendorToken", user: "vendorUser" },
  BUYER: { token: "buyerToken", user: "buyerUser" },
};

const normalizeUser = (user) =>
  user && typeof user === "object"
    ? { ...user, role: normalizeRole(user.role) }
    : null;

const emptySessions = () => ({ ADMIN: null, SELLER: null, BUYER: null });

const readStoredAuth = () => {
  try {
    const sessions = emptySessions();
    let migratedRole = null;
    for (const [role, keys] of Object.entries(ROLE_SESSION_KEYS)) {
      const token = localStorage.getItem(keys.token);
      const user = normalizeUser(
        JSON.parse(localStorage.getItem(keys.user) || "null"),
      );
      if (token && user?.role === role) sessions[role] = { token, user };
    }

    const legacyToken = localStorage.getItem("authToken");
    const legacyUser = normalizeUser(
      JSON.parse(localStorage.getItem("authUser") || "null"),
    );
    if (
      legacyToken &&
      legacyUser &&
      ROLE_SESSION_KEYS[legacyUser.role] &&
      !sessions[legacyUser.role]
    ) {
      const keys = ROLE_SESSION_KEYS[legacyUser.role];
      sessions[legacyUser.role] = { token: legacyToken, user: legacyUser };
      localStorage.setItem(keys.token, legacyToken);
      localStorage.setItem(keys.user, JSON.stringify(legacyUser));
      migratedRole = legacyUser.role;
    }
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");

    const storedRole = normalizeRole(localStorage.getItem("activeAuthRole"));
    const activeRole = sessions[storedRole]
      ? storedRole
      : sessions[migratedRole]
        ? migratedRole
        : null;
    if (activeRole) {
      localStorage.setItem("activeAuthRole", activeRole);
    } else {
      localStorage.removeItem("activeAuthRole");
    }
    return { sessions, activeRole };
  } catch {
    return { sessions: emptySessions(), activeRole: null };
  }
};

// eslint-disable-next-line react/prop-types
export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(readStoredAuth);
  const activeAuth = auth.activeRole
    ? auth.sessions[auth.activeRole]
    : null;

  const saveAuth = (data) => {
    const user = normalizeUser(data?.user);
    const keys = ROLE_SESSION_KEYS[user?.role];
    if (!data?.token || !keys) {
      throw new Error("The authentication response has an invalid role or token.");
    }

    localStorage.setItem(keys.token, data.token);
    localStorage.setItem(keys.user, JSON.stringify(user));
    localStorage.setItem("activeAuthRole", user.role);
    setAuth((currentAuth) => ({
      sessions: {
        ...currentAuth.sessions,
        [user.role]: { token: data.token, user },
      },
      activeRole: user.role,
    }));
    return user;
  };

  const login = async (credentials, { expectedRole } = {}) => {
    const data = await authService.login(credentials);
    const role = normalizeRole(data?.user?.role);
    if (expectedRole && role !== normalizeRole(expectedRole)) {
      throw new Error(`This account does not have ${expectedRole} access.`);
    }
    return saveAuth(data);
  };
  const register = async (details) =>
    saveAuth(await authService.register(details));
  const logout = () => {
    const keys = ROLE_SESSION_KEYS[auth.activeRole];
    if (keys) {
      localStorage.removeItem(keys.token);
      localStorage.removeItem(keys.user);
    }
    localStorage.removeItem("activeAuthRole");
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
    setAuth((currentAuth) => ({
      sessions: { ...currentAuth.sessions, [currentAuth.activeRole]: null },
      activeRole: null,
    }));
  };

  const authFetch = useCallback(
    (url, options = {}) => {
      const headers = new Headers(options.headers || {});
      if (activeAuth?.token) {
        headers.set("Authorization", `Bearer ${activeAuth.token}`);
      }
      return fetch(url, { ...options, headers });
    },
    [activeAuth?.token],
  );

  const role = normalizeRole(activeAuth?.user?.role);
  return (
    <AuthContext.Provider
      value={{
        token: activeAuth?.token || null,
        user: activeAuth?.user || null,
        role,
        isAuthenticated: Boolean(activeAuth?.token),
        isAdmin: role === "ADMIN",
        isVendor: role === "SELLER",
        login,
        register,
        logout,
        authFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return context;
}
