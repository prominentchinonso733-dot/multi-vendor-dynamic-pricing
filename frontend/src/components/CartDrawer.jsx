/* eslint-disable react/prop-types */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { API_BASE_URL } from "../api";
import "./CartDrawer.css";

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const loadPaystackInline = () => {
  if (window.PaystackPop) return Promise.resolve(window.PaystackPop);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.paystack.co/v1/inline.js";
    script.async = true;
    script.onload = () => {
      if (window.PaystackPop) {
        resolve(window.PaystackPop);
      } else {
        reject(new Error("Unable to load Paystack checkout."));
      }
    };
    script.onerror = () =>
      reject(new Error("Unable to load Paystack checkout."));
    document.body.appendChild(script);
  });
};

export default function CartAndCheckoutDrawer({
  isOpen,
  onClose,
  cart,
  onUpdateQuantity,
  onRemoveItem,
  buyerId,
  onPaymentVerified,
}) {
  const { authFetch, user } = useAuth();
  const [buyerEmail, setBuyerEmail] = useState(user?.email || "");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [customerPhone, setCustomerPhone] = useState(user?.phone || "");
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [serverTotals, setServerTotals] = useState(null);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimer = useRef(null);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 180);
  }, [isClosing, onClose]);

  useEffect(() => {
    if (user?.email) setBuyerEmail(user.email);
  }, [user?.email]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") handleClose();
    };

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleClose]);

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const cartSignature = cart
    .map((item) => `${item.id || item._id}:${item.quantity}:${item.price}`)
    .join("|");

  useEffect(() => {
    setServerTotals(null);
  }, [cartSignature]);

  if (!isOpen) return null;

  const subtotal = cart.reduce(
    (sum, item) =>
      sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0,
  );
  const estimatedEscrowFee =
    subtotal > 0 ? Math.round(subtotal * 0.025 * 100) / 100 : 0;

  const handleInitiateEscrow = async (event) => {
    event.preventDefault();
    if (checkoutPending) return;

    if (user?.role !== "BUYER" || !buyerId) {
      setCheckoutMessage("Sign in to a customer account before checking out.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail.trim())) {
      setCheckoutMessage(
        "Enter a valid email address for your Paystack receipt.",
      );
      return;
    }
    if (!PAYSTACK_PUBLIC_KEY) {
      setCheckoutMessage(
        "Paystack is not configured. Set VITE_PAYSTACK_PUBLIC_KEY in the frontend environment.",
      );
      return;
    }

    try {
      setCheckoutPending(true);
      setCheckoutMessage("Preparing secure payment...");
      setServerTotals(null);
      const sellerIds = [
        ...new Set(
          cart
            .map(
              (item) =>
                item.sellerId || item.vendorId || item.vendor?._id || "",
            )
            .filter((id) => /^[a-f\d]{24}$/i.test(String(id))),
        ),
      ];

      const response = await authFetch(`${API_BASE_URL}/escrow/lock-funds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerId,
          buyerEmail: buyerEmail.trim(),
          deliveryAddress: deliveryAddress.trim(),
          customerPhone: customerPhone.trim(),
          sellerIds,
          items: cart,
          subtotal,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Unable to create escrow order.",
        );
      }

      const contract = data.contract;
      const confirmedSubtotal = Number(contract?.subtotal);
      const confirmedFee = Number(contract?.vaultFee);
      const confirmedTotal = Number(contract?.totalHoldAmount);
      if (
        !contract?.paymentReference ||
        !Number.isFinite(confirmedSubtotal) ||
        !Number.isFinite(confirmedFee) ||
        !Number.isFinite(confirmedTotal)
      ) {
        throw new Error("The server returned an invalid escrow total.");
      }
      setServerTotals({
        subtotal: confirmedSubtotal,
        fee: confirmedFee,
        total: confirmedTotal,
      });

      const PaystackPop = await loadPaystackInline();
      let paymentCompleted = false;
      const handlePaystackSuccess = function (payment) {
        if (!payment || payment.reference !== contract.paymentReference) {
          setCheckoutMessage("Payment reference did not match this order.");
          return;
        }
        paymentCompleted = true;
        setCheckoutMessage("Payment received. Verifying transaction...");

        void (async () => {
          try {
            const verifyResponse = await authFetch(
              `${API_BASE_URL}/escrow/verify`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reference: payment.reference }),
              },
            );
            const verifyData = await verifyResponse.json();

            if (!verifyResponse.ok || !verifyData.success) {
              throw new Error(
                verifyData.message || "Unable to verify Paystack payment.",
              );
            }

            setCheckoutMessage("Payment verified. Funds are held in escrow.");
            onPaymentVerified?.(verifyData.contract);
          } catch (error) {
            setCheckoutMessage(
              error.message || "Unable to verify Paystack payment.",
            );
          }
        })();
      };
      const checkout = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: buyerEmail.trim(),
        amount: Math.round(confirmedTotal * 100),
        currency: "NGN",
        ref: contract.paymentReference,
        metadata: {
          order_id: contract._id,
          buyer_email: buyerEmail.trim().toLowerCase(),
          seller_id: sellerIds[0] || null,
          seller_ids: sellerIds,
        },
        callback: handlePaystackSuccess,
        onClose: () => {
          if (!paymentCompleted) {
            setCheckoutMessage(
              "Payment window closed. This order is still awaiting payment.",
            );
          }
        },
      });
      setCheckoutMessage("Complete payment in the Paystack window.");
      checkout.openIframe();
    } catch (error) {
      console.error("Escrow API Error:", error);
      setCheckoutMessage(error.message || "Could not start Paystack checkout.");
    } finally {
      setCheckoutPending(false);
    }
  };

  return (
    <div
      className={`cart-drawer__backdrop${isClosing ? " is-closing" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <aside
        aria-labelledby="cart-drawer-title"
        aria-modal="true"
        className="cart-drawer"
        role="dialog"
      >
        <header className="cart-drawer__header">
          <div>
            <p className="cart-drawer__eyebrow">Secure checkout</p>
            <h2 id="cart-drawer-title">Your cart</h2>
          </div>
          <button
            aria-label="Leave or close cart"
            className="cart-drawer__leave"
            onClick={handleClose}
            type="button"
          >
            Leave / Close
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <main className="cart-drawer__content">
          {cart.length === 0 ? (
            <p className="cart-drawer__empty">Your cart is empty.</p>
          ) : (
            <>
              <section aria-label="Cart items" className="cart-drawer__items">
                <h3>Items ({cart.length})</h3>
                <ul>
                  {cart.map((item) => (
                    <li
                      className="cart-drawer__item"
                      key={item.id || item._id}
                    >
                      <div className="cart-drawer__item-info">
                        <h4>{item.name}</h4>
                        <p>
                          Quantity: {item.quantity} ·{" "}
                          {currencyFormatter.format(Number(item.price) || 0)}{" "}
                          each
                        </p>
                        <strong>
                          {currencyFormatter.format(
                            (Number(item.price) || 0) *
                              (Number(item.quantity) || 0),
                          )}
                        </strong>
                      </div>
                      <div className="cart-drawer__item-actions">
                        <button
                          aria-label={`Decrease ${item.name} quantity`}
                          onClick={() => onUpdateQuantity(item.id, -1)}
                          type="button"
                        >
                          −
                        </button>
                        <button
                          aria-label={`Increase ${item.name} quantity`}
                          onClick={() => onUpdateQuantity(item.id, 1)}
                          type="button"
                        >
                          +
                        </button>
                        <button
                          className="cart-drawer__remove"
                          onClick={() => onRemoveItem(item.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section
                aria-label="Order summary"
                className="cart-drawer__summary"
              >
                <h3>Order summary</h3>
                <dl>
                  <div>
                    <dt>Subtotal</dt>
                    <dd>{currencyFormatter.format(subtotal)}</dd>
                  </div>
                  <div>
                    <dt>Estimated buyer escrow fee (2.5%)</dt>
                    <dd>{currencyFormatter.format(estimatedEscrowFee)}</dd>
                  </div>
                  <div className="cart-drawer__total">
                    <dt>Final server-confirmed total</dt>
                    <dd>
                      {serverTotals
                        ? currencyFormatter.format(serverTotals.total)
                        : "Confirmed at checkout"}
                    </dd>
                  </div>
                </dl>
                {serverTotals && (
                  <p className="cart-drawer__confirmed">
                    Server-calculated subtotal{" "}
                    {currencyFormatter.format(serverTotals.subtotal)} and fee{" "}
                    {currencyFormatter.format(serverTotals.fee)}.
                  </p>
                )}
              </section>

              <p className="cart-drawer__note">
                Checkout validates current product prices, stock, and totals on
                the server. Funds are held in escrow until delivery is
                confirmed.
              </p>

              {user?.role === "BUYER" ? (
                <form
                  className="cart-drawer__checkout"
                  onSubmit={handleInitiateEscrow}
                >
                  <label htmlFor="paystack-buyer-email">Receipt email</label>
                  <input
                    autoComplete="email"
                    id="paystack-buyer-email"
                    readOnly
                    required
                    type="email"
                    value={buyerEmail}
                  />

                  <label htmlFor="delivery-address">Delivery address</label>
                  <textarea
                    autoComplete="street-address"
                    id="delivery-address"
                    maxLength={500}
                    minLength={5}
                    onChange={(event) => setDeliveryAddress(event.target.value)}
                    required
                    rows={3}
                    value={deliveryAddress}
                  />

                  <label htmlFor="delivery-phone">Customer phone</label>
                  <input
                    autoComplete="tel"
                    id="delivery-phone"
                    maxLength={30}
                    minLength={7}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                    required
                    type="tel"
                    value={customerPhone}
                  />

                  {checkoutMessage && (
                    <p className="cart-drawer__status" role="status">
                      {checkoutMessage}
                    </p>
                  )}
                  <button
                    className="cart-drawer__checkout-button"
                    disabled={checkoutPending}
                    type="submit"
                  >
                    {checkoutPending
                      ? "Preparing secure payment..."
                      : "Lock funds in escrow"}
                  </button>
                </form>
              ) : (
                <p className="cart-drawer__status" role="status">
                  Sign in to a customer account to check out.
                </p>
              )}
            </>
          )}
        </main>

        <footer className="cart-drawer__footer">
          <button
            className="cart-drawer__back"
            onClick={handleClose}
            type="button"
          >
            Back to Store
          </button>
        </footer>
      </aside>
    </div>
  );
}
