import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { getApiErrorMessage } from "../api";
import { adminService } from "../services/adminService";
import "./AdminDashboard.css";

const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
});
const sections = [
  ["overview", "Overview"],
  ["vendors", "Vendors"],
  ["orders", "Orders"],
  ["accounts", "User accounts"],
  ["delivery", "Delivery & riders"],
  ["verification", "Identity review"],
];
const formatDate = (date) =>
  date ? dateFormatter.format(new Date(date)) : "—";
const displayStatus = (value) => String(value || "UNKNOWN").replaceAll("_", " ");

function PageControls({ page, total, pageSize, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="admin-dashboard__pagination">
      <span>
        Page {page} of {pages} · {total.toLocaleString()} records
      </span>
      <div>
        <button disabled={page <= 1} onClick={() => onChange(page - 1)} type="button">
          Previous
        </button>
        <button disabled={page >= pages} onClick={() => onChange(page + 1)} type="button">
          Next
        </button>
      </div>
    </div>
  );
}

PageControls.propTypes = {
  page: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  pageSize: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default function AdminDashboard() {
  const [section, setSection] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [pendingVerifications, setPendingVerifications] = useState([]);
  const [usersPage, setUsersPage] = useState(1);
  const [ordersPage, setOrdersPage] = useState(1);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [reviewNotes, setReviewNotes] = useState({});
  const [identityChecks, setIdentityChecks] = useState({});
  const [riderDraft, setRiderDraft] = useState({
    name: "",
    email: "",
    password: "",
  });
  const usersRole =
    section === "vendors"
      ? "vendors"
      : section === "delivery"
        ? "riders"
        : "accounts";

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      adminService.getOverview(
        { usersPage, ordersPage, usersRole },
        { signal: controller.signal },
      ),
      adminService.getPendingVerifications({ signal: controller.signal }),
    ])
      .then(([data, verificationQueue]) => {
        if (!data?.success || !Array.isArray(data.users) || !Array.isArray(data.orders)) {
          throw new Error("The admin API returned invalid oversight data.");
        }
        setOverview(data);
        setPendingVerifications(verificationQueue);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(getApiErrorMessage(loadError, "Unable to load admin data."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [usersPage, ordersPage, refreshVersion, usersRole]);

  const users = overview?.users || [];
  const orders = overview?.orders || [];
  const riders = users.filter((user) => user.role === "DELIVERY_PARTNER");
  const displayedVendors = users.filter((user) => user.role === "SELLER");
  const displayedAccounts = users.filter((user) => user.role !== "DELIVERY_PARTNER");
  const pageSize = overview?.pagination?.pageSize || 100;

  const runAction = async (action, successMessage) => {
    setPendingAction(action.key);
    setError("");
    setNotice("");
    try {
      await action.run();
      setNotice(successMessage);
      setRefreshVersion((version) => version + 1);
      return true;
    } catch (actionError) {
      setError(getApiErrorMessage(actionError, "The admin action failed."));
      return false;
    } finally {
      setPendingAction("");
    }
  };

  const changeAccountStatus = (user) =>
    runAction(
      {
        key: `account-${user._id}`,
        run: () =>
          adminService.updateAccountStatus(
            user._id,
            user.accountStatus === "SUSPENDED" ? "ACTIVE" : "SUSPENDED",
          ),
      },
      `${user.name}'s account status was updated.`,
    );

  const reviewIdentity = (user, decision) =>
    runAction(
      {
        key: `verification-${user._id}`,
        run: () =>
          adminService.reviewVerification(
            user._id,
            decision,
            reviewNotes[user._id] || "",
            identityChecks[user._id] === true,
          ),
      },
      `Identity request ${decision === "APPROVE" ? "approved" : "rejected"}.`,
    );

  const createRider = async (event) => {
    event.preventDefault();
    const success = await runAction(
      {
        key: "create-rider",
        run: () => adminService.createRider(riderDraft),
      },
      "Delivery partner account created.",
    );
    if (success) setRiderDraft({ name: "", email: "", password: "" });
  };

  const assignRider = (orderId, riderId) =>
    runAction(
      {
        key: `assign-${orderId}`,
        run: () => adminService.assignRider(orderId, riderId),
      },
      "Delivery assignment updated.",
    );

  const renderUsers = (records) => (
    <>
      <div className="admin-dashboard__table-wrap">
        <table className="admin-dashboard__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Verification</th>
              <th>Account</th>
              <th>Joined</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {records.length ? records.map((user) => (
              <tr key={user._id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{displayStatus(user.role)}</td>
                <td>{user.verification?.tier || "TIER 1"} · {displayStatus(user.verification?.status || "NOT_STARTED")}</td>
                <td>{displayStatus(user.accountStatus || "ACTIVE")}</td>
                <td>{formatDate(user.createdAt)}</td>
                <td>
                  <button
                    className="admin-dashboard__text-button"
                    disabled={pendingAction === `account-${user._id}`}
                    onClick={() => changeAccountStatus(user)}
                    type="button"
                  >
                    {user.accountStatus === "SUSPENDED" ? "Reactivate" : "Suspend"}
                  </button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan="7">No accounts on this page.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <PageControls
        onChange={setUsersPage}
        page={overview?.pagination?.usersPage || usersPage}
        pageSize={pageSize}
        total={overview?.pagination?.usersTotal ?? 0}
      />
    </>
  );

  const renderOrders = () => (
    <>
      <div className="admin-dashboard__table-wrap">
        <table className="admin-dashboard__table">
          <thead>
            <tr>
              <th>Order reference</th>
              <th>Buyer</th>
              <th>Items</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Fulfillment</th>
              <th>Rider</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {orders.length ? orders.map((order) => {
              const riderId =
                typeof order.deliveryPartnerId === "object"
                  ? order.deliveryPartnerId?._id
                  : order.deliveryPartnerId;
              const riderName =
                typeof order.deliveryPartnerId === "object"
                  ? order.deliveryPartnerId?.name
                  : "";
              return (
                <tr key={order._id}>
                  <td>{order.paymentReference}</td>
                  <td>{order.buyerEmail || order.buyerId}</td>
                  <td>{(order.items || []).map((item) => `${item.name} ×${item.quantity}`).join(", ") || "—"}</td>
                  <td>{currencyFormatter.format(Number(order.totalHoldAmount) || 0)}</td>
                  <td>{displayStatus(order.status)}</td>
                  <td>{(order.fulfillmentStatuses || []).map((entry) => displayStatus(entry.status)).join(", ") || "Pending"}</td>
                  <td>
                    <select
                      aria-label={`Assign delivery partner for ${order.paymentReference}`}
                      disabled={pendingAction === `assign-${order._id}`}
                      onChange={(event) => assignRider(order._id, event.target.value)}
                      value={riderId || ""}
                    >
                      <option value="">Unassigned</option>
                      {riders
                        .filter(
                          (rider) =>
                            rider.accountStatus !== "SUSPENDED" ||
                            rider._id === String(riderId || ""),
                        )
                        .map((rider) => (
                          <option key={rider._id} value={rider._id}>
                            {rider.name}
                            {rider.accountStatus === "SUSPENDED"
                              ? " (suspended)"
                              : ""}
                          </option>
                        ))}
                      {riderName && !riders.some((rider) => rider._id === riderId) && (
                        <option value={riderId}>{riderName}</option>
                      )}
                    </select>
                  </td>
                  <td>{formatDate(order.createdAt)}</td>
                </tr>
              );
            }) : (
              <tr><td colSpan="8">No orders on this page.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <PageControls
        onChange={setOrdersPage}
        page={overview?.pagination?.ordersPage || ordersPage}
        pageSize={pageSize}
        total={overview?.pagination?.ordersTotal ?? 0}
      />
      {overview?.pagination?.ordersTotal > 0 && (
        <p className="admin-dashboard__hint">Order oversight includes escrow payment and per-vendor fulfillment status. Rider assignment is tracked separately.</p>
      )}
    </>
  );

  const renderVerificationQueue = () => (
    <div className="admin-dashboard__review-list">
      {pendingVerifications.length ? pendingVerifications.map((user) => (
        <article className="admin-dashboard__review-card" key={user._id}>
          <div className="admin-dashboard__review-header">
            <div>
              <h3>{user.name}</h3>
              <p>{user.email} · {displayStatus(user.role)} · submitted {formatDate(user.verification?.submittedAt)}</p>
            </div>
            <span className="admin-dashboard__status admin-dashboard__status--pending">Pending review</span>
          </div>
          <dl>
            <div><dt>Legal name</dt><dd>{user.verification?.legalName || "—"}</dd></div>
            <div><dt>Document type</dt><dd>{displayStatus(user.verification?.documentType)}</dd></div>
          </dl>
          <label>
            Review note (optional)
            <input
              maxLength={500}
              onChange={(event) => setReviewNotes((current) => ({ ...current, [user._id]: event.target.value }))}
              value={reviewNotes[user._id] || ""}
            />
          </label>
          <p className="admin-dashboard__hint">Approve only after completing the identity check through the organization&apos;s approved external process.</p>
          <label className="admin-dashboard__identity-confirmation">
            <input
              checked={identityChecks[user._id] === true}
              onChange={(event) => setIdentityChecks((current) => ({ ...current, [user._id]: event.target.checked }))}
              type="checkbox"
            />
            I confirm the applicant&apos;s identity was checked through the approved process.
          </label>
          <div className="admin-dashboard__review-actions">
            <button disabled={pendingAction === `verification-${user._id}` || identityChecks[user._id] !== true} onClick={() => reviewIdentity(user, "APPROVE")} type="button">Approve Tier 2</button>
            <button className="admin-dashboard__reject" disabled={pendingAction === `verification-${user._id}`} onClick={() => reviewIdentity(user, "REJECT")} type="button">Reject</button>
          </div>
        </article>
      )) : <p className="admin-dashboard__empty">No identity requests are waiting for review.</p>}
    </div>
  );

  return (
    <section aria-labelledby="admin-dashboard-title" className="admin-dashboard">
      <header className="admin-dashboard__header">
        <div>
          <p className="admin-dashboard__eyebrow">MARKETPLACE OPERATIONS</p>
          <h1 id="admin-dashboard-title">Master admin</h1>
          <p>Platform-wide vendor, order, account, verification and delivery oversight.</p>
          <Link className="admin-dashboard__escrow-link" to="/admin/escrow">
            Open escrow dispute operations
          </Link>
        </div>
        <button
          className="admin-dashboard__refresh"
          disabled={loading}
          onClick={() => setRefreshVersion((version) => version + 1)}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} /> Refresh
        </button>
      </header>

      {error && <p className="admin-dashboard__message admin-dashboard__message--error" role="alert"><AlertCircle size={18} /> {error}</p>}
      {notice && <p className="admin-dashboard__message admin-dashboard__message--success" role="status"><CheckCircle2 size={18} /> {notice}</p>}

      {overview?.summary && (
        <div className="admin-dashboard__stats">
          {[
            ["Vendors", overview.summary.vendorCount],
            ["Customers", overview.summary.customerCount],
            ["Delivery partners", overview.summary.riderCount],
            ["Products", overview.summary.productCount],
            ["Marketplace orders", overview.summary.orderCount],
            ["Pending identity reviews", overview.summary.pendingVerificationCount],
          ].map(([label, count]) => (
            <article key={label}><span>{label}</span><strong>{Number(count).toLocaleString()}</strong></article>
          ))}
        </div>
      )}

      <nav aria-label="Admin dashboard sections" className="admin-dashboard__tabs">
        {sections.map(([key, label]) => (
          <button
            aria-current={section === key ? "page" : undefined}
            className={section === key ? "admin-dashboard__tab admin-dashboard__tab--active" : "admin-dashboard__tab"}
            key={key}
            onClick={() => {
              setSection(key);
              setUsersPage(1);
            }}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && !overview ? (
        <p className="admin-dashboard__empty" role="status">Loading platform oversight data...</p>
      ) : (
        <section className="admin-dashboard__content">
          {section === "overview" && (
            <div className="admin-dashboard__welcome">
              <ShieldCheck aria-hidden="true" size={32} />
              <div><h2>Platform health and access</h2><p>Use the dedicated sections to review vendors, inspect all order pages, manage customer/vendor/rider accounts, assign delivery partners and review Tier 2 requests.</p></div>
            </div>
          )}
          {section === "vendors" && renderUsers(displayedVendors)}
          {section === "accounts" && renderUsers(displayedAccounts)}
          {section === "orders" && renderOrders()}
          {section === "verification" && renderVerificationQueue()}
          {section === "delivery" && (
            <>
              <h2>Delivery partner accounts</h2>
              {renderUsers(riders)}
              <form className="admin-dashboard__rider-form" onSubmit={createRider}>
                <div><Users aria-hidden="true" size={20} /><h2>Register delivery partner</h2></div>
                <label>Name<input autoComplete="name" maxLength={120} minLength={2} onChange={(event) => setRiderDraft({ ...riderDraft, name: event.target.value })} required value={riderDraft.name} /></label>
                <label>Email<input autoComplete="email" onChange={(event) => setRiderDraft({ ...riderDraft, email: event.target.value })} required type="email" value={riderDraft.email} /></label>
                <label>Temporary password (12+ characters)<input autoComplete="new-password" minLength={12} onChange={(event) => setRiderDraft({ ...riderDraft, password: event.target.value })} required type="password" value={riderDraft.password} /></label>
                <button disabled={pendingAction === "create-rider"} type="submit">Create delivery partner</button>
              </form>
              <h2>Order delivery assignments</h2>
              {renderOrders()}
            </>
          )}
        </section>
      )}
    </section>
  );
}
