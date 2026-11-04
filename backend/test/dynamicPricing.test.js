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

test("keeps cent-rounded prices within fractional-cent vendor limits", () => {
  assert.equal(
    calculateCurrentPrice({ ...pricing, demandScore: 0, priceFloor: 80.005 }),
    80.01,
  );
  assert.equal(
    calculateCurrentPrice({
      ...pricing,
      demandScore: 100,
      priceCeiling: 120.005,
    }),
    120,
  );
});

test("rejects vendor limits that contain no valid cent-denominated price", () => {
  assert.throws(
    () =>
      calculateCurrentPrice({
        ...pricing,
        priceFloor: 80.005,
        priceCeiling: 80.009,
      }),
    /valid two-decimal price/,
  );
});

test("adjusts price for low stock and recent order volume without crossing limits", () => {
  const adjusted = calculateCurrentPrice({
    ...pricing,
    demandScore: 50,
    stock: 2,
    orderUnitsLast24h: 12,
  });
  assert.equal(adjusted, pricing.priceCeiling);
  assert.equal(
    calculateCurrentPrice({
      ...pricing,
      demandScore: 50,
      stock: 80,
      orderUnitsLast24h: 0,
    }),
    90,
  );
  assert.equal(
    calculateCurrentPrice({
      ...pricing,
      demandScore: 0,
      stock: 1,
      orderUnitsLast24h: 0,
    }),
    pricing.priceFloor,
  );
});

test("rejects invalid pricing values", () => {
  assert.throws(
    () => calculateCurrentPrice({ ...pricing, demandScore: 101 }),
    /pricing values are invalid/,
  );
});
