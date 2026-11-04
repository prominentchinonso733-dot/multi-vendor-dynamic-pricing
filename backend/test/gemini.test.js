const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  cosineSimilarity,
  isGeminiCredentialError,
} = require("../services/gemini");

test("Gemini embedding similarity ranks aligned product vectors higher", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), -1);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), -1);
});

test("recognizes missing and invalid Gemini credentials for fallbacks", () => {
  assert.equal(
    isGeminiCredentialError({ code: "GEMINI_NOT_CONFIGURED" }),
    true,
  );
  assert.equal(isGeminiCredentialError({ status: 401 }), true);
  assert.equal(
    isGeminiCredentialError({ message: "API key not valid. Please retry." }),
    true,
  );
  assert.equal(isGeminiCredentialError({ status: 503 }), false);
});
