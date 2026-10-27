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
];

const statusLabels = {
  NOT_STARTED: "Not started",
  PENDING: "Under review",
  VERIFIED: "Tier 2 verified",
  REJECTED: "Action required",
};

export default function VerificationPanel({ compact = false }) {
  const [verification, setVerification] = useState(null);
  const [legalName, setLegalName] = useState("");
  const [documentType, setDocumentType] = useState("NIN");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    authService
      .getVerificationStatus({ signal: controller.signal })
      .then((status) => {
        setVerification(status);
        setLegalName(status.legalName || "");
        if (status.documentType) setDocumentType(status.documentType);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(getApiErrorMessage(loadError, "Unable to load verification."));
        }

        VerificationPanel.propTypes = {
          compact: PropTypes.bool,
        };
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError("");
    setNotice("");
    try {
      const updated = await authService.submitVerificationRequest({
        legalName,
        documentType,
      });
      setVerification(updated);
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
            Submit your legal name and document type for staff review. Do not enter
            an identity number or upload identity documents here; identity checks
            must be completed through the marketplace&apos;s approved verification
            process before staff can approve Tier 2.
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
              {documentTypes.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button disabled={pending} type="submit">
            {pending ? "Submitting..." : status === "REJECTED" ? "Resubmit request" : "Request Tier 2 review"}
          </button>
        </form>
      )}
    </section>
  );
}
