import { createContext, useContext, useState } from "react";
import { API_BASE_URL } from "../api";

const AUTH_API = `${API_BASE_URL}/api/auth`;
const AuthContext = createContext(null);

const readStoredAuth = () => {
  try {
    return {
      token: localStorage.getItem("authToken"),
      user: JSON.parse(localStorage.getItem("authUser") || "null"),
    };
  } catch {
    return { token: null, user: null };
  }
};

// eslint-disable-next-line react/prop-types
export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(readStoredAuth);

  const saveAuth = (data) => {
    localStorage.setItem("authToken", data.token);
    localStorage.setItem("authUser", JSON.stringify(data.user));
    setAuth({ token: data.token, user: data.user });
    return data.user;
  };

  const submitCredentials = async (path, credentials) => {
    const response = await fetch(`${AUTH_API}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        response.status === 404
          ? "Authentication API route not found. Restart the backend server and try again."
          : `Authentication API returned a non-JSON response (HTTP ${response.status}).`,
      );
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.msg || data.error || "Authentication failed.");
    }
    return saveAuth(data);
  };

  const login = (credentials) => submitCredentials("login", credentials);
  const register = (details) => submitCredentials("register", details);
  const logout = () => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
    setAuth({ token: null, user: null });
  };

  const authFetch = (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (auth.token) headers.set("Authorization", `Bearer ${auth.token}`);
    return fetch(url, { ...options, headers });
  };

  return (
    <AuthContext.Provider
      value={{
        token: auth.token,
        user: auth.user,
        role: auth.user?.role || null,
        isAuthenticated: Boolean(auth.token),
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
