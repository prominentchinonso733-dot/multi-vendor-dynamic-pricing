require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
  quiet: true,
});

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const User = require("../models/User");
const VendorWallet = require("../models/VendorWallet");
const calculateCurrentPrice = require("../services/dynamicPricing");
const { encryptSensitiveValue } = require("../services/verificationDocuments");
const { marketplaceVendors } = require("../data/marketplaceSeedData");

const DEMO_PASSWORD = "DemoVendor123!";
const FALLBACK_DEMO_ENCRYPTION_KEY = "0000000000000000000000000000000000000000000000000000000000000000";
const INITIAL_AVAILABLE_BALANCE = 75000;
const INITIAL_PENDING_BALANCE = 25000;

const getNinNumber = (index) => String(10000000001 + index).padStart(11, "0");
const getAccountNumber = (index) => `000000000${index + 1}`;

const configureDemoEncryptionKey = () => {
  if (!process.env.VERIFICATION_DOCUMENT_ENCRYPTION_KEY) {
    process.env.VERIFICATION_DOCUMENT_ENCRYPTION_KEY =
      FALLBACK_DEMO_ENCRYPTION_KEY;
  }
};

async function seedMarketplace() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI or MONGODB_URI must be configured.");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Marketplace demo data cannot be seeded in production.");
  }
  configureDemoEncryptionKey();
  if (!/^[a-f\d]{64}$/i.test(process.env.VERIFICATION_DOCUMENT_ENCRYPTION_KEY || "")) {
    throw new Error(
      "VERIFICATION_DOCUMENT_ENCRYPTION_KEY must be a 64-character hexadecimal key.",
    );
  }

  await mongoose.connect(mongoUri);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  let productCount = 0;

  for (const [index, vendorSeed] of marketplaceVendors.entries()) {
    const user = await User.findOneAndUpdate(
      { email: vendorSeed.email },
      {
        $setOnInsert: {
          name: vendorSeed.name,
          email: vendorSeed.email,
          password: passwordHash,
          role: "SELLER",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const ninNumber = getNinNumber(index);
    const accountNumber = getAccountNumber(index);
    const isTier2 = vendorSeed.tier === "TIER_2";
    const now = new Date();
    const verifiedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const verificationData = {
      legalName: vendorSeed.legalName,
      ninNumber: encryptSensitiveValue(ninNumber, user._id, "vendor-nin"),
      ninLast4: ninNumber.slice(-4),
      ninVerifiedAt: verifiedAt,
    };
    const payoutDetails = {
      bankName: vendorSeed.bankName,
      bankCode: vendorSeed.bankCode,
      accountName: vendorSeed.legalName,
      accountNumber: encryptSensitiveValue(
        accountNumber,
        user._id,
        "vendor-bank-account",
      ),
      accountLast4: accountNumber.slice(-4),
      transferRecipientCode: "",
    };
    const vendorDetails = {
      businessName: vendorSeed.name,
      tier: vendorSeed.tier,
      tier1Verified: true,
      verificationData,
      payoutDetails,
      subscriptionStatus: "ACTIVE",
      isVendor: true,
      isVerified: isTier2,
      commissionRate: isTier2 ? 0.05 : 0.1,
    };
    const verification = isTier2
      ? {
          tier: "TIER_2",
          status: "VERIFIED",
          legalName: vendorSeed.legalName,
          documentType: "NIN",
          submittedAt: verifiedAt,
          reviewedAt: now,
          reviewNote: "Synthetic demo verification; not valid for real onboarding.",
        }
      : {
          tier: "TIER_1",
          status: "VERIFIED",
          legalName: vendorSeed.legalName,
          documentType: "NIN",
          submittedAt: verifiedAt,
          reviewedAt: now,
        };

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          name: vendorSeed.name,
          role: "SELLER",
          accountStatus: "ACTIVE",
          storeName: vendorSeed.name,
          storeDescription: `${vendorSeed.category} products, curated by ${vendorSeed.name}. Demo account and listings for development testing only.`,
          verification,
          vendorDetails,
        },
      },
      { runValidators: true },
    );

    await VendorWallet.updateOne(
      { vendorId: user._id },
      {
        $set: {
          balance: INITIAL_AVAILABLE_BALANCE,
          availableBalance: INITIAL_AVAILABLE_BALANCE,
          pendingBalance: INITIAL_PENDING_BALANCE,
          currency: "NGN",
        },
      },
      { upsert: true, runValidators: true },
    );

    for (const productSeed of vendorSeed.products) {
      const basePrice = productSeed.basePrice;
      const productFields = {
        vendor: user._id,
        title: productSeed.title,
        description: productSeed.description,
        category: vendorSeed.category,
        imageUrl: productSeed.imageUrl,
        stock: productSeed.stock,
        basePrice,
        currentPrice: calculateCurrentPrice({
          basePrice,
          demandScore: productSeed.demandScore,
          priceFloor: Math.round(basePrice * 0.75 * 100) / 100,
          priceCeiling: Math.round(basePrice * 1.25 * 100) / 100,
        }),
        priceFloor: Math.round(basePrice * 0.75 * 100) / 100,
        priceCeiling: Math.round(basePrice * 1.25 * 100) / 100,
        competitorPrice: Math.round(basePrice * 0.95 * 100) / 100,
        demandScore: productSeed.demandScore,
      };

      await Product.updateOne(
        { vendor: user._id, title: productSeed.title },
        { $set: productFields },
        { upsert: true, runValidators: true },
      );
      productCount += 1;
    }

    console.log(`Seeded ${vendorSeed.name} (${vendorSeed.products.length} products).`);
  }

  console.log(
    `Marketplace demo data ready: ${marketplaceVendors.length} vendors, ${productCount} products.`,
  );
  console.log(`Demo vendor sign-in password: ${DEMO_PASSWORD}`);
  console.log(
    "Identity numbers and payout accounts are synthetic placeholders; external bank verification and transfers will not work.",
  );
}

if (require.main === module) {
  seedMarketplace()
    .catch((error) => {
      console.error("Marketplace seeding failed:", error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}

module.exports = seedMarketplace;
module.exports.configureDemoEncryptionKey = configureDemoEncryptionKey;
