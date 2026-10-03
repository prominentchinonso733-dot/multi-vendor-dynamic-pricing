const bcrypt = require("bcryptjs");
const User = require("./models/User");

const DEFAULT_ADMIN_EMAIL = "prominentchinonso733@gmail.com";
const MIN_PASSWORD_LENGTH = 16;

async function ensureAdmin() {
  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || DEFAULT_ADMIN_EMAIL)
    .trim()
    .toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!password) return { created: false, skipped: true };
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_BOOTSTRAP_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    if (existingUser.role !== "ADMIN") {
      throw new Error(
        `Cannot bootstrap admin: ${email} already belongs to a non-admin account.`,
      );
    }
    return { created: false, skipped: false };
  }

  try {
    await User.create({
      name: process.env.ADMIN_BOOTSTRAP_NAME?.trim() || "Chinonso Admin",
      email,
      password: await bcrypt.hash(password, 12),
      role: "ADMIN",
    });
    return { created: true, skipped: false };
  } catch (error) {
    if (error.code !== 11000) throw error;

    const concurrentlyCreatedUser = await User.findOne({ email });
    if (concurrentlyCreatedUser?.role === "ADMIN") {
      return { created: false, skipped: false };
    }
    throw error;
  }
}

module.exports = ensureAdmin;
