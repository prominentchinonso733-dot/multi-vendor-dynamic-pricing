require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const mongoose = require("mongoose");
const User = require("../models/User");

const [email, confirmationFlag] = process.argv.slice(2);
const confirmationRequired = "--confirm-vendor-promotion";

async function promoteVendor() {
  if (!email || !email.includes("@")) {
    throw new Error(
      "Provide the account email: npm run promote:vendor -- <EMAIL> --confirm-vendor-promotion",
    );
  }
  if (confirmationFlag !== confirmationRequired) {
    throw new Error(
      `This operation promotes one account to seller. Rerun with ${confirmationRequired} to confirm.`,
    );
  }
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error(
      "MONGODB_URI or MONGO_URI must be configured before updating accounts.",
    );
  }

  await mongoose.connect(mongoUri);
  const user = await User.findOneAndUpdate(
    { email: email.trim().toLowerCase() },
    {
      $set: {
        role: "SELLER",
        "vendorDetails.isVendor": true,
      },
    },
    { new: true, runValidators: true },
  ).select("email role vendorDetails.isVendor");

  if (!user) {
    throw new Error("No account exists with the provided email.");
  }

  console.log(
    `Promoted ${user.email}: role=${user.role}, isVendor=${user.vendorDetails.isVendor}.`,
  );
}

promoteVendor()
  .catch((error) => {
    console.error("Vendor promotion failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
