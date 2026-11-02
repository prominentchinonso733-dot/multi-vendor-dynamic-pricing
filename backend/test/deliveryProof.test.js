const test = require("node:test");
const assert = require("node:assert/strict");
const isValidDeliveryProof = require("../services/deliveryProof");

test("accepts image signatures that match the uploaded proof content type", () => {
  assert.equal(
    isValidDeliveryProof(
      Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      "image/jpeg",
    ),
    true,
  );
  assert.equal(
    isValidDeliveryProof(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "image/png",
    ),
    true,
  );
  assert.equal(
    isValidDeliveryProof(
      Buffer.from("RIFFxxxxWEBP"),
      "image/webp",
    ),
    true,
  );
});

test("rejects mismatched and unsupported proof content", () => {
  assert.equal(isValidDeliveryProof(Buffer.from("not an image"), "image/png"), false);
  assert.equal(
    isValidDeliveryProof(Buffer.from("%PDF-1.7"), "application/pdf"),
    false,
  );
});
