const assert = require("node:assert/strict");
const { test } = require("node:test");
const { marketplaceVendors } = require("../data/marketplaceSeedData");

test("marketplace demo data has seven vendors with five stocked products each", () => {
  assert.equal(marketplaceVendors.length, 7);
  for (const vendor of marketplaceVendors) {
    assert.ok(vendor.name);
    assert.ok(vendor.category);
    assert.match(vendor.email, /\.test$/);
    assert.equal(vendor.products.length, 5);
    assert.equal(new Set(vendor.products.map(({ title }) => title)).size, 5);
    for (const product of vendor.products) {
      assert.ok(product.title);
      assert.ok(product.description);
      assert.ok(product.basePrice > 0);
      assert.ok(product.stock > 0);
      assert.match(product.imageUrl, /^https:\/\/images\.unsplash\.com\//);
    }
  }
});

test("each demo tier has its required synthetic onboarding and bank fields", () => {
  for (const vendor of marketplaceVendors) {
    assert.ok(["TIER_1", "TIER_2"].includes(vendor.tier));
    assert.ok(vendor.legalName);
    assert.match(vendor.bankCode, /^TEST-/);
    assert.match(vendor.bankName, /\(test data\)$/);
  }
  assert.ok(marketplaceVendors.some(({ tier }) => tier === "TIER_1"));
  assert.ok(marketplaceVendors.some(({ tier }) => tier === "TIER_2"));
});
