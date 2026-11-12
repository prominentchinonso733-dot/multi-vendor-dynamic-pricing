import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getApiErrorMessage } from "../api";
import { useAuth } from "../context/AuthContext";
import { getRoleHomeRoute } from "../services/roleRoutes";
import { authService } from "../services/authService";
import "./AccountAuth.css";

const AccountAuth = ({ role, initialMode = "login" }) => {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState(initialMode);
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
  const [bvnNumber, setBvnNumber] = useState("");
  const [cacRegistrationNumber, setCacRegistrationNumber] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [documentType, setDocumentType] = useState("NIN");
  const [bankStatementFile, setBankStatementFile] = useState(null);
  const [governmentIdFile, setGovernmentIdFile] = useState(null);
  const [governmentIdType, setGovernmentIdType] = useState("DRIVERS_LICENSE");
  const [governmentIdNumber, setGovernmentIdNumber] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [vehicleLicensePlate, setVehicleLicensePlate] = useState("");
  const [riderSafetyConsent, setRiderSafetyConsent] = useState(false);
  const [locationPermissionGranted, setLocationPermissionGranted] =
    useState(false);
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

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const requestRiderLocationPermission = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error("Location permission is not available in this browser."),
        );
        return;
      }
      navigator.geolocation.getCurrentPosition(
        () => {
          setLocationPermissionGranted(true);
          resolve();
        },
        () =>
          reject(
            new Error(
              "Location permission is required for rider registration.",
            ),
          ),
        { maximumAge: 0, timeout: 10000, enableHighAccuracy: false },
      );
    });

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setIsPending(true);

    try {
      let authenticatedUser;
      if (isRegistering) {
        let riderLocationGranted = locationPermissionGranted;
        if (role === "DELIVERY_PARTNER") {
          if (!riderSafetyConsent) {
            throw new Error(
              "Accept the contacts and location safety prompt to continue.",
            );
          }
          if (!locationPermissionGranted) {
            await requestRiderLocationPermission();
            riderLocationGranted = true;
          }
        }
        authenticatedUser = await register({
          name,
          email,
          password,
          role,
          ...(role === "SELLER" && { ninNumber, bvnNumber }),
          ...(role !== "BUYER" && { phone }),
          ...(role === "SELLER" && { businessName, vendorTier }),
          ...(role === "DELIVERY_PARTNER" && {
            safetyConsent: riderSafetyConsent,
            locationPermissionGranted: riderLocationGranted,
            governmentIdType,
            governmentIdNumber,
            emergencyContactName,
            emergencyContactPhone,
            vehicleLicensePlate,
          }),
        });
        if (role === "SELLER") {
          const paymentPath = "/vendor/dashboard?section=store-settings";

          try {
            if (vendorTier === "TIER_1") {
              await authService.verifyTier1Vendor({
                fullLegalName: name,
                ninNumber,
                bvnNumber,
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
              verification.set("cacRegistrationNumber", cacRegistrationNumber);
              verification.set("governmentIdType", documentType);
              verification.set("bankStatement", bankStatementFile);
              verification.set("governmentId", governmentIdFile);
              await authService.submitVendorTier2Verification(verification);
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
          { expectedRole: role },
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
          <>
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
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Driver&apos;s License / Government ID type
              <select
                onChange={(event) => setGovernmentIdType(event.target.value)}
                value={governmentIdType}
              >
                <option value="DRIVERS_LICENSE">Driver&apos;s License</option>
                <option value="NIN">NIN</option>
                <option value="PASSPORT">Passport</option>
                <option value="VOTER_CARD">Voter&apos;s Card</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Driver&apos;s License / Government ID Number
              <input
                autoComplete="off"
                maxLength={40}
                minLength={6}
                onChange={(event) => setGovernmentIdNumber(event.target.value)}
                required
                value={governmentIdNumber}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Emergency contact name
              <input
                autoComplete="off"
                maxLength={120}
                minLength={2}
                onChange={(event) => setEmergencyContactName(event.target.value)}
                required
                value={emergencyContactName}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Emergency contact phone
              <input
                autoComplete="tel"
                maxLength={30}
                minLength={7}
                onChange={(event) => setEmergencyContactPhone(event.target.value)}
                required
                type="tel"
                value={emergencyContactPhone}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              Vehicle license plate number
              <input
                autoComplete="off"
                maxLength={20}
                minLength={2}
                onChange={(event) => setVehicleLicensePlate(event.target.value)}
                required
                value={vehicleLicensePlate}
              />
            </label>
            <label className="account-auth__consent">
              <input
                checked={riderSafetyConsent}
                onChange={(event) =>
                  setRiderSafetyConsent(event.target.checked)
                }
                required
                type="checkbox"
              />
              <span>
                Allow app to access contacts &amp; location for identity
                verification and safety audit. Location permission is requested
                once during registration; your coordinates are not stored.
                Browsers do not provide general address-book access, so enter
                one trusted emergency contact above.
              </span>
            </label>
          </>
        )}
        {isRegistering && role === "SELLER" && (
          <>
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
                  setBankStatementFile(null);
                  setGovernmentIdFile(null);
                  setError("");
                }}
                value={vendorTier}
              >
                <option value="TIER_1">Tier 1 Basic — $5/month</option>
                <option value="TIER_2">Tier 2 Verified — $10/month</option>
              </select>
            </label>
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
              11-digit BVN
              <input
                autoComplete="off"
                inputMode="numeric"
                maxLength={11}
                minLength={11}
                onChange={(event) =>
                  setBvnNumber(event.target.value.replace(/\D/g, "").slice(0, 11))
                }
                pattern="\d{11}"
                required
                value={bvnNumber}
              />
            </label>
            {vendorTier === "TIER_2" && (
              <>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  CAC Registration Number
                  <input
                    autoComplete="off"
                    maxLength={80}
                    onChange={(event) =>
                      setCacRegistrationNumber(event.target.value)
                    }
                    required
                    value={cacRegistrationNumber}
                  />
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  Government ID type
                  <select
                    onChange={(event) => setDocumentType(event.target.value)}
                    value={documentType}
                  >
                    <option value="NIN">NIN</option>
                    <option value="BVN">BVN</option>
                    <option value="DRIVERS_LICENSE">Driver&apos;s License</option>
                    <option value="PASSPORT">Passport</option>
                    <option value="VOTER_CARD">Voter&apos;s Card</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  Bank statement (PDF, JPEG, or PNG; up to 5 MB)
                  <input
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={(event) =>
                      setBankStatementFile(event.target.files?.[0] || null)
                    }
                    required
                    type="file"
                  />
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  Government-issued ID (PDF, JPEG, or PNG; up to 5 MB)
                  <input
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={(event) =>
                      setGovernmentIdFile(event.target.files?.[0] || null)
                    }
                    required
                    type="file"
                  />
                </label>
              </>
            )}
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
  initialMode: PropTypes.oneOf(["login", "register"]),
};

export default AccountAuth;
