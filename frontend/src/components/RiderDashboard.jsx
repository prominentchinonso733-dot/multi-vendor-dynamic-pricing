import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { API_BASE_URL } from "../api";
import { useAuth } from "../context/AuthContext";
import "./RiderDashboard.css";

const RiderDeliveryMap = lazy(() => import("./RiderDeliveryMap"));

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
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [seedPending, setSeedPending] = useState(false);

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
        const assignments = Array.isArray(data.contracts) ? data.contracts : [];
        setOrders(assignments);
        setSelectedOrderId((selectedId) =>
          assignments.some((order) => order._id === selectedId)
            ? selectedId
            : assignments[0]?._id || "",
        );
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
      if (status === "DELIVERED") {
        setSelectedOrderId((selectedId) =>
          selectedId === order._id
            ? orders.find((entry) => entry._id !== order._id)?._id || ""
            : selectedId,
        );
      }
      const noticeStatus = {
        ACCEPTED: "accepted",
        PICKED_UP: "picked up",
        IN_TRANSIT: "in transit",
        DELIVERED: "delivered and escrow released",
      }[status];
      setNotice(`Order ${order.paymentReference} ${noticeStatus}.`);
    } catch (updateError) {
      setError(updateError.message || "Unable to update delivery status.");
    } finally {
      setPendingId(null);
    }
  };

  const seedDelivery = async () => {
    setSeedPending(true);
    setError("");
    setNotice("");
    try {
      const response = await authFetch(`${API_BASE_URL}/escrow/rider/seed`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.contract) {
        throw new Error(data.message || "Unable to create a mock delivery.");
      }
      const order = {
        ...data.contract,
        customerName: data.contract.customerName || "Demo Customer",
        customerPhone: data.contract.customerPhone || "Not provided",
        pickupAddress: data.contract.pickupAddress || "Ikeja, Lagos",
        deliveryAddress:
          data.contract.deliveryAddress || "Lekki Phase 1, Lagos",
      };
      setOrders([order]);
      setSelectedOrderId(order._id);
      setNotice("Mock delivery created with a ₦2,500 demo escrow payout.");
    } catch (seedError) {
      setError(seedError.message || "Unable to create a mock delivery.");
    } finally {
      setSeedPending(false);
    }
  };

  const selectedOrder = orders.find(
    (order) => order._id === selectedOrderId,
  );

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

      {!loading && selectedOrder && (
        <Suspense
          fallback={
            <p className="rider-dashboard__map-loading" role="status">
              Loading Lagos delivery map...
            </p>
          }
        >
          <RiderDeliveryMap
            assignmentId={selectedOrder._id}
            destination={selectedOrder.deliveryAddress || "Customer destination"}
            pickup={selectedOrder.pickupAddress || "Vendor pickup, Lagos"}
          />
        </Suspense>
      )}

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
        <div className="rider-dashboard__empty">
          <p>You have no active delivery assignments.</p>
          <button
            disabled={seedPending}
            onClick={seedDelivery}
            type="button"
          >
            {seedPending ? "Creating mock delivery..." : "Create Mock Order / Seed Delivery"}
          </button>
        </div>
      ) : (
        <div className="rider-dashboard__orders">
          {orders.map((order) => (
            <article className="rider-dashboard__order" key={order._id}>
              <header>
                <div>
                  <span className="rider-dashboard__label">Order ID</span>
                  <strong>{order.paymentReference}</strong>
                  <small>{order._id}</small>
                </div>
                <span className="rider-dashboard__status">
                  {(order.deliveryStatus || "PENDING").replaceAll("_", " ")}
                </span>
                <button
                  aria-pressed={selectedOrderId === order._id}
                  className="rider-dashboard__map-select"
                  disabled={selectedOrderId === order._id}
                  onClick={() => setSelectedOrderId(order._id)}
                  type="button"
                >
                  {selectedOrderId === order._id ? "Showing route" : "Show route"}
                </button>
              </header>
              <dl className="rider-dashboard__customer">
                <div>
                  <dt>Customer</dt>
                  <dd>{order.customerName || "Customer"}</dd>
                </div>
                <div>
                  <dt>Delivery address</dt>
                  <dd>{order.deliveryAddress || "Address not provided"}</dd>
                </div>
                <div>
                  <dt>Customer phone</dt>
                  <dd>
                    {order.customerPhone && order.customerPhone !== "Not provided" ? (
                      <a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a>
                    ) : (
                      "Not provided"
                    )}
                  </dd>
                </div>
              </dl>
              <span className="rider-dashboard__label">Package details</span>
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
                    Number(
                      order.vendorPayouts?.reduce(
                        (sum, payout) => sum + Number(payout.netAmount || 0),
                        0,
                      ) ??
                        order.items?.reduce(
                          (sum, item) =>
                            sum +
                            Number(
                              item.vendorNetAmount ??
                                item.lineTotal ??
                                Number(item.price || 0) *
                                  Number(item.quantity || 0),
                            ),
                          0,
                        ),
                    ) || 0,
                  )}
                </span>
                {["PENDING", "ASSIGNED"].includes(order.deliveryStatus) && (
                  <button
                    disabled={pendingId !== null}
                    onClick={() => updateDelivery(order, "ACCEPTED")}
                    type="button"
                  >
                    {pendingId === order._id ? "Updating..." : "Accept Order"}
                  </button>
                )}
                {order.deliveryStatus === "ACCEPTED" && (
                  <button
                    disabled={pendingId !== null}
                    onClick={() => updateDelivery(order, "IN_TRANSIT")}
                    type="button"
                  >
                    {pendingId === order._id ? "Updating..." : "In Transit"}
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
