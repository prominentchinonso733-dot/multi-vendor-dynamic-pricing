import { useEffect, useState } from "react";
import { AlertCircle, BadgeCheck, ShieldCheck } from "lucide-react";
import PropTypes from "prop-types";
import { getApiErrorMessage } from "../api";
import { authService } from "../services/authService";
import "./Tier1VerificationPanel.css";

export default function Tier1VerificationPanel({ onVerified }) {
  const [verification, setVerification] = useState(null);
  const [banks, setBanks] = useState([]);
  const [fullLegalName, setFullLegalName] = useState("");
  const [ninNumber, setNinNumber] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadVerification() {
      try {
        const profile = await authService.getStoreProfile({
          signal: controller.signal,
        });
        const tier1Verification = {
          tier1Verified: profile.tier1Verified === true,
          ...(profile.tier1Verification || {}),
        };
        setVerification(tier1Verification);
        setFullLegalName(profile.tier1Verification?.legalName || "");
        if (!tier1Verification.tier1Verified) {
          setBanks(
            await authService.getTier1Banks({ signal: controller.signal }),
          );
        }

        Tier1VerificationPanel.propTypes = {
          onVerified: PropTypes.func,
        };
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            getApiErrorMessage(
              loadError,
              "Unable to load Tier 1 verification.",
            ),
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadVerification();
    return () => controller.abort();
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const verified = await authService.verifyTier1Vendor({
        fullLegalName,
        ninNumber,
        bankCode,
        bankAccountNumber,
      });
      setVerification(verified);
      setNinNumber("");
      setBankAccountNumber("");
      onVerified?.(verified);
    } catch (submitError) {
      setError(
        getApiErrorMessage(
          submitError,
          "Unable to complete Tier 1 verification.",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  const selectedBank = banks.find((bank) => bank.code === bankCode);

  return (
    <section
      aria-labelledby="tier1-verification-title"
      className="tier1-verification"
    >
      <header className="tier1-verification__header">
        <div>
          <p className="tier1-verification__eyebrow">SELLER IDENTITY CHECK</p>
          <h2 id="tier1-verification-title">Tier 1 · Basic verification</h2>
          <p>
            Complete a basic NIN format and payout account name soft-check
            before listing products.
          </p>
        </div>
        {verification?.tier1Verified ? (
          <span className="tier1-verification__badge tier1-verification__badge--verified">
            <BadgeCheck aria-hidden="true" size={17} /> Verified
          </span>
        ) : (
          <span className="tier1-verification__badge">
            <ShieldCheck aria-hidden="true" size={17} /> Required
          </span>
        )}
      </header>

      {error && (
        <p className="tier1-verification__error" role="alert">
          <AlertCircle aria-hidden="true" size={17} /> {error}
        </p>
      )}

      {loading ? (
        <p role="status">Loading bank and verification details...</p>
      ) : verification?.tier1Verified ? (
        <div className="tier1-verification__summary" role="status">
          <p>
            <strong>{verification.legalName}</strong> · {verification.bankName}
            {" · account ending "}
            {verification.bankAccountLast4}
          </p>
          <p>
            NIN ending {verification.ninLast4} · bank account name matched
          </p>
          <small>
            NIN format was checked, but the number was not validated against
            NIMC records. Tier 2 remains a separate admin document review.
          </small>
        </div>
      ) : (
        <form className="tier1-verification__form" onSubmit={submit}>
          <label>
            Full legal name
            <input
              autoComplete="name"
              maxLength={120}
              minLength={2}
              onChange={(event) => setFullLegalName(event.target.value)}
              required
              value={fullLegalName}
            />
          </label>
          <label>
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
          <label>
            Bank name
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
          <label>
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
          {selectedBank && (
            <p className="tier1-verification__hint">
              Paystack will check the account name at {selectedBank.name} and
              compare it to your full legal name.
            </p>
          )}
          <p className="tier1-verification__privacy">
            The NIN and payout account number are encrypted before storage.
            The NIN is format-checked only; this soft-check is not an
            authoritative NIN verification.
          </p>
          <button
            disabled={pending || banks.length === 0}
            type="submit"
          >
            {pending ? "Checking details..." : "Verify Tier 1"}
          </button>
        </form>
      )}
    </section>
  );
}
