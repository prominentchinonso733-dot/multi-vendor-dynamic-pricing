import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";
import { getApiErrorMessage } from "../api";
import { authService } from "../services/authService";
import "./VerificationPanel.css";

const documentTypes = [
  ["NIN", "National Identification Number (NIN)"],
  ["BVN", "Bank Verification Number (BVN)"],
  ["DRIVERS_LICENSE", "Driver's licence"],
  ["PASSPORT", "International passport"],
  ["VOTER_CARD", "Voter's Card"],
];

const statusLabels = {
  NOT_STARTED: "Not started",
  PENDING: "Under review",
  VERIFIED: "Tier 2 verified",
  REJECTED: "Action required",
};

export default function VerificationPanel({
  compact = false,
  requirePayoutBank = false,
}) {
  const [verification, setVerification] = useState(null);
  const [legalName, setLegalName] = useState("");
  const [documentType, setDocumentType] = useState("NIN");
  const [documentFile, setDocumentFile] = useState(null);
  const [banks, setBanks] = useState([]);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      authService.getVerificationStatus({ signal: controller.signal }),
      requirePayoutBank
        ? authService.getTier1Banks({ signal: controller.signal })
        : Promise.resolve([]),
    ])
      .then(([status, payoutBanks]) => {
        setVerification(status);
        setLegalName(status.legalName || "");
        if (status.documentType) setDocumentType(status.documentType);
        setBanks(payoutBanks);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(getApiErrorMessage(loadError, "Unable to load verification."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requirePayoutBank]);

  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError("");
    setNotice("");
    try {
      if (requirePayoutBank) {
        await authService.saveVendorPayoutBank({
          legalName,
          bankCode,
          accountNumber,
        });
      }
      const request = new FormData();
      request.set("legalName", legalName);
      request.set("documentType", documentType);
      request.set("document", documentFile);
      const updated = await authService.submitVerificationRequest(request);
      setVerification(updated);
      setDocumentFile(null);
      setNotice("Request submitted. Tier 2 remains pending until review is complete.");
    } catch (submitError) {
      setError(
        getApiErrorMessage(submitError, "Unable to submit the verification request."),
      );
    } finally {
      setPending(false);
    }
  };

  const status = verification?.status || "NOT_STARTED";

  return (
    <section
      aria-labelledby="verification-panel-title"
      className={`verification-panel${compact ? " verification-panel--compact" : ""}`}
    >
      <header className="verification-panel__heading">
        <div>
          <p className="verification-panel__eyebrow">ACCOUNT TRUST</p>
          <h2 id="verification-panel-title">Identity verification</h2>
        </div>
        <span
          className={`verification-panel__badge verification-panel__badge--${status.toLowerCase()}`}
        >
          <ShieldCheck aria-hidden="true" size={16} />
          {statusLabels[status] || status}
        </span>
      </header>
      <div className="verification-panel__tiers">
        <article className="verification-panel__tier">
          <strong>Tier 1 · Basic account</strong>
          <span>Available after account registration.</span>
        </article>
        <article
          className={`verification-panel__tier${verification?.tier === "TIER_2" ? " verification-panel__tier--active" : ""}`}
        >
          <strong>Tier 2 · Identity checked</strong>
          <span>Granted only after identity review is approved.</span>
        </article>
      </div>

      {error && (
        <p className="verification-panel__message verification-panel__message--error" role="alert">
          <AlertCircle aria-hidden="true" size={17} /> {error}
        </p>
      )}
      {notice && (
        <p className="verification-panel__message verification-panel__message--success" role="status">
          <CheckCircle2 aria-hidden="true" size={17} /> {notice}
        </p>
      )}
      {verification?.reviewNote && (
        <p className="verification-panel__review-note">
          Review note: {verification.reviewNote}
        </p>
      )}

      {loading ? (
        <p role="status">Loading verification status...</p>
      ) : status === "VERIFIED" ? (
        <p className="verification-panel__confirmed" role="status">
          Your account has completed Tier 2 identity review.
        </p>
      ) : status === "PENDING" ? (
        <p role="status">
          Your request is being reviewed. Your account remains Tier 1 until it is approved.
        </p>
      ) : (
        <form className="verification-panel__form" onSubmit={submit}>
          <p>
            Submit a clear copy for admin review. The file is encrypted before
            storage, is available only to admins while your request is pending,
            and is deleted after review. Do not enter your identity number here.
          </p>
          <label>
            Full legal name
            <input
              autoComplete="name"
              maxLength={120}
              minLength={2}
              onChange={(event) => setLegalName(event.target.value)}
              required
              value={legalName}
            />
          </label>
          <label>
            Identity document type
            <select
              onChange={(event) => setDocumentType(event.target.value)}
              value={documentType}
            >
              {documentTypes
                .filter(
                  ([value]) =>
                    !requirePayoutBank || value !== "DRIVERS_LICENSE",
                )
                .map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
                ))}
            </select>
          </label>
          <label>
            Identity document file (PDF, JPEG, or PNG; up to 5 MB)
            <input
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) =>
                setDocumentFile(event.target.files?.[0] || null)
              }
              required
              type="file"
            />
          </label>
          {requirePayoutBank && (
            <>
              <label>
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
              <label>
                Payout account number
                <input
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={10}
                  minLength={10}
                  onChange={(event) =>
                    setAccountNumber(
                      event.target.value.replace(/\D/g, "").slice(0, 10),
                    )
                  }
                  pattern="\d{10}"
                  required
                  value={accountNumber}
                />
              </label>
              <p>
                Paystack will soft-check that the payout account name matches
                your legal name. Your account number is encrypted at rest.
              </p>
            </>
          )}
          <button disabled={pending} type="submit">
            {pending ? "Submitting..." : status === "REJECTED" ? "Resubmit request" : "Request Tier 2 review"}
          </button>
        </form>
      )}
    </section>
  );
}

VerificationPanel.propTypes = {
  compact: PropTypes.bool,
  requirePayoutBank: PropTypes.bool,
};
