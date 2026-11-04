const assert = require("node:assert/strict");
const { test } = require("node:test");
const { cosineSimilarity } = require("../services/gemini");

test("Gemini embedding similarity ranks aligned product vectors higher", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), -1);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), -1);
});
