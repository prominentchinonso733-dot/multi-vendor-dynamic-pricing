import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { AlertCircle, BadgeCheck } from "lucide-react";
import { getApiErrorMessage } from "../api";
import { authService } from "../services/authService";
import "./VendorTierPlanPanel.css";

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

const loadPaystack = () => {
  if (window.PaystackPop) return Promise.resolve(window.PaystackPop);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.paystack.co/v1/inline.js";
    script.async = true;
    script.onload = () => {
      if (window.PaystackPop) resolve(window.PaystackPop);
      else reject(new Error("Unable to load Paystack checkout."));
    };
    script.onerror = () => reject(new Error("Unable to load Paystack checkout."));
    document.body.appendChild(script);
  });
};

const nairaFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 2,
});

export default function VendorTierPlanPanel({
  vendorTier,
  selectedTier,
  onTierChange,
  subscriptionStatus,
  onUpdated,
}) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    authService
      .getVendorTierPlans({ signal: controller.signal })
      .then((result) => {
        setPlans(result.plans);
        if (!result.configured) {
          setError(
            "Tier payments are not available until the marketplace configures its USD/NGN exchange rate.",
          );
        }
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(
            getApiErrorMessage(loadError, "Unable to load vendor tier prices."),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const startPayment = async () => {
    if (!PAYSTACK_PUBLIC_KEY) {
      setError(
        "Paystack is not configured. Set VITE_PAYSTACK_PUBLIC_KEY before purchasing a vendor tier.",
      );
      return;
    }

    setPending("starting");
    setError("");
    setNotice("");
    try {
      const payment = await authService.initializeVendorTierPayment(selectedTier);
      const displayedPlan = plans.find((plan) => plan.tier === selectedTier);
      if (payment.amountMinor !== displayedPlan?.amountMinor) {
        setPending("");
        setError("The tier fee changed. Reload the page to review the current price.");
        return;
      }
      const PaystackPop = await loadPaystack();
      const checkout = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: payment.email,
        amount: payment.amountMinor,
        currency: payment.currency,
        ref: payment.reference,
        callback: async (result) => {
          setPending("verifying");
          try {
            if (result?.reference !== payment.reference) {
              throw new Error("Payment reference did not match the selected tier.");
            }
            const verified = await authService.verifyVendorTierPayment(
              payment.reference,
            );
            onUpdated?.(verified);
            setNotice(
              `${verified.tier.replace("_", " ")} entry fee paid successfully.`,
            );
          } catch (verifyError) {
            setError(
              getApiErrorMessage(
                verifyError,
                "Unable to verify the vendor tier payment.",
              ),
            );
          } finally {
            setPending("");
          }
        },
        onClose: () => setPending(""),
      });
      setPending("payment");
      checkout.openIframe();
    } catch (paymentError) {
      setPending("");
      setError(
        getApiErrorMessage(paymentError, "Unable to start tier payment."),
      );
    }
  };

  const activePlan = subscriptionStatus === "ACTIVE";
  const selectedPlan = plans.find((plan) => plan.tier === selectedTier);
  const isCurrentTier = activePlan && selectedTier === vendorTier;

  return (
    <section
      aria-labelledby="vendor-tier-plan-title"
      className="vendor-tier-plan"
    >
      <header className="vendor-tier-plan__header">
        <div>
          <p className="vendor-tier-plan__eyebrow">VENDOR ONBOARDING</p>
          <h2 id="vendor-tier-plan-title">Choose your vendor tier</h2>
          <p>One-time entry fees; these are not recurring subscriptions.</p>
        </div>
        {activePlan && (
          <span className="vendor-tier-plan__active">
            <BadgeCheck aria-hidden="true" size={16} />
            {vendorTier.replace("_", " ")} active
          </span>
        )}
      </header>

      {error && (
        <p className="vendor-tier-plan__message vendor-tier-plan__message--error" role="alert">
          <AlertCircle aria-hidden="true" size={17} /> {error}
        </p>
      )}
      {notice && (
        <p className="vendor-tier-plan__message" role="status">{notice}</p>
      )}

      {loading ? (
        <p role="status">Loading vendor tier prices...</p>
      ) : (
        <>
          <div className="vendor-tier-plan__options">
            {plans.map((plan) => (
              <label
                className={`vendor-tier-plan__option${selectedTier === plan.tier ? " vendor-tier-plan__option--selected" : ""}`}
                key={plan.tier}
              >
                <input
                  checked={selectedTier === plan.tier}
                  name="vendor-tier"
                  onChange={() => onTierChange(plan.tier)}
                  type="radio"
                  value={plan.tier}
                />
                <span className="vendor-tier-plan__option-title">
                  {plan.tier.replace("_", " ")}
                </span>
                <strong>${plan.priceUSD} one-time</strong>
                <span>
                  {plan.amountNgn === null
                    ? "NGN conversion unavailable"
                    : nairaFormatter.format(plan.amountNgn)}
                </span>
                <small>
                  {plan.tier === "TIER_1"
                    ? "Basic identity soft-check required."
                    : "Photo ID upload and admin approval required."}
                </small>
              </label>
            ))}
          </div>
          {selectedPlan && selectedPlan.amountNgn !== null && (
            <p className="vendor-tier-plan__conversion">
              Paystack will charge {nairaFormatter.format(selectedPlan.amountNgn)}.
              The NGN amount uses the marketplace-configured exchange rate.
            </p>
          )}
          <button
            className="vendor-tier-plan__pay"
            disabled={
              !selectedPlan ||
              selectedPlan.amountMinor === null ||
              isCurrentTier ||
              Boolean(pending)
            }
            onClick={startPayment}
            type="button"
          >
            {pending === "starting"
              ? "Preparing secure payment..."
              : pending === "verifying"
                ? "Verifying payment..."
                : pending === "payment"
                  ? "Complete payment in Paystack"
                  : isCurrentTier
                    ? "Current tier active"
                    : `Pay $${selectedPlan?.priceUSD ?? ""} entry fee${selectedTier === "TIER_2" ? " & Submit Tier 2 Review" : ""}`}
          </button>
        </>
      )}
    </section>
  );
}

VendorTierPlanPanel.propTypes = {
  vendorTier: PropTypes.oneOf(["TIER_1", "TIER_2"]),
  selectedTier: PropTypes.oneOf(["TIER_1", "TIER_2"]).isRequired,
  onTierChange: PropTypes.func.isRequired,
  subscriptionStatus: PropTypes.string,
  onUpdated: PropTypes.func,
};
