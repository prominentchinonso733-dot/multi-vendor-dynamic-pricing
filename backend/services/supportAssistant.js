const categories = [
  {
    name: "ORDER_DISPUTE",
    pattern:
      /refund|return|dispute|damaged|wrong item|missing item|not received|never arrived|chargeback/i,
  },
  {
    name: "ORDER_TRACKING",
    pattern: /track|where is my order|order status|delivery status/i,
  },
  {
    name: "SHIPPING",
    pattern: /shipping|ship|delivery|rider|pickup|arrive/i,
  },
  {
    name: "VENDOR_PAYOUT",
    pattern: /payout|withdraw|transfer|bank account|available balance/i,
  },
  {
    name: "VENDOR_SUBSCRIPTION",
    pattern: /subscription|monthly plan|tier|renew|billing|paystack plan/i,
  },
  {
    name: "VENDOR_SETUP",
    pattern:
      /store setup|store settings|vendor account|seller account|onboard/i,
  },
  {
    name: "PRODUCT_LISTING",
    pattern: /product|listing|publish|image upload|inventory|stock/i,
  },
  {
    name: "DYNAMIC_PRICING",
    pattern: /price|pricing|demand|price floor|price ceiling/i,
  },
  {
    name: "FEES_AND_COMMISSIONS",
    pattern: /commission|platform fee|escrow fee|seller fee/i,
  },
];

const redactSensitiveValues = (value) =>
  value
    .replace(
      /\b(password|passcode|token|api key)\s*[:=]\s*\S+/gi,
      "$1: [redacted]",
    )
    .replace(/\b\d{10,16}\b/g, "[redacted number]");

const classifySupportRequest = (message) => {
  const normalized = message.trim();
  const matched = categories.find(({ pattern }) => pattern.test(normalized));
  const isVendor = /vendor|seller|store|listing|payout|commission/i.test(
    normalized,
  );
  const isDispute = matched?.name === "ORDER_DISPUTE";
  const category =
    isDispute && isVendor ? "VENDOR_DISPUTE" : matched?.name || "GENERAL";
  const summary = redactSensitiveValues(normalized)
    .replace(/\s+/g, " ")
    .slice(0, 320);
  const priority = /fraud|unsafe|safety|unauthorized|threat/i.test(normalized)
    ? "HIGH"
    : isDispute
      ? "NORMAL"
      : "LOW";

  return {
    audience: isVendor ? "VENDOR" : "BUYER_OR_GENERAL",
    category,
    priority,
    summary,
    ticketDraft: isDispute
      ? {
          subject: `${category === "VENDOR_DISPUTE" ? "Vendor" : "Buyer"} dispute: ${summary.slice(0, 90)}`,
          category,
          priority,
          status: "DRAFT",
          summary,
          requiredInformation:
            category === "VENDOR_DISPUTE"
              ? [
                  "Store name",
                  "Order or transaction reference",
                  "Issue and relevant dates",
                ]
              : [
                  "Order reference",
                  "Item or delivery issue",
                  "Relevant dates and supporting details",
                ],
          nextStep:
            category === "VENDOR_DISPUTE"
              ? "Submit this draft through vendor support for review."
              : "Raise the dispute from the relevant order in My Orders.",
          note: "Draft only. No ticket, order, payout, or refund action has been submitted.",
        }
      : null,
  };
};

const staticReplies = {
  ORDER_DISPUTE:
    "Payments remain in escrow until delivery is confirmed. Open the order in My Orders and raise a dispute for a missing, damaged, incorrect, or late item. An admin reviews the case; a recorded refund decision may still need to be completed and reconciled in Paystack.",
  VENDOR_DISPUTE:
    "I prepared a dispute summary below. It is only a draft; submit it through vendor support for review. Include your store name and the order or transaction reference, but do not share passwords or full bank details.",
  ORDER_TRACKING:
    "Sign in and open My Orders to check the latest order and delivery status. Payments remain in escrow until delivery is confirmed. If the order has not arrived or its status seems wrong, raise a dispute from that order for admin review.",
  SHIPPING:
    "Check My Orders for the latest fulfillment and delivery status. Vendors mark orders as shipped, then the assigned rider confirms pickup and delivery. Contact support from the order if the shipment is delayed or missing.",
  VENDOR_PAYOUT:
    "Vendor proceeds become available after the buyer confirms receipt. Request a withdrawal from your available balance to your verified payout account in the vendor dashboard. There is no fixed weekly or monthly payout schedule configured: Paystack processes each requested transfer, which can remain pending or require authorization until a provider update confirms its status.",
  VENDOR_SUBSCRIPTION:
    "Tier 1 Basic is $5 per month and Tier 2 Verified is $10 per month. Paystack charges the NGN equivalent using the marketplace's configured NGN-per-USD rate and manages monthly renewals. Keep the plan active and complete the tier's eligibility checks to list products. Tier 2's verified badge and higher financial limits require approved identity review.",
  VENDOR_SETUP:
    "Register as a seller, complete Store Settings, and activate a monthly Paystack tier. Tier 1 requires its bank and identity soft-check; Tier 2 requires approved identity review for its verified status. An active, eligible tier is required before listing products. For account-specific onboarding status, sign in and check the vendor dashboard.",
  PRODUCT_LISTING:
    "Eligible vendors can add a product from the vendor dashboard with a title, base price, non-negative whole-number stock, and price floor and ceiling; description, category, demand score, and competitor price are optional. Images may be JPEG, PNG, or WebP up to 5 MB. New listings default to approved, active, and published, and their calculated prices remain within the configured floor and ceiling.",
  DYNAMIC_PRICING:
    "The marketplace adjusts a listing price using its base price, demand score, available stock, and units ordered in the previous 24 hours. Low stock and recent orders can raise adjusted demand; high stock can lower it. The result is rounded to two decimal places and clamped to the vendor's price floor and ceiling.",
  FEES_AND_COMMISSIONS:
    "Tier 1 vendor commission is 10%, and Tier 2 commission is 5% after approved identity review. The buyer escrow fee is 2.5% of the server-calculated order subtotal. Twenty percent of a positive stock- or order-driven price uplift is recorded separately as a demand-surge platform share; it is pending until escrow release and reversed on refund.",
  GENERAL:
    "I can help with order tracking, shipping, returns and disputes, vendor setup, subscriptions, payouts, commissions, product listings, and dynamic pricing. Buyer/vendor disputes can be categorized and formatted as a draft for follow-up; drafts do not submit tickets or issue refunds. For account-specific details, sign in and use the relevant order or vendor dashboard.",
};

const SUPPORT_KNOWLEDGE_BASE = Object.entries(staticReplies)
  .map(([category, answer]) => `${category}: ${answer}`)
  .join("\n");

const getStaticSupportReply = (category) =>
  staticReplies[category] || staticReplies.GENERAL;

module.exports = {
  SUPPORT_KNOWLEDGE_BASE,
  classifySupportRequest,
  getStaticSupportReply,
};
