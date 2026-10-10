const express = require("express");
const Product = require("../models/Product");
const authenticateToken = require("../middleware/authenticateToken");

const router = express.Router();

router.get("/mine", authenticateToken, async (req, res) => {
  if (!["SELLER", "ADMIN"].includes(req.user.role)) {
    return res
      .status(403)
      .json({ success: false, message: "Seller or admin role required." });
  }

  try {
    const filter =
      req.user.role === "ADMIN" ? {} : { vendor: req.user.id };
    const products = await Product.find(filter).sort({ updatedAt: -1 }).lean();
    return res.json({ success: true, products });
  } catch (error) {
    console.error("Vendor products could not be loaded:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load vendor products.",
    });
  }
});

router.get("/", (_req, res) => {
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

module.exports = router;
