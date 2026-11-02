const express = require("express");
const https = require("https");
const { randomUUID } = require("crypto");
const User = require("../models/User");
const authenticateToken = require("../middleware/authenticateToken");
const { encryptSensitiveValue } = require("../services/verificationDocuments");
const {
  VENDOR_TIER_PRICES_USD,
  getVendorTierAmountMinor,
} = require("../services/vendorTiers");

const router = express.Router();

const requireSeller = (req, res, next) => {
  if (req.user.role !== "SELLER") {
    return res.status(403).json({
      success: false,
      message: "Seller role required.",
    });
  }
  return next();
};

const paystackRequest = (path, { method = "GET", body } = {}) =>
  new Promise((resolve, reject) => {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      const error = new Error("Paystack verification is not configured.");
      error.code = "PAYSTACK_NOT_CONFIGURED";
      reject(error);
      return;
    }

    const requestBody = body ? Buffer.from(JSON.stringify(body)) : null;
    const request = https.request(
      {
        hostname: "api.paystack.co",
        path,
        method,
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          Accept: "application/json",
          ...(requestBody && {
            "Content-Type": "application/json",
            "Content-Length": requestBody.length,
          }),
        },
        timeout: 10000,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          try {
            const payload = JSON.parse(responseBody);
            if (
              response.statusCode < 200 ||
              response.statusCode >= 300 ||
              payload.status !== true
            ) {
              const error = new Error(
                "Paystack could not complete bank verification.",
              );
              error.code = path.startsWith("/bank/resolve")
                ? "PAYSTACK_ACCOUNT_LOOKUP_FAILED"
                : "PAYSTACK_LOOKUP_FAILED";
              reject(error);
              return;
            }
            resolve(payload.data);
          } catch (error) {
            if (error.code === "PAYSTACK_LOOKUP_FAILED") {
              reject(error);
              return;
            }
            const invalidResponse = new Error(
              "Paystack returned an invalid response.",
            );
            invalidResponse.code = "PAYSTACK_LOOKUP_FAILED";
            reject(invalidResponse);
          }
        });
      },
    );

    request.setTimeout(10000, () => {
      const error = new Error("Paystack bank verification timed out.");
      error.code = "PAYSTACK_TRANSPORT_ERROR";
      request.destroy(error);
    });
    request.on("error", (error) => {
      if (!error.code) error.code = "PAYSTACK_TRANSPORT_ERROR";
      reject(error);
    });
    request.end(requestBody || undefined);
  });

const normalizeName = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");

const sendProviderError = (error, res) => {
  if (error.code === "PAYSTACK_NOT_CONFIGURED") {
    return res.status(503).json({
      success: false,
      message: "Bank verification is not configured. Contact support.",
    });
  }
  if (error.code === "PAYSTACK_ACCOUNT_LOOKUP_FAILED") {
    return res.status(422).json({
      success: false,
      message:
        "Paystack could not verify that bank account. Check the bank and account number.",
    });
  }
  if (
    !["PAYSTACK_LOOKUP_FAILED", "PAYSTACK_TRANSPORT_ERROR"].includes(
      error.code,
    )
  ) {
    console.error("Vendor Tier 1 verification could not be saved:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to save Tier 1 verification.",
    });
  }
  console.error("Vendor bank verification provider request failed:", error);
  return res.status(502).json({
    success: false,
    message: "Bank verification is temporarily unavailable. Try again later.",
  });
};

const sendTierPaymentProviderError = (error, res) => {
  if (error.code === "PAYSTACK_NOT_CONFIGURED") {
    return res.status(503).json({
      success: false,
      message: "Vendor tier payments are not configured. Contact support.",
    });
  }
  if (
    !["PAYSTACK_LOOKUP_FAILED", "PAYSTACK_TRANSPORT_ERROR"].includes(
      error.code,
    )
  ) {
    console.error("Vendor tier payment could not be processed:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to process the vendor tier payment.",
    });
  }
  console.error("Vendor tier payment provider request failed:", error);
  return res.status(502).json({
    success: false,
    message: "Vendor tier payment is temporarily unavailable. Try again later.",
  });
};

