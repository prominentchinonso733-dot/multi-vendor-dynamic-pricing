require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
  quiet: true,
});

const mongoose = require("mongoose");
const User = require("../models/User");

async function activateVendorAccounts() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI or MONGODB_URI must be configured.");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Vendor demo activation cannot run in production.");
  }

  await mongoose.connect(mongoUri);
  const result = await User.updateMany(
    { role: { $in: ["vendor", "SELLER"] } },
    { $set: { role: "SELLER", accountStatus: "ACTIVE" } },
    { runValidators: true },
  );
  console.log(
    `Activated ${result.modifiedCount} vendor accounts (${result.matchedCount} matched).`,
  );
  return result;
}

if (require.main === module) {
  activateVendorAccounts()
    .catch((error) => {
      console.error("Vendor account activation failed:", error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}

module.exports = activateVendorAccounts;
