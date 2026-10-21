require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const mongoose = require("mongoose");
const Product = require("../models/Product");
const User = require("../models/User");

const [targetUserId, confirmationFlag] = process.argv.slice(2);
const confirmationRequired = "--confirm-reassign-all";

async function reassignProductsToSeller() {
  if (!targetUserId || !mongoose.isValidObjectId(targetUserId)) {
    throw new Error(
      "Provide a valid user ID: npm run reassign:products -- <USER_ID> --confirm-reassign-all",
    );
  }
  if (confirmationFlag !== confirmationRequired) {
    throw new Error(
      `This operation reassigns every product. Rerun with ${confirmationRequired} to confirm.`,
    );
  }
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI must be configured before updating products.");
  }

  await mongoose.connect(process.env.MONGO_URI);
  const targetUser = await User.findById(targetUserId).select("_id role");
  if (!targetUser) {
    throw new Error("No account exists with the provided user ID.");
  }
  if (!["SELLER", "ADMIN"].includes(targetUser.role)) {
    throw new Error("The target account must have the SELLER or ADMIN role.");
  }

  const result = await Product.updateMany({}, { $set: { vendor: targetUser._id } });

  console.log(
    `Reassigned ${result.modifiedCount} of ${result.matchedCount} existing products to account ${targetUser._id} (${targetUser.role}).`,
  );
}

reassignProductsToSeller()
  .catch((error) => {
    console.error("Product reassignment failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
