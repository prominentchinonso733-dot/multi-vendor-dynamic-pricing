const assert = require("node:assert/strict");
const express = require("express");
const { test } = require("node:test");
const webhooks = require("../routes/webhooks");

test("Paystack subscription webhooks reject invalid signatures", async () => {
  const previousSecret = process.env.PAYSTACK_SECRET_KEY;
  process.env.PAYSTACK_SECRET_KEY = "test-paystack-secret";
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buffer) => {
        req.rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use("/api/webhooks", webhooks);
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/webhooks/paystack`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-paystack-signature": "0".repeat(128),
        },
        body: JSON.stringify({ event: "subscription.create", data: {} }),
      },
    );

    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousSecret === undefined) {
      delete process.env.PAYSTACK_SECRET_KEY;
    } else {
      process.env.PAYSTACK_SECRET_KEY = previousSecret;
    }
  }
});
