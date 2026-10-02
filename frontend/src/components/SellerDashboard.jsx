import { useEffect, useState } from "react";
import {
  AlertCircle,
  CircleDollarSign,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import DisputeReasonDialog, { DisputeReasonNote } from "./DisputeReasonDialog";
import "./SellerDashboard.css";
import { API_BASE_URL } from "../api";

const ESCROW_API = `${API_BASE_URL}/escrow`;
const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});
const completedStatuses = new Set(["RELEASED", "COMPLETED", "REFUNDED"]);
const statusClassNames = {
  RELEASED: "seller-dashboard__status--released",
  COMPLETED: "seller-dashboard__status--released",
  LOCKED: "seller-dashboard__status--locked",
  FUNDS_LOCKED: "seller-dashboard__status--locked",
  IN_DISPUTE: "seller-dashboard__status--disputed",
  REFUNDED: "seller-dashboard__status--refunded",
};

const getStatusLabel = (status) =>
  status === "IN_DISPUTE" ? "In Dispute" : status.replaceAll("_", " ");
const isCompletedContract = (contract) =>
  completedStatuses.has(contract?.status);

export default function SellerDashboard() {
  const { authFetch, login, logout, role, user } = useAuth();
  const isAdmin = role === "ADMIN";
  const [contracts, setContracts] = useState([]);
  const [completedContracts, setCompletedContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingContractId, setPendingContractId] = useState(null);
  const [disputeContractId, setDisputeContractId] = useState(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [authPending, setAuthPending] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadContracts() {
      setLoading(true);
      setError("");

      try {
        const [activeResponse, completedResponse] = await Promise.all([
          fetch(`${ESCROW_API}/active`, { signal: controller.signal }),
          fetch(`${ESCROW_API}/completed`, { signal: controller.signal }),
        ]);
        const [activeData, completedData] = await Promise.all([
          activeResponse.json(),
          completedResponse.json(),
        ]);

        if (!activeResponse.ok || !activeData.success) {
          throw new Error(
            activeData.message ||
              activeData.error ||
              "Unable to load active contracts.",
          );
        }
        if (!completedResponse.ok || !completedData.success) {
          throw new Error(
            completedData.message ||
              completedData.error ||
              "Unable to load completed transactions.",
          );
        }

        setContracts(
          Array.isArray(activeData.contracts) ? activeData.contracts : [],
        );
        setCompletedContracts(
          Array.isArray(completedData.contracts)
            ? completedData.contracts.filter(isCompletedContract)
            : [],
        );
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          setError(fetchError.message || "Unable to load active contracts.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadContracts();
    return () => controller.abort();
  }, [refreshVersion]);

  const releaseFunds = async (contractId) => {
    setPendingContractId(contractId);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${ESCROW_API}/release-funds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Unable to release escrow funds.",
        );
      }

      setContracts((currentContracts) =>
        currentContracts.filter((contract) => contract._id !== contractId),
      );
      setCompletedContracts((currentContracts) => [
        data.contract,
        ...currentContracts.filter(
          (contract) => contract._id !== data.contract._id,
        ),
      ]);
      setNotice(`Funds released for ${data.contract.paymentReference}.`);
    } catch (releaseError) {
      setError(releaseError.message || "Unable to release escrow funds.");
    } finally {
      setPendingContractId(null);
    }
  };

  const raiseDispute = async (contractId, disputeReason) => {
    setPendingContractId(contractId);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${ESCROW_API}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, disputeReason }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Unable to raise a dispute.",
        );
      }

      setDisputeContractId(null);
      setContracts((currentContracts) =>
        currentContracts.map((contract) =>
          contract._id === contractId ? data.contract : contract,
        ),
      );
      setNotice(`Dispute raised for ${data.contract.paymentReference}.`);
    } catch (disputeError) {
      setError(disputeError.message || "Unable to raise a dispute.");
    } finally {
      setPendingContractId(null);
    }
  };

  const resolveDispute = async (contractId, decision) => {
    setPendingContractId(contractId);
    setError("");
    setNotice("");

    try {
      const response = await authFetch(`${ESCROW_API}/resolve-dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, decision }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Unable to resolve the dispute.",
        );
      }

      setContracts((currentContracts) =>
        currentContracts.filter((contract) => contract._id !== contractId),
      );
      setCompletedContracts((currentContracts) => [
        data.contract,
        ...currentContracts.filter(
          (contract) => contract._id !== data.contract._id,
        ),
      ]);
      setNotice(
        decision === "RELEASE"
          ? `Dispute resolved: funds released for ${data.contract.paymentReference}.`
          : `Dispute resolved: buyer refunded for ${data.contract.paymentReference}.`,
      );
    } catch (resolveError) {
      setError(resolveError.message || "Unable to resolve the dispute.");
    } finally {
      setPendingContractId(null);
    }
  };

  const signInAsAdmin = async (event) => {
    event.preventDefault();
    setAuthPending(true);
    setError("");
    setNotice("");

    try {
      const signedInUser = await login({
        email: adminEmail,
        password: adminPassword,
      });
      setAdminPassword("");

      if (signedInUser.role !== "ADMIN") {
        setError("This account does not have ADMIN access.");
        return;
      }

      setNotice("Admin access granted. Disputes can now be resolved.");
    } catch (authError) {
      setError(authError.message || "Unable to sign in.");
    } finally {
      setAuthPending(false);
    }
  };

  return (
    <section
      className="seller-dashboard"
      aria-labelledby="seller-dashboard-title"
    >
      <header className="seller-dashboard__header">
        <div>
          <p className="seller-dashboard__eyebrow">ESCROW OPERATIONS</p>
          <h1 id="seller-dashboard-title">Seller dashboard</h1>
          <p className="seller-dashboard__description">
            Review active contracts and release funds when an order is complete.
          </p>
        </div>
        <div className="seller-dashboard__count" aria-live="polite">
          <span>Active contracts</span>
          <strong>{contracts.length}</strong>
        </div>
      </header>

      <div className="seller-dashboard__toolbar">
        <h2>Active escrow contracts</h2>
        <button
          className="seller-dashboard__refresh"
          type="button"
          onClick={() => setRefreshVersion((version) => version + 1)}
          disabled={loading}
        >
          <RefreshCw
            size={16}
            aria-hidden="true"
            className={loading ? "seller-dashboard__spinning" : ""}
          />
          Refresh
        </button>
      </div>

      {error && (
        <div
          className="seller-dashboard__message seller-dashboard__message--error"
          role="alert"
        >
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div
          className="seller-dashboard__message seller-dashboard__message--success"
          role="status"
        >
          <span>{notice}</span>
        </div>
      )}

      <section
        className="seller-dashboard__auth-panel"
        aria-label="Admin arbitration access"
      >
        {isAdmin ? (
          <div className="seller-dashboard__admin-session">
            <p>
              Signed in as <strong>{user?.email || "ADMIN"}</strong>
            </p>
            <button
              className="seller-dashboard__refresh"
              type="button"
              onClick={logout}
            >
              Sign out
            </button>
          </div>
        ) : (
          <form
            className="seller-dashboard__admin-login"
            onSubmit={signInAsAdmin}
          >
            <div className="seller-dashboard__admin-login-copy">
              <h2>Admin sign in</h2>
              <p>
                {role
                  ? `Signed in as ${role}. Use an ADMIN account to arbitrate disputes.`
                  : "Sign in with an ADMIN account to arbitrate disputes."}
              </p>
            </div>
            <label>
              Email
              <input
                autoComplete="username"
                onChange={(event) => setAdminEmail(event.target.value)}
                required
                type="email"
                value={adminEmail}
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                onChange={(event) => setAdminPassword(event.target.value)}
                required
                type="password"
                value={adminPassword}
              />
            </label>
            <button
              className="seller-dashboard__resolve-release"
              disabled={authPending}
              type="submit"
            >
              {authPending ? "Signing in..." : "Sign in as Admin"}
            </button>
          </form>
        )}
      </section>

      <div className="seller-dashboard__table-wrap">
        <table className="seller-dashboard__table">
          <thead>
            <tr>
              <th scope="col">Payment reference</th>
              <th scope="col">Subtotal</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="seller-dashboard__sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && contracts.length === 0 ? (
              <tr>
                <td className="seller-dashboard__empty" colSpan="4">
                  Loading active escrow contracts...
                </td>
              </tr>
            ) : contracts.length === 0 ? (
              <tr>
                <td className="seller-dashboard__empty" colSpan="4">
                  No active escrow contracts to display.
                </td>
              </tr>
            ) : (
              contracts.map((contract) => (
                <tr key={contract._id}>
                  <td className="seller-dashboard__reference">
                    {contract.paymentReference}
                  </td>
                  <td>
                    {currencyFormatter.format(Number(contract.subtotal) || 0)}
                  </td>
                  <td>
                    <span
                      className={`seller-dashboard__status ${
                        statusClassNames[contract.status] || ""
                      }`}
                    >
                      {getStatusLabel(contract.status)}
                    </span>
                    {contract.status === "IN_DISPUTE" && (
                      <DisputeReasonNote reason={contract.disputeReason} />
                    )}
                  </td>
                  <td className="seller-dashboard__action-cell">
                    {contract.status === "IN_DISPUTE" ? (
                      isAdmin ? (
                        <div className="seller-dashboard__resolve-controls">
                          <strong>Admin: Resolve Dispute</strong>
                          <button
                            className="seller-dashboard__resolve-release"
                            type="button"
                            onClick={() =>
                              resolveDispute(contract._id, "RELEASE")
                            }
                            disabled={pendingContractId !== null}
                          >
                            Approve Release
                          </button>
                          <button
                            className="seller-dashboard__resolve-refund"
                            type="button"
                            onClick={() =>
                              resolveDispute(contract._id, "REFUND")
                            }
                            disabled={pendingContractId !== null}
                          >
                            Approve Refund
                          </button>
                        </div>
                      ) : (
                        <span>Awaiting admin resolution</span>
                      )
                    ) : (
                      <>
                        <button
                          className="seller-dashboard__release"
                          type="button"
                          onClick={() => releaseFunds(contract._id)}
                          disabled={pendingContractId !== null}
                        >
                          <CircleDollarSign size={16} aria-hidden="true" />
                          {pendingContractId === contract._id
                            ? "Releasing..."
                            : "Release Funds"}
                        </button>
                        <button
                          className="seller-dashboard__dispute"
                          type="button"
                          onClick={() => setDisputeContractId(contract._id)}
                          disabled={pendingContractId !== null}
                        >
                          <ShieldAlert size={16} aria-hidden="true" />
                          {pendingContractId === contract._id
                            ? "Processing..."
                            : "Raise Dispute"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="seller-dashboard__toolbar">
        <h2 id="completed-transactions-title">Completed Transactions</h2>
      </div>
      <div className="seller-dashboard__table-wrap">
        <table
          className="seller-dashboard__table"
          aria-labelledby="completed-transactions-title"
        >
          <thead>
            <tr>
              <th scope="col">Payment reference</th>
              <th scope="col">Subtotal</th>
              <th scope="col">Status</th>
              <th scope="col">Date completed</th>
            </tr>
          </thead>
          <tbody>
            {loading && completedContracts.length === 0 ? (
              <tr>
                <td className="seller-dashboard__empty" colSpan="4">
                  Loading completed transactions...
                </td>
              </tr>
            ) : completedContracts.length === 0 ? (
              <tr>
                <td className="seller-dashboard__empty" colSpan="4">
                  No completed transactions to display.
                </td>
              </tr>
            ) : (
              completedContracts.map((contract) => {
                const completedAt = contract.completedAt || contract.updatedAt;

                return (
                  <tr key={contract._id}>
                    <td className="seller-dashboard__reference">
                      {contract.paymentReference}
                    </td>
                    <td>
                      {currencyFormatter.format(Number(contract.subtotal) || 0)}
                    </td>
                    <td>
                      <span
                        className={`seller-dashboard__status ${
                          statusClassNames[contract.status] || ""
                        }`}
                      >
                        {getStatusLabel(contract.status)}
                      </span>
                    </td>
                    <td>
                      {completedAt ? (
                        <time dateTime={completedAt}>
                          {dateFormatter.format(new Date(completedAt))}
                        </time>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {disputeContractId && (
        <DisputeReasonDialog
          isPending={pendingContractId === disputeContractId}
          onClose={() => setDisputeContractId(null)}
          onSubmit={(reason) => raiseDispute(disputeContractId, reason)}
        />
      )}
    </section>
  );
}
