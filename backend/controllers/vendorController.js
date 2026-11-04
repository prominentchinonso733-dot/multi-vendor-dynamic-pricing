const express = require("express");
const https = require("https");
const { randomUUID } = require("crypto");
const User = require("../models/User");
const VendorWallet = require("../models/VendorWallet");
const VendorWithdrawal = require("../models/VendorWithdrawal");
const PaystackPlan = require("../models/PaystackPlan");
const authenticateToken = require("../middleware/authenticateToken");
const {
  decryptSensitiveValue,
  encryptSensitiveValue,
} = require("../services/verificationDocuments");
const {
  CURRENCY,
  fromMinorUnits,
  toMinorUnits,
} = require("../services/financialPolicy");
const {
  getWalletForUpdate,
  reserveAvailable,
  restoreAvailable,
} = require("../services/vendorWallet");
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

const ensureMonthlyPaystackPlan = async (tier, amountMinor) => {
  let plan = await PaystackPlan.findOne({ tier });
  if (plan?.amountMinor === amountMinor && plan.currency === CURRENCY) {
    return plan;
  }
  const providerPlan = await paystackRequest("/plan", {
    method: "POST",
    body: {
      name: `${tier.replace("_", " ")} Vendor Monthly`,
      amount: amountMinor,
      currency: CURRENCY,
      interval: "monthly",
    },
  });
  if (!providerPlan?.plan_code) {
    throw new Error("Paystack returned an invalid monthly vendor plan.");
  }
  return PaystackPlan.findOneAndUpdate(
    { tier },
    {
      $set: {
        providerCode: providerPlan.plan_code,
        amountMinor,
        currency: CURRENCY,
        interval: "monthly",
      },
    },
    { new: true, upsert: true, runValidators: true },
  );
};

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

