require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const mongoose = require("mongoose");
const Product = require("../models/Product");
const User = require("../models/User");

const targetEmail = "prominentchinonso733@gmail.com";

const sampleProducts = [
  {
    title: "Wireless Noise-Canceling Headphones",
    category: "Electronics",
    basePrice: 45000,
    stock: 12,
    image:
      "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80",
  },
  {
    title: "Smartwatch Series 7 (OLED)",
    category: "Gadgets",
    basePrice: 85000,
    stock: 8,
    image:
      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80",
  },
  {
    title: "Minimalist Leather Backpack",
    category: "Fashion",
    basePrice: 32000,
    stock: 15,
    image:
      "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=600&q=80",
  },
  {
    title: "Mechanical Gaming Keyboard",
    category: "Electronics",
    basePrice: 28000,
    stock: 20,
    image:
      "https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80",
  },
];

async function seedSampleProducts() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI must be configured before seeding products.");
  }

  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({ email: targetEmail }).select("_id role");
  if (!user) {
    throw new Error(`No account exists for ${targetEmail}.`);
  }
  if (!["SELLER", "ADMIN"].includes(user.role)) {
    throw new Error("The target account must have the SELLER or ADMIN role.");
  }

  const operations = sampleProducts.map((sample) => {
    const priceFloor = Math.round(sample.basePrice * 0.8);
    const priceCeiling = Math.round(sample.basePrice * 1.2);

    return {
      updateOne: {
        filter: { vendor: user._id, title: sample.title },
        update: {
          $setOnInsert: {
            ...sample,
            vendor: user._id,
            description: "",
            demandScore: 50,
            competitorPrice: undefined,
            currentPrice: sample.basePrice,
            priceFloor,
            priceCeiling,
          },
        },
        upsert: true,
      },
    };
  });

  const result = await Product.bulkWrite(operations, { ordered: true });
  console.log(
    `Seeded ${result.upsertedCount} sample products for ${targetEmail} (${user.role}); ${result.matchedCount} already existed.`,
  );
}

seedSampleProducts()
  .catch((error) => {
    console.error("Sample product seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
