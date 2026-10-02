const express = require("express");
const router = express.Router();

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
