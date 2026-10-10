import { createContext, useCallback, useContext, useState } from "react";
import { authService } from "../services/authService";

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

  const login = async (credentials) =>
    saveAuth(await authService.login(credentials));
  const register = async (details) =>
    saveAuth(await authService.register(details));
  const logout = () => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
    setAuth({ token: null, user: null });
  };

  const authFetch = useCallback(
    (url, options = {}) => {
      const headers = new Headers(options.headers || {});
      if (auth.token) headers.set("Authorization", `Bearer ${auth.token}`);
      return fetch(url, { ...options, headers });
    },
    [auth.token],
  );

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
