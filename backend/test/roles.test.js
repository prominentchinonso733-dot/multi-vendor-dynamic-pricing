const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  SELLER_ROLE_VALUES,
  isSellerRole,
  normalizeRole,
} = require("../services/roles");

test("normalizes seller and vendor role aliases to one access role", () => {
  for (const role of SELLER_ROLE_VALUES) {
    assert.equal(normalizeRole(role), "SELLER");
    assert.equal(isSellerRole(role), true);
  }
  assert.equal(normalizeRole("ROLE_VENDOR"), "SELLER");
  assert.equal(isSellerRole("BUYER"), false);
  assert.equal(isSellerRole("ADMIN"), false);
});
