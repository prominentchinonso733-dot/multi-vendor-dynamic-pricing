require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
  quiet: true,
});

const mongoose = require("mongoose");
const User = require("../models/User");

const resolveLocalMongoUri = (env = process.env) => {
  const mongoUri = env.MONGO_URI || env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI or MONGODB_URI must be configured.");
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Test-vendor verification cannot run in production.");
  }

  let parsedUri;
  try {
    parsedUri = new URL(mongoUri);
  } catch {
    throw new Error("A valid local mongodb:// connection URI is required.");
  }
  if (
    parsedUri.protocol !== "mongodb:" ||
    !["localhost", "127.0.0.1", "::1"].includes(parsedUri.hostname)
  ) {
    throw new Error(
      "Test-vendor verification is restricted to localhost MongoDB (localhost, 127.0.0.1, or ::1).",
    );
  }
  return mongoUri;
};

const resolveTestVendorEmail = (args = process.argv.slice(2), env = process.env) => {
  const email = String(args[0] || env.PRIMARY_TEST_VENDOR_EMAIL || "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.test$/.test(email)) {
    throw new Error(
      "Provide the primary test seller email ending in .test as an argument or PRIMARY_TEST_VENDOR_EMAIL.",
    );
  }
  return email;
};

async function verifyPrimaryTestVendor() {
  const mongoUri = resolveLocalMongoUri();
  const email = resolveTestVendorEmail();
  await mongoose.connect(mongoUri);

  const vendor = await User.findOne({ email }).select(
    "_id name role accountStatus verification.legalName",
  );
  if (!vendor) {
    throw new Error(`No existing test account was found for ${email}.`);
  }
  if (vendor.role !== "SELLER") {
    throw new Error("The selected test account must already have the SELLER role.");
  }
  if (vendor.accountStatus === "SUSPENDED") {
    throw new Error("The selected test seller is suspended; no changes were made.");
  }

  const now = new Date();
  const legalName = vendor.verification?.legalName || vendor.name;
  const result = await User.updateOne(
    {
      _id: vendor._id,
      role: "SELLER",
      accountStatus: { $ne: "SUSPENDED" },
    },
    {
      $set: {
        "verification.tier": "TIER_1",
        "verification.status": "VERIFIED",
        "verification.legalName": legalName,
        "verification.documentType": "NIN",
        "verification.submittedAt": now,
        "verification.reviewedAt": now,
        "verification.reviewNote":
          "Synthetic local development approval; not valid for real onboarding.",
        "vendorDetails.tier": "TIER_1",
        "vendorDetails.tier1Verified": true,
        "vendorDetails.subscriptionStatus": "ACTIVE",
        "vendorDetails.subscriptionPeriodEnd": new Date(
          now.getTime() + 30 * 24 * 60 * 60 * 1000,
        ),
      },
    },
    { runValidators: true },
  );

  if (result.matchedCount !== 1) {
    throw new Error("The test vendor was not updated; its account may have changed.");
  }

  console.log(`Enabled marketplace visibility for local test seller ${email}.`);
  console.log(
    "This synthetic status is for local development only and does not represent real identity review or a paid vendor tier.",
  );
}

if (require.main === module) {
  verifyPrimaryTestVendor()
    .catch((error) => {
      console.error("Test-vendor verification failed:", error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}

module.exports = {
  resolveLocalMongoUri,
  resolveTestVendorEmail,
  verifyPrimaryTestVendor,
};
