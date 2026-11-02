import { useEffect, useState } from "react";
import { AlertCircle, BadgeCheck, ShieldCheck } from "lucide-react";
import PropTypes from "prop-types";
import { getApiErrorMessage } from "../api";
import { authService } from "../services/authService";
import "./Tier1VerificationPanel.css";

export default function Tier1VerificationPanel({ onVerified }) {
  const [verification, setVerification] = useState(null);
  const [fullLegalName, setFullLegalName] = useState("");
  const [ninNumber, setNinNumber] = useState("");
  const [banks, setBanks] = useState([]);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadVerification() {
      try {
        const [profile, payoutBanks] = await Promise.all([
          authService.getStoreProfile({ signal: controller.signal }),
          authService.getTier1Banks({ signal: controller.signal }),
        ]);
        const tier1Verification = {
          tier1Verified: profile.tier1Verified === true,
          ...(profile.tier1Verification || {}),
          payoutDetails: profile.payoutDetails || null,
        };
        setVerification(tier1Verification);
        setFullLegalName(profile.tier1Verification?.legalName || "");
        setBankCode(profile.payoutDetails?.bankCode || "");
        setBanks(payoutBanks);
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
      let updated;
      if (verification?.tier1Verified) {
        const payoutDetails = await authService.saveVendorPayoutBank({
          legalName: verification.legalName,
          bankCode,
          accountNumber,
        });
        updated = { ...verification, payoutDetails };
      } else {
        updated = await authService.verifyTier1Vendor({
          fullLegalName,
          ninNumber,
          bankCode,
          accountNumber,
        });
        setNinNumber("");
      }
      setVerification(updated);
      setAccountNumber("");
      onVerified?.(updated);
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
            Complete a basic NIN format check. Your NIN is not validated against
            government records.
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
        <p role="status">Loading verification details...</p>
      ) : verification?.tier1Verified && verification.payoutDetails ? (
        <div className="tier1-verification__summary" role="status">
          <p><strong>{verification.legalName}</strong></p>
          <p>NIN ending {verification.ninLast4}</p>
          <p>
            Payout to {verification.payoutDetails.bankName}, account ending{" "}
            {verification.payoutDetails.accountLast4}.
          </p>
          <small>
            NIN format was checked, but the number was not validated against
            NIMC records. Tier 2 remains a separate admin document review.
          </small>
        </div>
      ) : (
        <form className="tier1-verification__form" onSubmit={submit}>
          {!verification?.tier1Verified && (
            <>
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
            </>
          )}
          {verification?.tier1Verified && (
            <p className="tier1-verification__existing-name">
              Payout account for <strong>{verification.legalName}</strong>
            </p>
          )}
          <label>
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
          <label>
            Payout Account Number
            <input
              autoComplete="off"
              inputMode="numeric"
              maxLength={10}
              minLength={10}
              onChange={(event) =>
                setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 10))
              }
              pattern="\d{10}"
              required
              value={accountNumber}
            />
          </label>
          {!verification?.tier1Verified && (
            <p className="tier1-verification__privacy">
              Your NIN is encrypted before storage and checked for 11-digit
              format only. It is not checked against NIMC records. Your payout
              account is encrypted at rest and checked against your legal name.
            </p>
          )}
          <button
            disabled={pending}
            type="submit"
          >
            {pending
              ? "Saving details..."
              : verification?.tier1Verified
                ? "Save payout account"
                : "Verify Tier 1"}
          </button>
        </form>
      )}
    </section>
  );
}

Tier1VerificationPanel.propTypes = {
  onVerified: PropTypes.func,
};
