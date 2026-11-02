const test = require("node:test");
const assert = require("node:assert/strict");
const calculateCurrentPrice = require("../services/dynamicPricing");

const pricing = {
  basePrice: 100,
  demandScore: 70,
  priceFloor: 80,
  priceCeiling: 130,
};

test("calculates a demand-adjusted price within the seller's limits", () => {
  assert.equal(calculateCurrentPrice(pricing), 120);
});

test("clamps the demand-adjusted price to the configured floor and ceiling", () => {
  assert.equal(
    calculateCurrentPrice({ ...pricing, demandScore: 0 }),
    pricing.priceFloor,
  );
  assert.equal(
    calculateCurrentPrice({ ...pricing, demandScore: 100 }),
    pricing.priceCeiling,
  );
});

test("rejects invalid pricing values", () => {
  assert.throws(
    () => calculateCurrentPrice({ ...pricing, demandScore: 101 }),
    /pricing values are invalid/,
  );
});
