const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  resolveLocalMongoUri,
  resolveTestVendorEmail,
} = require("../scripts/verifyPrimaryTestVendor");

test("test-vendor helper accepts local MongoDB only outside production", () => {
  assert.equal(
    resolveLocalMongoUri({
      MONGO_URI: "mongodb://127.0.0.1:27017/marketplace",
      NODE_ENV: "development",
    }),
    "mongodb://127.0.0.1:27017/marketplace",
  );
  assert.throws(
    () =>
      resolveLocalMongoUri({
        MONGO_URI: "mongodb+srv://cluster.example/marketplace",
        NODE_ENV: "development",
      }),
    /localhost MongoDB/,
  );
  assert.throws(
    () =>
      resolveLocalMongoUri({
        MONGO_URI: "mongodb://localhost:27017/marketplace",
        NODE_ENV: "production",
      }),
    /cannot run in production/,
  );
});

test("test-vendor helper only accepts explicitly identified .test accounts", () => {
  assert.equal(
    resolveTestVendorEmail(["primary@example.test"], {}),
    "primary@example.test",
  );
  assert.equal(
    resolveTestVendorEmail([], {
      PRIMARY_TEST_VENDOR_EMAIL: "Primary@example.test",
    }),
    "primary@example.test",
  );
  assert.throws(
    () => resolveTestVendorEmail(["real@example.com"], {}),
    /ending in \.test/,
  );
});
