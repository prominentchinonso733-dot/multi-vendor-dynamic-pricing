import { useState } from "react";
import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getRoleHomeRoute } from "../services/roleRoutes";

const AccountAuth = ({ role }) => {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const isBuyer = role === "BUYER";
  const isRegistering = isBuyer && mode === "register";

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setIsPending(true);

    try {
      let authenticatedUser;
      if (isRegistering) {
        authenticatedUser = await register({ name, email, password, role: "BUYER" });
      } else {
        authenticatedUser = await login({ email, password }, { expectedRole: role });
      }
      const destination = getRoleHomeRoute(authenticatedUser?.role);
      if (!destination) {
        throw new Error("This account does not have a supported destination.");
      }
      navigate(destination, { replace: true });
    } catch (authError) {
      setError(authError.message || "Unable to sign in.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <section
      aria-labelledby="account-auth-title"
      style={{
        maxWidth: "28rem",
        margin: "2rem auto",
        padding: "2rem",
        background: "#fff",
        borderRadius: "0.75rem",
        boxShadow: "0 1px 4px #0002",
      }}
    >
      <h1 id="account-auth-title">
        {isBuyer
          ? isRegistering
            ? "Create your shopper account"
            : "Sign in to your account"
          : role === "ADMIN"
            ? "Admin sign in"
            : "Vendor sign in"}
      </h1>
      <form onSubmit={submit} style={{ display: "grid", gap: "1rem" }}>
        {isRegistering && (
          <label style={{ display: "grid", gap: "0.35rem" }}>
            Name
            <input
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
        )}
        <label style={{ display: "grid", gap: "0.35rem" }}>
          Email
          <input
            autoComplete="username"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          Password
          <input
            autoComplete={isRegistering ? "new-password" : "current-password"}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button disabled={isPending} type="submit">
          {isPending
            ? "Please wait..."
            : isRegistering
              ? "Register"
              : "Sign In"}
        </button>
      </form>
      {isBuyer && (
        <p>
          {isRegistering ? "Already have an account?" : "New to the marketplace?"}{" "}
          <button
            onClick={() => {
              setError("");
              setMode(isRegistering ? "login" : "register");
            }}
            type="button"
          >
            {isRegistering ? "Sign in" : "Register"}
          </button>
        </p>
      )}
    </section>
  );
};

AccountAuth.propTypes = {
  role: PropTypes.oneOf(["BUYER", "SELLER", "ADMIN"]).isRequired,
};

export default AccountAuth;
