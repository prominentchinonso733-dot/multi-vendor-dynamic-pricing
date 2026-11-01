const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const {
  decryptDocument,
  detectContentType,
  encryptDocument,
} = require("../services/verificationDocuments");
const { getVendorPolicy, toMinorUnits, fromMinorUnits } = require("../services/financialPolicy");

const originalEncryptionKey = process.env.VERIFICATION_DOCUMENT_ENCRYPTION_KEY;

afterEach(() => {
  if (originalEncryptionKey === undefined) {
    delete process.env.VERIFICATION_DOCUMENT_ENCRYPTION_KEY;
  } else {
    process.env.VERIFICATION_DOCUMENT_ENCRYPTION_KEY = originalEncryptionKey;
  }
});

test("accepts only supported file signatures", () => {
  assert.equal(detectContentType(Buffer.from("%PDF-1.7\n")), "application/pdf");
  assert.equal(
    detectContentType(Buffer.from([0xff, 0xd8, 0xff, 0x00])),
    "image/jpeg",
  );
  assert.equal(
    detectContentType(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    "image/png",
  );
  assert.equal(detectContentType(Buffer.from("not an identity document")), null);
});

test("encrypts documents and binds ciphertext to its account", () => {
  process.env.VERIFICATION_DOCUMENT_ENCRYPTION_KEY = "a".repeat(64);
  const userId = "seller-account-123";
  const content = Buffer.from("%PDF-1.7\nidentity document");
  const encrypted = encryptDocument(content, userId);

  assert.equal(encrypted.contentType, "application/pdf");
  assert.deepEqual(decryptDocument(encrypted, userId), content);
  assert.throws(() => decryptDocument(encrypted, "another-account"));
  assert.throws(() =>
    encryptDocument(Buffer.from("invalid"), userId),
  );
});

test("rejects encryption without a valid configured key", () => {
  delete process.env.VERIFICATION_DOCUMENT_ENCRYPTION_KEY;
  assert.throws(
    () => encryptDocument(Buffer.from("%PDF-1.7\n"), "account"),
    { code: "DOCUMENT_ENCRYPTION_KEY_INVALID" },
  );
});

test("uses distinct financial policies for verified vendors", () => {
  assert.deepEqual(getVendorPolicy({}), {
    tier: "TIER_1",
    commissionRate: 0.1,
    dailyVolumeLimit: 500000,
    orderValueLimit: 100000,
  });
  assert.deepEqual(
    getVendorPolicy({
      verification: { tier: "TIER_2", status: "VERIFIED" },
    }),
    {
      tier: "TIER_2",
      commissionRate: 0.05,
      dailyVolumeLimit: 5000000,
      orderValueLimit: 1000000,
    },
  );
  assert.equal(fromMinorUnits(toMinorUnits(100.25)), 100.25);
});
