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
  isKycVerified,
  setIsKycVerified,
  onPaymentVerified,
}) {
  const { user } = useAuth();
  const [buyerEmail, setBuyerEmail] = useState(user?.email || "");
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [checkoutPending, setCheckoutPending] = useState(false);

  useEffect(() => {
    if (user?.email) setBuyerEmail(user.email);
  }, [user?.email]);

  if (!isOpen) return null;

  const subtotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const escrowFee = subtotal > 0 ? Math.round(subtotal * 0.025) : 0; // 2.5% Escrow Protection Fee
  const grandTotal = subtotal + escrowFee;

  const handleInitiateEscrow = async () => {
    if (!isKycVerified) {
      alert(
        "KYC Verification Required: Please complete 4-Way KYC verification before initiating an escrow contract.",
      );
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

      const response = await fetch(`${API_BASE_URL}/escrow/lock-funds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerId,
          buyerEmail: buyerEmail.trim(),
          sellerIds,
          items: cart,
          subtotal,
          isKycVerified,
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
            const verifyResponse = await fetch(
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

            setCheckoutMessage("Payment verified. Funds are locked in escrow.");
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
          height: "100vh",
          maxHeight: "100%",
          boxSizing: "border-box",
          backgroundColor: "#fff",
          padding: "24px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
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
          <div className="flex justify-between items-center pb-4 border-b">
            <h2 className="text-xl font-bold">Escrow Shopping Cart</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-black font-bold text-xl"
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
              className="mt-4 space-y-4"
              style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
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
                      onClick={() => onRemoveItem(item.id)}
                      className="text-red-500 text-xs ml-2 hover:underline"
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
            style={{ flexShrink: 0, paddingBottom: "24px" }}
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
              <span>Escrow Vault Fee (2.5%)</span>
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
              <span>Total Hold Amount</span>
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
            <div style={{ display: "grid", gap: "8px", marginTop: "16px" }}>
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
                value={buyerEmail}
                onChange={(event) => setBuyerEmail(event.target.value)}
                placeholder="you@example.com"
                style={{
                  minHeight: "42px",
                  padding: "0 10px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
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
                  disabled={checkoutPending || !isKycVerified}
                  className={`flex-1 w-full py-3 rounded-lg font-bold text-white transition ${
                    isKycVerified
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-gray-400 cursor-not-allowed"
                  }`}
                  style={{ flex: 1 }}
                >
                  {checkoutPending
                    ? "Preparing Paystack..."
                    : isKycVerified
                      ? "Lock Funds in Escrow"
                      : "KYC Required to Lock Funds"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsKycVerified((verified) => !verified)}
                  aria-pressed={isKycVerified}
                  title="Temporary development control"
                  style={{
                    padding: "0 10px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    backgroundColor: "#f8fafc",
                    color: "#475569",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isKycVerified ? "Reset Dev KYC" : "Dev: Verify KYC"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
