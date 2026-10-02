import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import DisputeReasonDialog, { DisputeReasonNote } from "./DisputeReasonDialog";
import "./BuyerDashboard.css";
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
const statusClassNames = {
  LOCKED: "buyer-dashboard__status--locked",
  FUNDS_LOCKED: "buyer-dashboard__status--locked",
  IN_DISPUTE: "buyer-dashboard__status--disputed",
  RELEASED: "buyer-dashboard__status--released",
  COMPLETED: "buyer-dashboard__status--released",
  REFUNDED: "buyer-dashboard__status--refunded",
};

const getStatusLabel = (status) =>
  status === "IN_DISPUTE" ? "In Dispute" : status.replaceAll("_", " ");

const getOrderItems = (items = []) =>
  items.map((item) => `${item.name} x${item.quantity}`).join(", ") ||
  "Order items";

// eslint-disable-next-line react/prop-types
export default function BuyerDashboard({ buyerId, refreshVersion = 0 }) {
  const [activeOrders, setActiveOrders] = useState([]);
  const [completedOrders, setCompletedOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingOrderId, setPendingOrderId] = useState(null);
  const [disputeOrderId, setDisputeOrderId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = `?buyerId=${encodeURIComponent(buyerId)}`;

    async function loadOrders() {
      setLoading(true);
      setError("");

      try {
        const [activeResponse, completedResponse] = await Promise.all([
          fetch(`${ESCROW_API}/active${query}`, { signal: controller.signal }),
          fetch(`${ESCROW_API}/completed${query}`, {
            signal: controller.signal,
          }),
        ]);
        const [activeData, completedData] = await Promise.all([
          activeResponse.json(),
          completedResponse.json(),
        ]);

        if (!activeResponse.ok || !activeData.success) {
          throw new Error(
            activeData.message || activeData.error || "Unable to load orders.",
          );
        }
        if (!completedResponse.ok || !completedData.success) {
          throw new Error(
            completedData.message ||
              completedData.error ||
              "Unable to load completed orders.",
          );
        }

        setActiveOrders(
          Array.isArray(activeData.contracts) ? activeData.contracts : [],
        );
        setCompletedOrders(
          Array.isArray(completedData.contracts) ? completedData.contracts : [],
        );
      } catch (loadError) {
        if (loadError.name !== "AbortError") {
          setError(loadError.message || "Unable to load orders.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadOrders();
    return () => controller.abort();
  }, [buyerId, refreshVersion]);

  const updateOrder = async (contractId, action, disputeReason) => {
    setPendingOrderId(contractId);
    setError("");
    setNotice("");

    const isRelease = action === "release";
    const endpoint = isRelease ? "release-funds" : "dispute";

    try {
      const response = await fetch(`${ESCROW_API}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, disputeReason }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Unable to update this order.",
        );
      }

      if (isRelease) {
        setActiveOrders((orders) =>
          orders.filter((order) => order._id !== contractId),
        );
        setCompletedOrders((orders) => [
          data.contract,
          ...orders.filter((order) => order._id !== data.contract._id),
        ]);
        setNotice(`Receipt confirmed for ${data.contract.paymentReference}.`);
      } else {
        setDisputeOrderId(null);
        setActiveOrders((orders) =>
          orders.map((order) =>
            order._id === contractId ? data.contract : order,
          ),
        );
        setNotice(`Dispute raised for ${data.contract.paymentReference}.`);
      }
    } catch (actionError) {
      setError(actionError.message || "Unable to update this order.");
    } finally {
      setPendingOrderId(null);
    }
  };

  return (
    <section
      className="buyer-dashboard"
      aria-labelledby="buyer-dashboard-title"
    >
      <header className="buyer-dashboard__header">
        <div>
          <p className="buyer-dashboard__eyebrow">ESCROW ORDERS</p>
          <h1 id="buyer-dashboard-title">My Orders</h1>
          <p className="buyer-dashboard__description">
            Track escrow status, confirm delivery, or raise a dispute.
          </p>
        </div>
        <div className="buyer-dashboard__count" aria-live="polite">
          <span>Active orders</span>
          <strong>{activeOrders.length}</strong>
        </div>
      </header>

      {error && (
        <div
          className="buyer-dashboard__message buyer-dashboard__message--error"
          role="alert"
        >
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div
          className="buyer-dashboard__message buyer-dashboard__message--success"
          role="status"
        >
          <span>{notice}</span>
        </div>
      )}

      <div className="buyer-dashboard__toolbar">
        <h2>Active Orders</h2>
        <button
          className="buyer-dashboard__refresh"
          type="button"
          onClick={() => setRefreshVersion((version) => version + 1)}
          disabled={loading}
        >
          <RefreshCw
            size={16}
            aria-hidden="true"
            className={loading ? "buyer-dashboard__spinning" : ""}
          />
          Refresh
        </button>
      </div>
      <div className="buyer-dashboard__table-wrap">
        <table className="buyer-dashboard__table">
          <thead>
            <tr>
              <th scope="col">Payment reference</th>
              <th scope="col">Items</th>
              <th scope="col">Order total</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && activeOrders.length === 0 ? (
              <tr>
                <td className="buyer-dashboard__empty" colSpan="5">
                  Loading active orders...
                </td>
              </tr>
            ) : activeOrders.length === 0 ? (
              <tr>
                <td className="buyer-dashboard__empty" colSpan="5">
                  No active orders to display.
                </td>
              </tr>
            ) : (
              activeOrders.map((order) => (
                <tr key={order._id}>
                  <td className="buyer-dashboard__reference">
                    {order.paymentReference}
                  </td>
                  <td className="buyer-dashboard__items">
                    {getOrderItems(order.items)}
                  </td>
                  <td>
                    {currencyFormatter.format(
                      Number(order.totalHoldAmount ?? order.subtotal) || 0,
                    )}
                  </td>
                  <td>
                    <span
                      className={`buyer-dashboard__status ${
                        statusClassNames[order.status] || ""
                      }`}
                    >
                      {getStatusLabel(order.status)}
                    </span>
                    {order.status === "IN_DISPUTE" && (
                      <DisputeReasonNote reason={order.disputeReason} />
                    )}
                  </td>
                  <td className="buyer-dashboard__actions">
                    {["LOCKED", "FUNDS_LOCKED"].includes(order.status) && (
                      <>
                        <button
                          className="buyer-dashboard__confirm"
                          type="button"
                          onClick={() => updateOrder(order._id, "release")}
                          disabled={pendingOrderId !== null}
                        >
                          <CheckCircle2 size={16} aria-hidden="true" />
                          {pendingOrderId === order._id
                            ? "Confirming..."
                            : "Confirm Receipt & Release"}
                        </button>
                        <button
                          className="buyer-dashboard__dispute"
                          type="button"
                          onClick={() => setDisputeOrderId(order._id)}
                          disabled={pendingOrderId !== null}
                        >
                          <ShieldAlert size={16} aria-hidden="true" />
                          {pendingOrderId === order._id
                            ? "Processing..."
                            : "Raise Dispute"}
                        </button>
                      </>
                    )}
                    {order.status === "IN_DISPUTE" && (
                      <span className="buyer-dashboard__review-note">
                        Under review
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="buyer-dashboard__toolbar">
        <h2>Completed Orders</h2>
      </div>
      <div className="buyer-dashboard__table-wrap">
        <table className="buyer-dashboard__table">
          <thead>
            <tr>
              <th scope="col">Payment reference</th>
              <th scope="col">Items</th>
              <th scope="col">Order total</th>
              <th scope="col">Status</th>
              <th scope="col">Date completed</th>
            </tr>
          </thead>
          <tbody>
            {loading && completedOrders.length === 0 ? (
              <tr>
                <td className="buyer-dashboard__empty" colSpan="5">
                  Loading completed orders...
                </td>
              </tr>
            ) : completedOrders.length === 0 ? (
              <tr>
                <td className="buyer-dashboard__empty" colSpan="5">
                  No completed orders to display.
                </td>
              </tr>
            ) : (
              completedOrders.map((order) => {
                const completedAt = order.completedAt || order.updatedAt;

                return (
                  <tr key={order._id}>
                    <td className="buyer-dashboard__reference">
                      {order.paymentReference}
                    </td>
                    <td className="buyer-dashboard__items">
                      {getOrderItems(order.items)}
                    </td>
                    <td>
                      {currencyFormatter.format(
                        Number(order.totalHoldAmount ?? order.subtotal) || 0,
                      )}
                    </td>
                    <td>
                      <span
                        className={`buyer-dashboard__status ${
                          statusClassNames[order.status] || ""
                        }`}
                      >
                        {getStatusLabel(order.status)}
                      </span>
                    </td>
                    <td>
                      {completedAt ? (
                        <time dateTime={completedAt}>
                          {dateFormatter.format(new Date(completedAt))}
                        </time>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {disputeOrderId && (
        <DisputeReasonDialog
          isPending={pendingOrderId === disputeOrderId}
          onClose={() => setDisputeOrderId(null)}
          onSubmit={(reason) => updateOrder(disputeOrderId, "dispute", reason)}
        />
      )}
    </section>
  );
}
