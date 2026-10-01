require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

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
const webhookRoutes = require("./routes/webhooks");
app.use("/api/auth", authRoutes);
app.use("/api/escrow", escrowRoutes);
app.use("/api/webhooks", webhookRoutes);
// Main Root Route (for testing in browser)
app.get("/", (req, res) => {
  res.send("Backend Server is Running!");
});

// Products API Endpoint
app.get("/api/products", (req, res) => {
  res.json([
    {
      id: 1,
      name: "Wireless Noise-Canceling Headphones",
      vendor: "TechStore Ltd",
      price: 45000,
      image:
        "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80",
      category: "Electronics",
    },
    {
      id: 2,
      name: "Smartwatch Series 7 (OLED)",
      vendor: "GadgetHub",
      price: 85000,
      image:
        "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80",
      category: "Gadgets",
    },
    {
      id: 3,
      name: "Minimalist Leather Backpack",
      vendor: "Urban Style",
      price: 32000,
      image:
        "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=600&q=80",
      category: "Fashion",
    },
    {
      id: 4,
      name: "Mechanical Gaming Keyboard",
      vendor: "TechStore Ltd",
      price: 28000,
      image:
        "https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80",
      category: "Electronics",
    },
  ]);
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