router.get(
  "/tier-entry/options",
  authenticateToken,
  requireSeller,
  (_req, res) => {
    const plans = Object.entries(VENDOR_TIER_PRICES_USD).map(
      ([tier, priceUSD]) => {
        let amountMinor = null;
        try {
          amountMinor = getVendorTierAmountMinor(tier);
        } catch (error) {
          if (error.code !== "VENDOR_TIER_PRICING_NOT_CONFIGURED") throw error;
        }
        return {
          tier,
          priceUSD,
          currency: "NGN",
          amountMinor,
          amountNgn: amountMinor === null ? null : amountMinor / 100,
        };
      },
    );
    return res.json({
      success: true,
      configured: plans.every((plan) => plan.amountMinor !== null),
      plans,
    });
  },
);

router.post(
  "/tier-entry/initialize",
  authenticateToken,
  requireSeller,
  async (req, res) => {
    const tier = req.body?.tier;
    if (!Object.hasOwn(VENDOR_TIER_PRICES_USD, tier)) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid vendor tier.",
      });
    }

    try {
      const amountMinor = getVendorTierAmountMinor(tier);
      const userId = req.user._id || req.user.id;
      const seller = await User.findOne({
        _id: userId,
        role: "SELLER",
        accountStatus: { $ne: "SUSPENDED" },
      })
        .select(
          "email vendorDetails.tier vendorDetails.subscriptionStatus vendorDetails.tierEntryPendingTier vendorDetails.tierEntryPaymentReference vendorDetails.tierEntryPaymentAmountMinor",
        )
        .lean();
      if (!seller) {
        return res.status(404).json({
          success: false,
          message: "Seller account not found.",
        });
      }
      if (
        seller.vendorDetails?.subscriptionStatus === "ACTIVE" &&
        seller.vendorDetails?.tier === tier
      ) {
        return res.status(409).json({
          success: false,
          message: "This vendor tier is already active.",
        });
      }
      if (seller.vendorDetails?.tierEntryPaymentReference) {
        if (seller.vendorDetails.tierEntryPendingTier !== tier) {
          return res.status(409).json({
            success: false,
            message:
              "Finish or cancel the pending tier payment before selecting another tier.",
          });
        }
        return res.json({
          success: true,
          payment: {
            reference: seller.vendorDetails.tierEntryPaymentReference,
            amountMinor:
              seller.vendorDetails.tierEntryPaymentAmountMinor ?? amountMinor,
            amountNgn:
              (seller.vendorDetails.tierEntryPaymentAmountMinor ?? amountMinor) /
              100,
            currency: "NGN",
            email: seller.email,
          },
        });
      }

      const reference = `vendor_${randomUUID()}`;
      const payment = await paystackRequest("/transaction/initialize", {
        method: "POST",
        body: {
          email: seller.email,
          amount: amountMinor,
          currency: "NGN",
          reference,
          metadata: {
            purpose: "vendor_tier_entry_fee",
            vendor_id: String(userId),
            tier,
            price_usd: VENDOR_TIER_PRICES_USD[tier],
          },
        },
      });
      if (payment.reference !== reference) {
        return res.status(502).json({
          success: false,
          message: "Payment provider returned invalid vendor tier details.",
        });
      }

      const paymentIntentOwner = await User.updateOne(
        {
          _id: seller._id,
          role: "SELLER",
          accountStatus: { $ne: "SUSPENDED" },
          "vendorDetails.tierEntryPaymentReference": { $exists: false },
        },
        {
          $set: {
            "vendorDetails.tierEntryPendingTier": tier,
            "vendorDetails.tierEntryPaymentReference": reference,
            "vendorDetails.tierEntryPaymentAmountMinor": amountMinor,
            "vendorDetails.tierEntryPaymentCurrency": "NGN",
          },
        },
      );
      if (paymentIntentOwner.matchedCount !== 1) {
        return res.status(409).json({
          success: false,
          message: "Seller account changed before payment could be started.",
        });
      }
      return res.json({
        success: true,
        payment: {
          reference,
          amountMinor,
          amountNgn: amountMinor / 100,
          currency: "NGN",
          email: seller.email,
        },
      });
    } catch (error) {
      if (error.code === "VENDOR_TIER_PRICING_NOT_CONFIGURED") {
        return res.status(503).json({
          success: false,
          message:
            "Vendor tier pricing is not configured. Contact marketplace support.",
        });
      }
      return sendTierPaymentProviderError(error, res);
    }
  },
);

