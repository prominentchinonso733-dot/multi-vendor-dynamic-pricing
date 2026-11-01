const express = require("express");
const https = require("https");
const User = require("../models/User");
const authenticateToken = require("../middleware/authenticateToken");
const { encryptSensitiveValue } = require("../services/verificationDocuments");

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

const paystackRequest = (path) =>
  new Promise((resolve, reject) => {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      const error = new Error("Paystack verification is not configured.");
      error.code = "PAYSTACK_NOT_CONFIGURED";
      reject(error);
      return;
    }

    const request = https.request(
      {
        hostname: "api.paystack.co",
        path,
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          Accept: "application/json",
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
    request.end();
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
