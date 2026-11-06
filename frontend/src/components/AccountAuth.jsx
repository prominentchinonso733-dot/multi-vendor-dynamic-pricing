import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getApiErrorMessage } from "../api";
import { useAuth } from "../context/AuthContext";
import { getRoleHomeRoute } from "../services/roleRoutes";
import { authService } from "../services/authService";
import "./AccountAuth.css";

const AccountAuth = ({ role }) => {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [vendorTier, setVendorTier] = useState("TIER_1");
  const [banks, setBanks] = useState([]);
  const [bankCode, setBankCode] = useState("");
  const [ninNumber, setNinNumber] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [documentType, setDocumentType] = useState("NIN");
  const [documentFile, setDocumentFile] = useState(null);
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const isBuyer = role === "BUYER";
  const canRegister =
    isBuyer || role === "SELLER" || role === "DELIVERY_PARTNER";
  const isRegistering = canRegister && mode === "register";

  useEffect(() => {
    if (!isRegistering || role !== "SELLER") {
      return undefined;
    }

    const controller = new AbortController();
    authService
      .getTier1Banks({ signal: controller.signal })
      .then(setBanks)
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(getApiErrorMessage(loadError, "Unable to load payout banks."));
        }
      });

    return () => controller.abort();
  }, [isRegistering, role, vendorTier]);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setIsPending(true);

    try {
      let authenticatedUser;
      if (isRegistering) {
        authenticatedUser = await register({
          name,
          email,
          password,
          role,
          ...(role === "DELIVERY_PARTNER" && { phone }),
          ...(role === "SELLER" && { businessName, vendorTier }),
        });
        if (role === "SELLER") {
          const paymentPath = "/vendor/dashboard?section=store-settings";

          try {
            if (vendorTier === "TIER_1") {
              await authService.verifyTier1Vendor({
                fullLegalName: name,
                ninNumber,
                bankCode,
                accountNumber: bankAccountNumber,
              });
            } else {
              await authService.saveVendorPayoutBank({
                legalName: name,
                bankCode,
                accountNumber: bankAccountNumber,
              });
              const verification = new FormData();
              verification.set("legalName", name);
              verification.set("documentType", documentType);
              verification.set("document", documentFile);
              await authService.submitVerificationRequest(verification);
            }
            navigate(paymentPath, { replace: true });
          } catch (verificationError) {
            navigate(paymentPath, {
              replace: true,
              state: {
                onboardingVerificationError: getApiErrorMessage(
                  verificationError,
                  "Your account was created, but verification details could not be saved. You can submit them from vendor onboarding.",
                ),
              },
            });
          }
          return;
        }
      } else {
        authenticatedUser = await login(
          { email, password },
          {
            ...(role !== "DELIVERY_PARTNER" && { expectedRole: role }),
          },
        );
      }
      const destination =
        role === "DELIVERY_PARTNER" &&
        ["DELIVERY_PARTNER", "ADMIN"].includes(authenticatedUser?.role)
          ? "/rider/dashboard"
          : getRoleHomeRoute(authenticatedUser?.role);
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
    <section className="account-auth" aria-labelledby="account-auth-title">
      <header className="account-auth__header">
        <span className="account-auth__eyebrow">
          {isRegistering ? "JOIN THE MARKETPLACE" : "WELCOME BACK"}
        </span>
        <h1 id="account-auth-title">
        {isBuyer
          ? isRegistering
            ? "Create your shopper account"
            : "Sign in to your account"
          : role === "ADMIN"
            ? "Admin sign in"
            : role === "DELIVERY_PARTNER"
              ? isRegistering
                ? "Create your delivery partner account"
                : "Delivery partner sign in"
              : isRegistering
                ? "Create your vendor account"
                : "Vendor sign in"}
        </h1>
        <p>
          {isRegistering
            ? "Enter your details to get started."
            : "Sign in to continue to your account."}
        </p>
      </header>
      {role === "DELIVERY_PARTNER" && (
        <div
          className="rider-auth__tabs"
          role="tablist"
          aria-label="Rider access"
          style={{
            display: "flex",
            gap: "0.5rem",
            margin: "1rem 0",
            borderBottom: "1px solid #dce5e5",
          }}
        >
          <button
            aria-selected={mode === "login"}
            onClick={() => {
              setError("");
              setMode("login");
            }}
            role="tab"
            style={{
              padding: "0.55rem 0.9rem",
              border: 0,
              borderBottom: mode === "login" ? "2px solid #176f5d" : "2px solid transparent",
              background: "transparent",
              color: mode === "login" ? "#176f5d" : "#5c6f76",
              fontWeight: 700,
            }}
            type="button"
          >
            Sign In
          </button>
          <button
            aria-selected={mode === "register"}
            onClick={() => {
              setError("");
              setMode("register");
            }}
            role="tab"
            style={{
              padding: "0.55rem 0.9rem",
              border: 0,
              borderBottom: mode === "register" ? "2px solid #176f5d" : "2px solid transparent",
              background: "transparent",
              color: mode === "register" ? "#176f5d" : "#5c6f76",
              fontWeight: 700,
            }}
            type="button"
          >
            Register
          </button>
        </div>
      )}
      <form className="account-auth__form" onSubmit={submit}>
        {isRegistering && (
          <label style={{ display: "grid", gap: "0.35rem" }}>
            {isBuyer ? "Name" : "Full name"}
            <input
              autoComplete="name"
              maxLength={120}
              minLength={2}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
        )}
        {isRegistering && role === "DELIVERY_PARTNER" && (
          <label style={{ display: "grid", gap: "0.35rem" }}>
            Phone number
            <input
              autoComplete="tel"
              maxLength={30}
              minLength={7}
              onChange={(event) => setPhone(event.target.value)}
              required
              type="tel"
              value={phone}
            />
          </label>
        )}
        {isRegistering && role === "SELLER" && (
          <>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Store or business name
              <input
                autoComplete="organization"
                maxLength={100}
                onChange={(event) => setBusinessName(event.target.value)}
                required
                value={businessName}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Vendor tier
              <select
                onChange={(event) => {
                  setVendorTier(event.target.value);
                  setDocumentFile(null);
                  setError("");
                }}
                value={vendorTier}
              >
                <option value="TIER_1">Tier 1 Basic — $5/month</option>
                <option value="TIER_2">Tier 2 Verified — $10/month</option>
              </select>
            </label>
            {vendorTier === "TIER_1" ? (
              <>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  11-digit NIN
                  <input
                    autoComplete="off"
                    inputMode="numeric"
                    maxLength={11}
                    minLength={11}
                    onChange={(event) =>
                      setNinNumber(event.target.value.replace(/\D/g, "").slice(0, 11))
                    }
                    pattern="\d{11}"
                    required
                    value={ninNumber}
                  />
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  Bank Name
                  <select
                    onChange={(event) => setBankCode(event.target.value)}
                    required
                    value={bankCode}
                  >
                    <option value="">Select payout bank</option>
                    {banks.map((bank) => (
                      <option key={bank.code} value={bank.code}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  Payout Account Number
                  <input
                    autoComplete="off"
                    inputMode="numeric"
                    maxLength={10}
                    minLength={10}
                    onChange={(event) =>
                      setBankAccountNumber(
                        event.target.value.replace(/\D/g, "").slice(0, 10),
                      )
                    }
                    pattern="\d{10}"
                    required
                    value={bankAccountNumber}
                  />
                </label>
              </>
            ) : (
              <>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  Document type
                  <select
                    onChange={(event) => setDocumentType(event.target.value)}
                    value={documentType}
                  >
                    <option value="NIN">NIN</option>
                    <option value="BVN">BVN</option>
                    <option value="PASSPORT">Passport</option>
                    <option value="VOTER_CARD">Voter&apos;s Card</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  Photo ID (PDF, JPEG, or PNG; up to 5 MB)
                  <input
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={(event) =>
                      setDocumentFile(event.target.files?.[0] || null)
                    }
                    required
                    type="file"
                  />
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  Payout bank name
                  <select
                    onChange={(event) => setBankCode(event.target.value)}
                    required
                    value={bankCode}
                  >
                    <option value="">Select payout bank</option>
                    {banks.map((bank) => (
                      <option key={bank.code} value={bank.code}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  Payout account number
                  <input
                    autoComplete="off"
                    inputMode="numeric"
                    maxLength={10}
                    minLength={10}
                    onChange={(event) =>
                      setBankAccountNumber(
                        event.target.value.replace(/\D/g, "").slice(0, 10),
                      )
                    }
                    pattern="\d{10}"
                    required
                    value={bankAccountNumber}
                  />
                </label>
              </>
            )}
            <p>After registering, you can activate the selected monthly vendor plan from your dashboard.</p>
          </>
        )}
        <label className="account-auth__field">
          Email
          <input
            autoComplete="username"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <div className="account-auth__field">
          <label htmlFor="account-auth-password">Password</label>
          <span className="account-auth__password">
            <input
              id="account-auth-password"
              autoComplete={
                isRegistering ? "new-password" : "current-password"
              }
              onChange={(event) => setPassword(event.target.value)}
              minLength={
                isRegistering && role === "DELIVERY_PARTNER" ? 8 : undefined
              }
              required
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-controls="account-auth-password"
              aria-pressed={showPassword}
              className="account-auth__password-toggle"
              onClick={() => setShowPassword((isVisible) => !isVisible)}
              type="button"
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" size={18} />
              ) : (
                <Eye aria-hidden="true" size={18} />
              )}
              <span>{showPassword ? "Hide" : "Show"}</span>
            </button>
          </span>
        </div>
        {error && (
          <p className="account-auth__error" role="alert">
            {error}
          </p>
        )}
        <button
          className="account-auth__submit"
          disabled={isPending}
          type="submit"
        >
          {isPending
            ? "Please wait..."
            : isRegistering
              ? "Register"
              : "Sign In"}
        </button>
      </form>
      {canRegister && role !== "DELIVERY_PARTNER" && (
        <p className="account-auth__switch">
          {isRegistering ? "Already have an account?" : "New to the marketplace?"}{" "}
          <button
            className="account-auth__switch-button"
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
  role: PropTypes.oneOf(["BUYER", "SELLER", "ADMIN", "DELIVERY_PARTNER"]).isRequired,
};

export default AccountAuth;
