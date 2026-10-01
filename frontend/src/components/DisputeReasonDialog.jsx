import { useState } from "react";
import "./DisputeReasonDialog.css";

// eslint-disable-next-line react/prop-types
export function DisputeReasonNote({ reason }) {
  if (!reason) return null;

  return (
    <div className="dispute-reason-note">
      <strong>Dispute reason</strong>
      <p>{reason}</p>
    </div>
  );
}

// eslint-disable-next-line react/prop-types
export default function DisputeReasonDialog({ isPending, onClose, onSubmit }) {
  const [reason, setReason] = useState("");

  const submitReason = (event) => {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (trimmedReason) onSubmit(trimmedReason);
  };

  return (
    <div
      className="dispute-dialog__backdrop"
      onMouseDown={isPending ? undefined : onClose}
    >
      <section
        aria-labelledby="dispute-dialog-title"
        aria-modal="true"
        className="dispute-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h2 id="dispute-dialog-title">Raise a dispute</h2>
        <p>Briefly explain the issue with this order.</p>
        <form onSubmit={submitReason}>
          <label htmlFor="dispute-reason">Reason</label>
          <textarea
            autoFocus
            id="dispute-reason"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="For example: Item damaged or not delivered"
            required
            rows={4}
            value={reason}
          />
          <div className="dispute-dialog__actions">
            <button
              className="dispute-dialog__cancel"
              disabled={isPending}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="dispute-dialog__submit"
              disabled={isPending || !reason.trim()}
              type="submit"
            >
              {isPending ? "Submitting..." : "Submit dispute"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
