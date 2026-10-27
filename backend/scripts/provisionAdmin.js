require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
  quiet: true,
});

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const DEFAULT_ADMIN_EMAIL = "prominentchinonso27@gmail.com";
const MIN_PASSWORD_LENGTH = 20;
const PROMOTE_FLAG = "--promote-existing";

async function provisionAdmin() {
  const email = String(
    process.env.ADMIN_BOOTSTRAP_EMAIL || DEFAULT_ADMIN_EMAIL,
  )
    .trim()
    .toLowerCase();
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  const promoteExisting = process.argv.includes(PROMOTE_FLAG);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("ADMIN_BOOTSTRAP_EMAIL must be a valid email address.");
  }
  if (!mongoUri) {
    throw new Error("MONGO_URI or MONGODB_URI must be configured.");
  }

  await mongoose.connect(mongoUri);
  const existingUser = await User.findOne({ email });

  if (existingUser?.role === "ADMIN") {
    console.log(`Admin account ${email} is already provisioned.`);
    return;
  }

  if (existingUser && !promoteExisting) {
    throw new Error(
      `An account already exists for ${email}. Re-run with ${PROMOTE_FLAG} to grant admin privileges without changing its password.`,
    );
  }

  if (existingUser) {
    const promotedUser = await User.findOneAndUpdate(
      { _id: existingUser._id, role: { $ne: "ADMIN" } },
      { $set: { role: "ADMIN" } },
      { new: true, runValidators: true },
    ).select("email role");

    if (!promotedUser) {
      const currentUser = await User.findOne({ email }).select("email role");
      if (currentUser?.role !== "ADMIN") {
        throw new Error("The existing account could not be promoted.");
      }
    }

    console.log(
      `Granted admin privileges to existing account ${email}. Its password was not changed.`,
    );
    return;
  }

  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Set ADMIN_BOOTSTRAP_PASSWORD to a unique password of at least ${MIN_PASSWORD_LENGTH} characters before creating the account.`,
    );
  }

  const name = String(
    process.env.ADMIN_BOOTSTRAP_NAME || "Chinonso Admin",
  ).trim();
  if (name.length < 2 || name.length > 120) {
    throw new Error(
      "ADMIN_BOOTSTRAP_NAME must be between 2 and 120 characters.",
    );
  }

  try {
    await User.create({
      name,
      email,
      password: await bcrypt.hash(password, 12),
      role: "ADMIN",
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const concurrentlyCreatedUser = await User.findOne({ email }).select(
      "email role",
    );
    if (concurrentlyCreatedUser?.role !== "ADMIN") {
      throw new Error(
        "An account was created concurrently; verify its role before retrying.",
      );
    }
  }
  console.log(`Created admin account ${email}.`);
}

if (require.main === module) {
  provisionAdmin()
    .catch((error) => {
      console.error("Admin provisioning failed:", error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}

module.exports = provisionAdmin;
