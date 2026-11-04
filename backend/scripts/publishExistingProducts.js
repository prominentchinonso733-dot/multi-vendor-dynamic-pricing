require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const mongoose = require("mongoose");

const EXPECTED_PRODUCT_COUNT = 40;
const publicationFields = {
  isApproved: true,
  status: "active",
  isPublished: true,
};

const publishExistingProducts = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI or MONGODB_URI must be configured.");

  await mongoose.connect(uri);
  const products = mongoose.connection.collection("products");
  const count = await products.countDocuments({});
  if (count !== EXPECTED_PRODUCT_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_PRODUCT_COUNT} products, found ${count}; no changes were made.`,
    );
  }

  const alreadyPublished = await products.countDocuments(publicationFields);
  if (!process.argv.includes("--apply")) {
    console.log(
      `Dry run: found ${count} products; ${alreadyPublished} already have the requested publication flags. Pass --apply to update all products.`,
    );
    return;
  }

  const result = await products.updateMany({}, { $set: publicationFields });
  const remaining = await products.countDocuments({
    $or: [
      { isApproved: { $ne: true } },
      { status: { $ne: "active" } },
      { isPublished: { $ne: true } },
    ],
  });
  if (result.matchedCount !== EXPECTED_PRODUCT_COUNT || remaining !== 0) {
    throw new Error(
      `Publication update verification failed: matched ${result.matchedCount}, remaining ${remaining}.`,
    );
  }

  console.log(
    `Updated and verified ${result.matchedCount} products; ${result.modifiedCount} documents changed.`,
  );
};

publishExistingProducts()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
