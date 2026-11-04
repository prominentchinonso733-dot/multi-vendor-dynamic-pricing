const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const { test } = require("node:test");
const Product = require("../models/Product");
const aiRoutes = require("../routes/aiRoutes");
const productRoutes = require("../routes/products");
const gemini = require("../services/gemini");
const { classifySupportRequest } = require("../services/supportAssistant");

test("new vendor products default to approved, active, and published", () => {
  const product = new Product({
    vendor: new mongoose.Types.ObjectId(),
    title: "Test product",
    basePrice: 100,
    currentPrice: 100,
    priceFloor: 80,
    priceCeiling: 120,
  });

  assert.equal(product.isApproved, true);
  assert.equal(product.status, "active");
  assert.equal(product.isPublished, true);
});

test("vendor disputes are categorized and formatted as non-submitted drafts", () => {
  const support = classifySupportRequest(
    "I am a vendor and need to dispute a refund for order 123456789012.",
  );

  assert.equal(support.audience, "VENDOR");
  assert.equal(support.category, "VENDOR_DISPUTE");
  assert.equal(support.ticketDraft.status, "DRAFT");
  assert.equal(support.ticketDraft.priority, "NORMAL");
  assert.match(support.ticketDraft.summary, /\[redacted number\]/);
  assert.match(support.ticketDraft.nextStep, /submit this draft/i);
  assert.match(support.ticketDraft.note, /Draft only/);
});

test("semantic search and support fall back when Gemini credentials are missing", async () => {
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousGoogleKey = process.env.GOOGLE_API_KEY;
  const originalFind = Product.find;
  const originalSemanticProductSearch = gemini.semanticProductSearch;
  let capturedFilter;
  const vendorId = new mongoose.Types.ObjectId();
  const product = {
    _id: new mongoose.Types.ObjectId(),
    title: "Red ceramic mug",
    description: "A hand-glazed coffee cup",
    category: "Kitchen",
    basePrice: 2000,
    demandScore: 50,
    priceFloor: 1500,
    priceCeiling: 3000,
    stock: 12,
    isApproved: true,
    status: "active",
    isPublished: true,
    vendor: {
      _id: vendorId,
      name: "Market Seller",
      storeName: "Ceramics House",
      role: "SELLER",
    },
  };

  process.env.GEMINI_API_KEY = "";
  process.env.GOOGLE_API_KEY = "";
  Product.find = (filter) => {
    capturedFilter = filter;
    const query = {
      populate() {
        return this;
      },
      sort() {
        return this;
      },
      limit() {
        return this;
      },
      async lean() {
        return [product];
      },
    };
    return query;
  };

  const app = express();
  app.use(express.json());
  app.use("/api/products", productRoutes);
  app.use("/api/ai", aiRoutes);
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const homepageResponse = await fetch(`${baseUrl}/api/products`);
    const homepageProducts = await homepageResponse.json();

    assert.equal(homepageResponse.status, 200);
    assert.equal(homepageProducts[0].title, product.title);
    assert.deepEqual(capturedFilter, {
      isApproved: true,
      status: "active",
      isPublished: true,
    });

    const searchResponse = await fetch(
      `${baseUrl}/api/products/search/semantic`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "red coffee mug" }),
      },
    );
    const searchResult = await searchResponse.json();

    assert.equal(searchResponse.status, 200);
    assert.equal(searchResult.searchMode, "keyword");
    assert.equal(searchResult.products[0].title, product.title);
    assert.equal(capturedFilter.isApproved, true);
    assert.equal(capturedFilter.status, "active");
    assert.equal(capturedFilter.isPublished, true);

    process.env.GEMINI_API_KEY = "invalid-test-key";
    gemini.semanticProductSearch = async () => {
      throw Object.assign(new Error("API key not valid."), { status: 400 });
    };
    const invalidKeySearchResponse = await fetch(
      `${baseUrl}/api/products/search/semantic`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "red coffee mug" }),
      },
    );
    const invalidKeySearchResult = await invalidKeySearchResponse.json();

    assert.equal(invalidKeySearchResponse.status, 200);
    assert.equal(invalidKeySearchResult.searchMode, "keyword");
    assert.equal(invalidKeySearchResult.products[0].title, product.title);

    gemini.semanticProductSearch = originalSemanticProductSearch;
    const supportResponse = await fetch(`${baseUrl}/api/ai/support`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Where is my order?" }),
    });
    const supportResult = await supportResponse.json();

    assert.equal(supportResponse.status, 200);
    assert.equal(supportResult.success, true);
    assert.equal(supportResult.fallback, true);
    assert.match(supportResult.reply, /My Orders/);
    assert.match(supportResult.reply, /escrow/);
    assert.equal(supportResult.support.category, "ORDER_TRACKING");
    assert.equal(supportResult.support.ticketDraft, null);

    const disputeResponse = await fetch(`${baseUrl}/api/ai/support`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "My order arrived damaged; I need a refund.",
      }),
    });
    const disputeResult = await disputeResponse.json();

    assert.equal(disputeResult.support.category, "ORDER_DISPUTE");
    assert.equal(disputeResult.support.ticketDraft.status, "DRAFT");
    assert.match(disputeResult.support.ticketDraft.nextStep, /My Orders/);
    assert.match(disputeResult.support.ticketDraft.note, /Draft only/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    Product.find = originalFind;
    gemini.semanticProductSearch = originalSemanticProductSearch;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
    if (previousGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = previousGoogleKey;
  }
});
