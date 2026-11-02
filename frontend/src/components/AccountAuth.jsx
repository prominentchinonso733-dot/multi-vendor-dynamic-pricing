import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { getApiErrorMessage } from "../api";
import { useAuth } from "../context/AuthContext";
import { getRoleHomeRoute } from "../services/roleRoutes";
import { authService } from "../services/authService";

const AccountAuth = ({ role }) => {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
  const canRegister = isBuyer || role === "SELLER";
  const isRegistering = canRegister && mode === "register";

  useEffect(() => {
    if (!isRegistering || role !== "SELLER" || vendorTier !== "TIER_2") {
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
          ...(role === "SELLER" && { businessName, vendorTier }),
        });
        if (role === "SELLER") {
          const paymentPath = "/vendor/dashboard?section=store-settings";

          try {
            if (vendorTier === "TIER_1") {
              await authService.verifyTier1Vendor({
                fullLegalName: name,
                ninNumber,
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
            : role === "DELIVERY_PARTNER"
              ? "Delivery partner sign in"
              : isRegistering
                ? "Create your vendor account"
                : "Vendor sign in"}
      </h1>
      <form onSubmit={submit} style={{ display: "grid", gap: "1rem" }}>
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
                <option value="TIER_1">Tier 1 — $10 one-time entry fee</option>
                <option value="TIER_2">Tier 2 — $20 one-time entry fee</option>
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
            <p>After registering, you’ll continue to the selected tier’s entry fee payment.</p>
          </>
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
      {canRegister && (
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
  role: PropTypes.oneOf(["BUYER", "SELLER", "ADMIN", "DELIVERY_PARTNER"]).isRequired,
};

export default AccountAuth;
