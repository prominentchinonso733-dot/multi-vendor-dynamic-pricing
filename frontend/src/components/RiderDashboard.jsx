import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { API_BASE_URL } from "../api";
import { useAuth } from "../context/AuthContext";
import "./RiderDashboard.css";

const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

export default function RiderDashboard() {
  const { authFetch } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  const loadOrders = useCallback(
    async (signal) => {
      try {
        const response = await authFetch(`${API_BASE_URL}/escrow/rider/orders`, {
          signal,
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || "Unable to load delivery assignments.");
        }
        setOrders(Array.isArray(data.contracts) ? data.contracts : []);
        setError("");
      } catch (loadError) {
        if (loadError.name !== "AbortError") {
          setError(loadError.message || "Unable to load delivery assignments.");
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [authFetch],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadOrders(controller.signal);
    return () => controller.abort();
  }, [loadOrders, refreshVersion]);

  const updateDelivery = async (order, status) => {
    setPendingId(order._id);
    setError("");
    setNotice("");
    try {
      const response = await authFetch(
        `${API_BASE_URL}/escrow/${encodeURIComponent(order._id)}/rider-status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to update delivery status.");
      }
      setOrders((current) =>
        status === "DELIVERED"
          ? current.filter((entry) => entry._id !== order._id)
          : current.map((entry) =>
              entry._id === order._id ? data.contract : entry,
            ),
      );
      setNotice(`Order ${order.paymentReference} marked ${status.toLowerCase().replace("_", " ")}.`);
    } catch (updateError) {
      setError(updateError.message || "Unable to update delivery status.");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="rider-dashboard" aria-labelledby="rider-dashboard-title">
      <header className="rider-dashboard__header">
        <div>
          <p className="rider-dashboard__eyebrow">DELIVERY PARTNER PORTAL</p>
          <h1 id="rider-dashboard-title">Assigned deliveries</h1>
          <p>Update pickup and delivery progress for orders assigned to you.</p>
        </div>
        <button
          className="rider-dashboard__refresh"
          disabled={loading}
          onClick={() => setRefreshVersion((version) => version + 1)}
          type="button"
        >
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </button>
      </header>

      {error && (
        <p className="rider-dashboard__message rider-dashboard__message--error" role="alert">
          <AlertCircle size={18} aria-hidden="true" /> {error}
        </p>
      )}
      {notice && (
        <p className="rider-dashboard__message rider-dashboard__message--success" role="status">
          <CheckCircle2 size={18} aria-hidden="true" /> {notice}
        </p>
      )}

      {loading ? (
        <p role="status">Loading assigned deliveries...</p>
      ) : orders.length === 0 ? (
        <p className="rider-dashboard__empty">You have no active delivery assignments.</p>
      ) : (
        <div className="rider-dashboard__orders">
          {orders.map((order) => (
            <article className="rider-dashboard__order" key={order._id}>
              <header>
                <div>
                  <span className="rider-dashboard__label">Order reference</span>
                  <strong>{order.paymentReference}</strong>
                </div>
                <span className="rider-dashboard__status">
                  {(order.deliveryStatus || "PENDING").replaceAll("_", " ")}
                </span>
              </header>
              <ul>
                {(order.items || []).map((item, index) => (
                  <li key={`${item.productId || item.name}-${index}`}>
                    <span>{item.name} × {item.quantity}</span>
                    <span>{item.vendor}</span>
                  </li>
                ))}
              </ul>
              <div className="rider-dashboard__vendors">
                {(order.fulfillmentStatuses || []).map((entry) => {
                  const sellerId = String(entry.sellerId || "");
                  const vendor = order.items?.find(
                    (item) => String(item.vendorId || "") === sellerId,
                  )?.vendor;
                  return (
                    <span key={sellerId}>
                      {vendor || "Vendor"}: {entry.status.replaceAll("_", " ")}
                    </span>
                  );
                })}
              </div>
              <footer>
                <span>
                  {currencyFormatter.format(
                    Number(order.items?.reduce(
                      (sum, item) =>
                        sum + Number(item.price || 0) * Number(item.quantity || 0),
                      0,
                    )) || 0,
                  )}
                </span>
                {order.deliveryStatus === "PENDING" && (
                  <button
                    disabled={pendingId !== null}
                    onClick={() => updateDelivery(order, "PICKED_UP")}
                    type="button"
                  >
                    {pendingId === order._id ? "Updating..." : "Pick Up Package"}
                  </button>
                )}
                {order.deliveryStatus === "PICKED_UP" && (
                  <button
                    disabled={pendingId !== null}
                    onClick={() => updateDelivery(order, "IN_TRANSIT")}
                    type="button"
                  >
                    {pendingId === order._id ? "Updating..." : "In Transit"}
                  </button>
                )}
                {order.deliveryStatus === "IN_TRANSIT" && (
                  <button
                    disabled={pendingId !== null}
                    onClick={() => updateDelivery(order, "DELIVERED")}
                    type="button"
                  >
                    {pendingId === order._id ? "Updating..." : "Mark as Delivered"}
                  </button>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
