const crypto = require("crypto");

const SUPPORTED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

const getEncryptionKey = () => {
  const configuredKey = process.env.VERIFICATION_DOCUMENT_ENCRYPTION_KEY || "";
  if (!/^[a-f\d]{64}$/i.test(configuredKey)) {
    const error = new Error(
      "Identity document encryption is not configured correctly.",
    );
    error.code = "DOCUMENT_ENCRYPTION_KEY_INVALID";
    throw error;
  }
  return Buffer.from(configuredKey, "hex");
};

const detectContentType = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  return null;
};

const encryptDocument = (content, userId) => {
  const contentType = detectContentType(content);
  if (!contentType || !SUPPORTED_CONTENT_TYPES.has(contentType)) {
    const error = new Error("Upload a valid PDF, JPEG, or PNG document.");
    error.code = "INVALID_DOCUMENT_CONTENT";
    throw error;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(String(userId)));
  const encryptedContent = Buffer.concat([
    cipher.update(content),
    cipher.final(),
  ]);
  return {
    contentType,
    encryptedContent,
    iv,
    authTag: cipher.getAuthTag(),
    keyVersion: 1,
  };
};

const decryptDocument = (document, userId) => {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    document.iv,
  );
  decipher.setAAD(Buffer.from(String(userId)));
  decipher.setAuthTag(document.authTag);
  return Buffer.concat([
    decipher.update(document.encryptedContent),
    decipher.final(),
  ]);
};

const encryptSensitiveValue = (value, userId, purpose) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${userId}:${purpose}`));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "enc",
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
};

const decryptSensitiveValue = (encodedValue, userId, purpose) => {
  const [prefix, version, encodedIv, encodedTag, encodedContent] =
    String(encodedValue || "").split(":");
  if (
    prefix !== "enc" ||
    version !== "v1" ||
    !encodedIv ||
    !encodedTag ||
    !encodedContent
  ) {
    throw new Error("Stored sensitive information has an invalid format.");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAAD(Buffer.from(`${userId}:${purpose}`));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedContent, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

module.exports = {
  SUPPORTED_CONTENT_TYPES,
  decryptSensitiveValue,
  decryptDocument,
  detectContentType,
  encryptSensitiveValue,
  encryptDocument,
};