const resolvePayoutDetails = async (bankCode, accountNumber, legalName) => {
  if (!/^[a-zA-Z0-9_-]{2,20}$/.test(bankCode)) {
    throw Object.assign(new Error("Choose a valid payout bank."), {
      statusCode: 400,
    });
  }
  if (!/^\d{10}$/.test(accountNumber)) {
    throw Object.assign(
      new Error("Payout account number must contain exactly 10 digits."),
      { statusCode: 400 },
    );
  }

  const banks = await paystackRequest(
    "/bank?country=nigeria&use_cursor=false&perPage=100",
  );
  const selectedBank = Array.isArray(banks)
    ? banks.find((bank) => bank.active && String(bank.code) === bankCode)
    : null;
  if (!selectedBank) {
    throw Object.assign(new Error("Choose an active Nigerian payout bank."), {
      statusCode: 400,
    });
  }

  const accountResult = await paystackRequest(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
  );
  const accountName =
    typeof accountResult?.account_name === "string"
      ? accountResult.account_name.trim()
      : "";
  if (!accountName || normalizeName(accountName) !== normalizeName(legalName)) {
    throw Object.assign(
      new Error(
        "The legal name does not match the payout account name. Check your details and try again.",
      ),
      { statusCode: 422 },
    );
  }
  return { selectedBank, accountName };
};

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
    console.error("Vendor identity or payout details could not be saved:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to save vendor verification or payout details.",
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
          "email vendorDetails.tier vendorDetails.subscriptionStatus vendorDetails.subscriptionCode vendorDetails.tierEntryPendingTier vendorDetails.tierEntryPaymentReference vendorDetails.tierEntryPaymentAmountMinor",
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
      if (seller.vendorDetails?.subscriptionStatus === "ACTIVE") {
        return res.status(409).json({
          success: false,
          message:
            "Cancel the current recurring plan before selecting a different tier.",
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
            interval: "monthly",
            email: seller.email,
          },
        });
      }

      const plan = await ensureMonthlyPaystackPlan(tier, amountMinor);
      const reference = `vendor_${randomUUID()}`;
      const payment = await paystackRequest("/transaction/initialize", {
        method: "POST",
        body: {
          email: seller.email,
          amount: amountMinor,
          currency: "NGN",
          plan: plan.providerCode,
          reference,
          metadata: {
            purpose: "vendor_monthly_subscription",
            vendor_id: String(userId),
            tier,
            price_usd: VENDOR_TIER_PRICES_USD[tier],
            billing_interval: "monthly",
            plan_code: plan.providerCode,
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
            "vendorDetails.tierEntryPlanCode": plan.providerCode,
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
          interval: "monthly",
          planCode: plan.providerCode,
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
          "email vendorDetails.tierEntryPendingTier vendorDetails.tierEntryPaymentAmountMinor vendorDetails.tierEntryPaymentCurrency vendorDetails.tierEntryPlanCode",
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
        payment.metadata?.purpose !== "vendor_monthly_subscription" ||
        payment.metadata?.vendor_id !== String(userId) ||
        payment.metadata?.tier !== seller.vendorDetails.tierEntryPendingTier ||
        payment.metadata?.plan_code !== seller.vendorDetails.tierEntryPlanCode ||
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
            "vendorDetails.subscriptionPlanCode":
              seller.vendorDetails.tierEntryPlanCode,
            "vendorDetails.subscriptionLastPaidAt": verifiedAt,
            "vendorDetails.subscriptionPeriodEnd": new Date(
              verifiedAt.getTime() + 32 * 24 * 60 * 60 * 1000,
            ),
            "vendorDetails.subscriptionFailureCount": 0,
          },
          $unset: {
            "vendorDetails.tierEntryPendingTier": "",
            "vendorDetails.tierEntryPaymentReference": "",
            "vendorDetails.tierEntryPaymentAmountMinor": "",
            "vendorDetails.tierEntryPaymentCurrency": "",
            "vendorDetails.tierEntryPlanCode": "",
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

router.post(
  "/tier-subscription/cancel",
  authenticateToken,
  requireSeller,
  async (req, res) => {
    try {
      const seller = await User.findOne({
        _id: req.user._id || req.user.id,
        role: "SELLER",
        accountStatus: { $ne: "SUSPENDED" },
      })
        .select("+vendorDetails.subscriptionCode +vendorDetails.subscriptionEmailToken")
        .lean();
      const subscription = seller?.vendorDetails;
      if (!subscription?.subscriptionCode || !subscription?.subscriptionEmailToken) {
        return res.status(404).json({
          success: false,
          message: "An active Paystack subscription was not found.",
        });
      }
      await paystackRequest("/subscription/disable", {
        method: "POST",
        body: {
          code: subscription.subscriptionCode,
          token: subscription.subscriptionEmailToken,
        },
      });
      await User.updateOne(
        {
          _id: seller._id,
          "vendorDetails.subscriptionCode": subscription.subscriptionCode,
        },
        { $set: { "vendorDetails.subscriptionStatus": "CANCELLED" } },
      );
      return res.json({ success: true, subscriptionStatus: "CANCELLED" });
    } catch (error) {
      return sendTierPaymentProviderError(error, res);
    }
  },
);

router.get("/banks", async (_req, res) => {
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
    const bankCode =
      typeof req.body?.bankCode === "string" ? req.body.bankCode.trim() : "";
    const accountNumber =
      typeof req.body?.accountNumber === "string"
        ? req.body.accountNumber.trim()
        : "";
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
    try {
      const { selectedBank, accountName } = await resolvePayoutDetails(
        bankCode,
        accountNumber,
        legalName,
      );
      const userId = req.user._id || req.user.id;
      const ninCiphertext = encryptSensitiveValue(
        ninNumber,
        userId,
        "vendor-nin",
      );
      const accountCiphertext = encryptSensitiveValue(
        accountNumber,
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
            "vendorDetails.payoutDetails.bankName": selectedBank.name,
            "vendorDetails.payoutDetails.bankCode": String(selectedBank.code),
            "vendorDetails.payoutDetails.accountName": accountName,
            "vendorDetails.payoutDetails.accountNumber": accountCiphertext,
            "vendorDetails.payoutDetails.accountLast4":
              accountNumber.slice(-4),
          },
          $unset: {
            "vendorDetails.payoutDetails.transferRecipientCode": "",
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
          "Tier 1 verification complete. NIN format was checked only; no NIMC validation was performed.",
        verification: {
          tier1Verified: true,
          legalName,
          ninLast4: ninNumber.slice(-4),
          ninVerifiedAt: verifiedAt,
          payoutDetails: {
            bankName: selectedBank.name,
            bankCode: String(selectedBank.code),
            accountName,
            accountLast4: accountNumber.slice(-4),
          },
        },
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }
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

router.post(
  "/save-payout-bank",
  authenticateToken,
  requireSeller,
  async (req, res) => {
    const bankCode =
      typeof req.body?.bankCode === "string" ? req.body.bankCode.trim() : "";
    const accountNumber =
      typeof req.body?.accountNumber === "string"
        ? req.body.accountNumber.trim()
        : "";
    const legalName =
      typeof req.body?.legalName === "string"
        ? req.body.legalName.trim()
        : "";
    if (legalName.length < 2 || legalName.length > 120) {
      return res.status(400).json({
        success: false,
        message: "Full legal name must be between 2 and 120 characters.",
      });
    }

    try {
      const { selectedBank, accountName } = await resolvePayoutDetails(
        bankCode,
        accountNumber,
        legalName,
      );
      const userId = req.user._id || req.user.id;
      const user = await User.findOneAndUpdate(
        {
          _id: userId,
          role: "SELLER",
          accountStatus: { $ne: "SUSPENDED" },
        },
        {
          $set: {
            "vendorDetails.payoutDetails.bankName": selectedBank.name,
            "vendorDetails.payoutDetails.bankCode": String(selectedBank.code),
            "vendorDetails.payoutDetails.accountName": accountName,
            "vendorDetails.payoutDetails.accountNumber":
              encryptSensitiveValue(
                accountNumber,
                userId,
                "vendor-bank-account",
              ),
            "vendorDetails.payoutDetails.accountLast4":
              accountNumber.slice(-4),
          },
          $unset: {
            "vendorDetails.payoutDetails.transferRecipientCode": "",
          },
        },
        { new: true, runValidators: true },
      ).select("_id");
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "Active vendor account not found.",
        });
      }
      return res.json({
        success: true,
        payoutDetails: {
          bankName: selectedBank.name,
          accountName,
          accountLast4: accountNumber.slice(-4),
        },
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }
      if (error.code === "DOCUMENT_ENCRYPTION_KEY_INVALID") {
        return res.status(503).json({
          success: false,
          message: "Secure payout storage is not configured. Contact support.",
        });
      }
      return sendProviderError(error, res);
    }
  },
);

router.post(
  "/wallet/withdraw",
  authenticateToken,
  requireSeller,
  async (req, res) => {
    const userId = req.user._id || req.user.id;
    const bankCode =
      typeof req.body?.bankCode === "string" ? req.body.bankCode.trim() : "";
    const accountNumber =
      typeof req.body?.accountNumber === "string"
        ? req.body.accountNumber.trim()
        : "";
    const suppliedBankDetails = Boolean(bankCode || accountNumber);
    if (suppliedBankDetails && (!bankCode || !accountNumber)) {
      return res.status(400).json({
        success: false,
        message: "Provide both a bank and a payout account number.",
      });
    }

    let seller;
    let payoutDetails;
    try {
      seller = await User.findOne({
        _id: userId,
        role: "SELLER",
        accountStatus: { $ne: "SUSPENDED" },
      }).select(
        "name vendorDetails.verificationData.legalName vendorDetails.payoutDetails",
      )
        .select("+vendorDetails.payoutDetails.accountNumber")
        .select("+vendorDetails.payoutDetails.transferRecipientCode");
      if (!seller) {
        return res.status(404).json({
          success: false,
          message: "Active vendor account not found.",
        });
      }
      const legalName =
        seller.vendorDetails?.verificationData?.legalName || seller.name;
      if (suppliedBankDetails) {
        const { selectedBank, accountName } = await resolvePayoutDetails(
          bankCode,
          accountNumber,
          legalName,
        );
        seller.vendorDetails.payoutDetails = {
          bankName: selectedBank.name,
          bankCode: String(selectedBank.code),
          accountName,
          accountNumber: encryptSensitiveValue(
            accountNumber,
            userId,
            "vendor-bank-account",
          ),
          accountLast4: accountNumber.slice(-4),
        };
        await seller.save();
      }

      payoutDetails = seller.vendorDetails?.payoutDetails;
      if (
        !payoutDetails?.bankCode ||
        !payoutDetails?.accountNumber ||
        !payoutDetails?.bankName
      ) {
        return res.status(400).json({
          success: false,
          message: "Save and verify a payout bank account before withdrawing.",
        });
      }
      if (!payoutDetails.transferRecipientCode) {
        const accountNumberValue = decryptSensitiveValue(
          payoutDetails.accountNumber,
          userId,
          "vendor-bank-account",
        );
        const recipient = await paystackRequest("/transferrecipient", {
          method: "POST",
          body: {
            type: "nuban",
            name: payoutDetails.accountName,
            account_number: accountNumberValue,
            bank_code: payoutDetails.bankCode,
            currency: CURRENCY,
          },
        });
        if (!recipient?.recipient_code) {
          throw new Error("Paystack returned an invalid payout recipient.");
        }
        payoutDetails.transferRecipientCode = recipient.recipient_code;
        await seller.save();
      }
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }
      if (error.code === "DOCUMENT_ENCRYPTION_KEY_INVALID") {
        return res.status(503).json({
          success: false,
          message: "Secure payout storage is not configured. Contact support.",
        });
      }
      return sendProviderError(error, res);
    }

    const reference = `vendor_withdrawal_${randomUUID()}`;
    const session = await VendorWallet.startSession();
    let withdrawal;
    try {
      await session.withTransaction(async () => {
        const wallet = await getWalletForUpdate(userId, session);
        const availableMinor = reserveAvailable(wallet);
        if (availableMinor < 1) {
          const error = new Error("There are no available funds to withdraw.");
          error.statusCode = 409;
          throw error;
        }
        const amount = fromMinorUnits(availableMinor);
        await wallet.save({ session });
        [withdrawal] = await VendorWithdrawal.create(
          [
            {
              vendorId: userId,
              reference,
              amount,
              currency: CURRENCY,
              bankName: payoutDetails.bankName,
              accountLast4: payoutDetails.accountLast4,
            },
          ],
          { session },
        );
      });
    } catch (error) {
      await session.endSession();
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }
      console.error("Vendor withdrawal could not be reserved:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to reserve funds for withdrawal.",
      });
    }
    await session.endSession();

    try {
      const transfer = await paystackRequest("/transfer", {
        method: "POST",
        body: {
          source: "balance",
          amount: toMinorUnits(withdrawal.amount),
          recipient: payoutDetails.transferRecipientCode,
          reference,
          reason: "Vendor wallet withdrawal",
        },
      });
      if (transfer.reference !== reference) {
        const error = new Error(
          "Paystack transfer reference did not match the withdrawal.",
        );
        error.code = "PAYSTACK_TRANSFER_REFERENCE_MISMATCH";
        throw error;
      }
      const status = transfer.status === "success" ? "COMPLETED" : "PROCESSING";
      const awaitingAuthorization = transfer.status === "otp";
      await VendorWithdrawal.updateOne(
        { _id: withdrawal._id, status: "PROCESSING" },
        {
          $set: {
            status,
            transferCode: transfer.transfer_code,
            ...(status === "COMPLETED" && { completedAt: new Date() }),
          },
        },
      );
      return res.status(status === "COMPLETED" ? 200 : 202).json({
        success: true,
        withdrawal: {
          reference,
          amount: withdrawal.amount,
          currency: withdrawal.currency,
          status,
        },
        message:
          status === "COMPLETED"
            ? "Withdrawal sent to your saved payout account."
            : awaitingAuthorization
              ? "Paystack requires transfer authorization. Funds remain reserved while the payout is pending."
              : "Withdrawal is being processed by Paystack.",
      });
    } catch (error) {
      if (
        ["PAYSTACK_LOOKUP_FAILED", "PAYSTACK_NOT_CONFIGURED"].includes(
          error.code,
        )
      ) {
        const failureSession = await VendorWallet.startSession();
        try {
          await failureSession.withTransaction(async () => {
            const failedWithdrawal =
              await VendorWithdrawal.findOneAndUpdate(
                { _id: withdrawal._id, status: "PROCESSING" },
                {
                  $set: {
                    status: "FAILED",
                    failureReason: "Paystack rejected the transfer.",
                    resolvedAt: new Date(),
                  },
                },
                { new: true, session: failureSession },
              );
            if (failedWithdrawal) {
              const wallet = await getWalletForUpdate(userId, failureSession);
              restoreAvailable(
                wallet,
                toMinorUnits(withdrawal.amount),
              );
              await wallet.save({ session: failureSession });
            }
          });
        } finally {
          await failureSession.endSession();
        }
        return res
          .status(error.code === "PAYSTACK_NOT_CONFIGURED" ? 503 : 502)
          .json({
            success: false,
            message:
              "Paystack rejected the transfer. The reserved amount has been returned to your available balance.",
          });
      }

      console.error("Vendor transfer status could not be confirmed:", error);
      return res.status(202).json({
        success: true,
        withdrawal: {
          reference,
          amount: withdrawal.amount,
          currency: withdrawal.currency,
          status: "PROCESSING",
        },
        message:
          "Transfer status is still being confirmed. Funds remain reserved while Paystack processes the withdrawal.",
      });
    }
  },
);

module.exports = router;