router.post(
  "/tier-entry/verify",
  authenticateToken,
  requireSeller,
  async (req, res) => {
    const reference =
      typeof req.body?.reference === "string" ? req.body.reference.trim() : "";
    if (!/^vendor_[a-f\d-]{36}$/i.test(reference)) {
      return res.status(400).json({
        success: false,
        message: "A valid vendor tier payment reference is required.",
      });
    }

    try {
      const userId = req.user._id || req.user.id;
      const existingPayment = await User.findOne({
        _id: userId,
        role: "SELLER",
        "vendorDetails.tierEntryPaidReference": reference,
      })
        .select("vendorDetails.tier vendorDetails.subscriptionStatus")
        .lean();
      if (existingPayment) {
        return res.json({
          success: true,
          tier: existingPayment.vendorDetails.tier,
          subscriptionStatus: existingPayment.vendorDetails.subscriptionStatus,
          alreadyVerified: true,
        });
      }

      const seller = await User.findOne({
        _id: userId,
        role: "SELLER",
        accountStatus: { $ne: "SUSPENDED" },
        "vendorDetails.tierEntryPaymentReference": reference,
      })
        .select(
          "email vendorDetails.tierEntryPendingTier vendorDetails.tierEntryPaymentAmountMinor vendorDetails.tierEntryPaymentCurrency",
        )
        .lean();
      if (!seller?.vendorDetails?.tierEntryPendingTier) {
        return res.status(404).json({
          success: false,
          message: "Pending vendor tier payment was not found.",
        });
      }

      const payment = await paystackRequest(
        `/transaction/verify/${encodeURIComponent(reference)}`,
      );
      if (
        payment.status !== "success" ||
        payment.amount !== seller.vendorDetails.tierEntryPaymentAmountMinor ||
        payment.currency !== seller.vendorDetails.tierEntryPaymentCurrency ||
        String(payment.customer?.email || "").toLowerCase() !==
          seller.email.toLowerCase()
      ) {
        return res.status(422).json({
          success: false,
          message:
            "The vendor tier payment could not be verified. Confirm payment and try again.",
        });
      }

      const verifiedAt = new Date();
      const updatedSeller = await User.findOneAndUpdate(
        {
          _id: userId,
          role: "SELLER",
          accountStatus: { $ne: "SUSPENDED" },
          "vendorDetails.tierEntryPaymentReference": reference,
          "vendorDetails.tierEntryPendingTier":
            seller.vendorDetails.tierEntryPendingTier,
        },
        {
          $set: {
            "vendorDetails.tier": seller.vendorDetails.tierEntryPendingTier,
            "vendorDetails.subscriptionStatus": "ACTIVE",
            "vendorDetails.tierEntryPaidReference": reference,
            "vendorDetails.tierEntryPaidAmountMinor": payment.amount,
            "vendorDetails.tierEntryPaidAt": verifiedAt,
          },
          $unset: {
            "vendorDetails.tierEntryPendingTier": "",
            "vendorDetails.tierEntryPaymentReference": "",
            "vendorDetails.tierEntryPaymentAmountMinor": "",
            "vendorDetails.tierEntryPaymentCurrency": "",
          },
        },
        { new: true, runValidators: true },
      ).select("vendorDetails.tier vendorDetails.subscriptionStatus");

      if (!updatedSeller) {
        return res.status(409).json({
          success: false,
          message: "Vendor tier payment has already been processed.",
        });
      }
      return res.json({
        success: true,
        tier: updatedSeller.vendorDetails.tier,
        subscriptionStatus: updatedSeller.vendorDetails.subscriptionStatus,
        paidAt: verifiedAt,
      });
    } catch (error) {
      return sendTierPaymentProviderError(error, res);
    }
  },
);

router.get("/banks", authenticateToken, requireSeller, async (_req, res) => {
  try {
    const banks = await paystackRequest(
      "/bank?country=nigeria&use_cursor=false&perPage=100",
    );
    if (!Array.isArray(banks)) {
      return res.status(502).json({
        success: false,
        message: "Bank verification returned an invalid bank list.",
      });
    }
    return res.json({
      success: true,
      banks: banks
        .filter((bank) => bank.active && bank.code && bank.name)
        .map(({ name, code }) => ({ name, code: String(code) })),
    });
  } catch (error) {
    return sendProviderError(error, res);
  }
});

