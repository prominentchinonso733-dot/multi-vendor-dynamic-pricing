/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { API_BASE_URL } from "../api";

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

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

export default function CartDrawer({
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

  useEffect(() => {
    if (user?.email) setBuyerEmail(user.email);
  }, [user?.email]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const subtotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const escrowFee = subtotal > 0 ? Math.round(subtotal * 0.025 * 100) / 100 : 0;
  const grandTotal = subtotal + escrowFee;

  const handleInitiateEscrow = async () => {
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
        amount: Math.round(Number(contract.totalHoldAmount) * 100),
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
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        zIndex: 9999,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        style={{
          width: "400px",
          maxWidth: "100vw",
          height: "90vh",
          maxHeight: "90vh",
          boxSizing: "border-box",
          backgroundColor: "#fff",
          padding: "28px 24px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          lineHeight: 1.5,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          <div className="flex justify-between items-center gap-4 pb-4 border-b">
            <h2 className="min-w-0 flex-1 text-xl font-bold leading-tight">
              Escrow Shopping Cart
            </h2>
            <button
              aria-label="Close cart"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 font-bold text-xl transition hover:border-gray-500 hover:bg-gray-100 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              type="button"
              style={{ flexShrink: 0, marginTop: "2px", marginRight: "4px" }}
            >
              ✕
            </button>
          </div>

          {cart.length === 0 ? (
            <p className="text-center text-gray-500 my-12">
              Your cart is empty.
            </p>
          ) : (
            <div
              aria-label="Cart items"
              className="mt-4 max-h-[35vh] space-y-4 overflow-y-auto"
              style={{
                flex: "0 1 auto",
                minHeight: 0,
                maxHeight: "35vh",
                overflowY: "auto",
                backgroundColor: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "12px",
              }}
            >
              {cart.map((item) => (
                <div
                  key={item.id}
                  className="flex justify-between items-center border-b pb-3"
                >
                  <div>
                    <h4 className="font-semibold text-sm">{item.name}</h4>
                    <p className="text-xs text-gray-500">
                      Vendor: {item.vendor}
                    </p>
                    <p className="text-sm font-bold text-blue-600 mt-1">
                      ₦ {(item.price * item.quantity).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onUpdateQuantity(item.id, -1)}
                      className="px-2 py-1 bg-gray-200 rounded font-bold text-xs"
                    >
                      -
                    </button>
                    <span className="text-sm font-semibold">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => onUpdateQuantity(item.id, 1)}
                      className="px-2 py-1 bg-gray-200 rounded font-bold text-xs"
                    >
                      +
                    </button>
                    <button
                      aria-label={`Remove ${item.name} from cart`}
                      onClick={() => onRemoveItem(item.id)}
                      className="text-red-500 text-xs ml-2 hover:underline"
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div
            className="border-t pt-4 mt-6"
            style={{
              flexShrink: 0,
              paddingBottom: "24px",
              backgroundColor: "#fff",
            }}
          >
            <div
              className="text-sm py-1"
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "8px",
              }}
            >
              <span>Subtotal</span>
              <span>₦ {subtotal.toLocaleString()}</span>
            </div>
            <div
              className="text-sm py-1 text-gray-600"
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "8px",
              }}
            >
              <span>Estimated buyer escrow fee (2.5%)</span>
              <span>₦ {escrowFee.toLocaleString()}</span>
            </div>
            <div
              className="text-lg font-bold py-2 border-t mt-2"
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "8px",
              }}
            >
              <span>Estimated total (server-confirmed)</span>
              <span className="text-blue-600">
                ₦ {grandTotal.toLocaleString()}
              </span>
            </div>

            {checkoutMessage && (
              <div
                className="p-3 mt-4 border text-center text-sm font-semibold"
                role="status"
                style={{ background: "#eff6ff", borderColor: "#bfdbfe" }}
              >
                {checkoutMessage}
              </div>
            )}
            {user?.role === "BUYER" && (
              <p style={{ fontSize: "0.85rem", lineHeight: 1.5 }}>
                Vendor platform commission depends on the seller&apos;s approved
                tier. Checkout validates product prices, stock, and transaction
                limits on the server.
              </p>
            )}
            <div style={{ display: "grid", gap: "16px", marginTop: "16px" }}>
              <label
                htmlFor="paystack-buyer-email"
                className="text-sm font-semibold"
              >
                Receipt email
              </label>
              <input
                id="paystack-buyer-email"
                autoComplete="email"
                type="email"
                required
                readOnly
                value={buyerEmail}
                placeholder="you@example.com"
                style={{
                  height: "44px",
                  padding: "0 10px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  marginBottom: "4px",
                  boxSizing: "border-box",
                }}
              />
              <label
                htmlFor="delivery-address"
                className="text-sm font-semibold"
              >
                Delivery address
              </label>
              <textarea
                id="delivery-address"
                autoComplete="street-address"
                maxLength={500}
                minLength={5}
                onChange={(event) => setDeliveryAddress(event.target.value)}
                required
                rows={3}
                value={deliveryAddress}
                style={{
                  height: "96px",
                  padding: "10px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  marginBottom: "4px",
                  boxSizing: "border-box",
                  lineHeight: 1.5,
                  resize: "vertical",
                }}
              />
              <label htmlFor="delivery-phone" className="text-sm font-semibold">
                Customer phone
              </label>
              <input
                id="delivery-phone"
                autoComplete="tel"
                maxLength={30}
                minLength={7}
                onChange={(event) => setCustomerPhone(event.target.value)}
                required
                type="tel"
                value={customerPhone}
                style={{
                  height: "44px",
                  padding: "0 10px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  marginBottom: "4px",
                  boxSizing: "border-box",
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  gap: "8px",
                  marginTop: "8px",
                }}
              >
                <button
                  onClick={handleInitiateEscrow}
                  disabled={checkoutPending}
                  className="flex-1 w-full py-3 rounded-lg font-bold text-white transition bg-blue-600 hover:bg-blue-700"
                  style={{ flex: 1 }}
                >
                  {checkoutPending
                    ? "Preparing Paystack..."
                    : "Lock funds in escrow"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
