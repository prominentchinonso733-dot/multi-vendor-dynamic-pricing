require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const ADMIN_EMAIL = "prominentchinonso733@gmail.com";
const FALLBACK_MONGO_URI = "mongodb://127.0.0.1:27017/escrowMarketplace";

async function seedAdmin() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The development admin seed cannot run in production.");
  }

  const password = process.env.ADMIN_SEED_PASSWORD || "admin123";
  const passwordHash = await bcrypt.hash(password, 10);

  await mongoose.connect(FALLBACK_MONGO_URI);

  const user = await User.findOneAndUpdate(
    { email: ADMIN_EMAIL },
    {
      $set: { password: passwordHash, role: "ADMIN" },
      $setOnInsert: { email: ADMIN_EMAIL, name: "Chinonso Admin" },
    },
    {
      returnDocument: "after",
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  );

  console.log(`Seeded admin account ${user.email} with role ${user.role}.`);
}

seedAdmin()
  .catch((error) => {
    console.error("Admin seed failed:", error.name || "Error");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