router.post(
  "/verify-tier1",
  authenticateToken,
  requireSeller,
  async (req, res) => {
    const legalName =
      typeof req.body?.fullLegalName === "string"
        ? req.body.fullLegalName.trim()
        : "";
    const ninNumber =
      typeof req.body?.ninNumber === "string" ? req.body.ninNumber.trim() : "";
    const bankAccountNumber =
      typeof req.body?.bankAccountNumber === "string"
        ? req.body.bankAccountNumber.trim()
        : "";
    const bankCode =
      typeof req.body?.bankCode === "string" ? req.body.bankCode.trim() : "";

    if (legalName.length < 2 || legalName.length > 120) {
      return res.status(400).json({
        success: false,
        message: "Full legal name must be between 2 and 120 characters.",
      });
    }
    if (!/^\d{11}$/.test(ninNumber)) {
      return res.status(400).json({
        success: false,
        message: "NIN must contain exactly 11 digits.",
      });
    }
    if (!/^\d{10}$/.test(bankAccountNumber)) {
      return res.status(400).json({
        success: false,
        message: "Payout account number must contain exactly 10 digits.",
      });
    }
    if (!/^[a-zA-Z0-9_-]{2,20}$/.test(bankCode)) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid payout bank.",
      });
    }

    try {
      const selectedBank = await paystackRequest(
        `/bank?country=nigeria&use_cursor=false&perPage=100`,
      ).then((banks) =>
        Array.isArray(banks)
          ? banks.find(
              (entry) => entry.active && String(entry.code) === bankCode,
            )
          : null,
      );
      if (!selectedBank) {
        return res.status(400).json({
          success: false,
          message: "Choose an active Nigerian payout bank.",
        });
      }

      const accountResult = await paystackRequest(
        `/bank/resolve?account_number=${encodeURIComponent(bankAccountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
      );
      const bankAccountName =
        typeof accountResult?.account_name === "string"
          ? accountResult.account_name.trim()
          : "";
      if (
        !bankAccountName ||
        normalizeName(bankAccountName) !== normalizeName(legalName)
      ) {
        return res.status(422).json({
          success: false,
          message:
            "The legal name does not match the payout account name. Check your details and try again.",
        });
      }

      const userId = req.user._id || req.user.id;
      const ninCiphertext = encryptSensitiveValue(
        ninNumber,
        userId,
        "vendor-nin",
      );
      const accountCiphertext = encryptSensitiveValue(
        bankAccountNumber,
        userId,
        "vendor-bank-account",
      );
      const verifiedAt = new Date();
      const user = await User.findOneAndUpdate(
        {
          _id: userId,
          role: "SELLER",
          accountStatus: { $ne: "SUSPENDED" },
          "vendorDetails.tier1Verified": { $ne: true },
        },
        {
          $set: {
            "vendorDetails.tier1Verified": true,
            "vendorDetails.verificationData.legalName": legalName,
            "vendorDetails.verificationData.ninNumber": ninCiphertext,
            "vendorDetails.verificationData.ninLast4": ninNumber.slice(-4),
            "vendorDetails.verificationData.ninVerifiedAt": verifiedAt,
            "vendorDetails.verificationData.bankName": selectedBank.name,
            "vendorDetails.verificationData.bankAccountName": bankAccountName,
            "vendorDetails.verificationData.bankAccountNumber":
              accountCiphertext,
            "vendorDetails.verificationData.bankAccountLast4":
              bankAccountNumber.slice(-4),
            "vendorDetails.verificationData.bankCode": bankCode,
          },
        },
        { new: true, runValidators: true },
      ).select("_id vendorDetails.tier1Verified");

      if (!user) {
        return res.status(409).json({
          success: false,
          message:
            "Tier 1 verification is already complete or the seller account is inactive.",
        });
      }
      return res.json({
        success: true,
        message:
          "Tier 1 soft-check verified. Your NIN format was checked and your bank account name matched.",
        verification: {
          tier1Verified: true,
          legalName,
          bankName: selectedBank.name,
          bankAccountName,
          bankAccountLast4: bankAccountNumber.slice(-4),
          ninLast4: ninNumber.slice(-4),
          ninVerifiedAt: verifiedAt,
        },
      });
    } catch (error) {
      if (error.code === "DOCUMENT_ENCRYPTION_KEY_INVALID") {
        return res.status(503).json({
          success: false,
          message:
            "Secure identity storage is not configured. Contact support.",
        });
      }
      return sendProviderError(error, res);
    }
  },
);

module.exports = router;
