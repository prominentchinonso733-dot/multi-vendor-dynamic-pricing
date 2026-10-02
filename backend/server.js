require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(
  express.json({
    verify: (req, _res, buffer) => {
      req.rawBody = Buffer.from(buffer);
    },
  }),
);

// Register Escrow Routes
const escrowRoutes = require("./routes/escrowRoutes");
const authRoutes = require("./routes/auth");
const productsRoutes = require("./routes/products");
const webhookRoutes = require("./routes/webhooks");
app.use("/api/auth", authRoutes);
app.use("/api/escrow", escrowRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/webhooks", webhookRoutes);

const frontendDistPath = path.resolve(__dirname, "..", "frontend", "dist");
app.use(express.static(frontendDistPath));
app.get("/{*path}", (req, res, next) => {
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    return next();
  }
  return res.sendFile(path.join(frontendDistPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://127.0.0.1:${PORT}`);
});

mongoose
  .connect(
    process.env.MONGO_URI || "mongodb://127.0.0.1:27017/escrowMarketplace",
  )
  .catch((error) => {
    console.error("MongoDB connection failed:", error.message);
  });
