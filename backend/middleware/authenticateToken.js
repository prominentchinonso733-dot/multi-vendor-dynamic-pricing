const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authenticateToken = async (req, res, next) => {
  const authorization = req.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res
      .status(401)
      .json({ success: false, message: "Authentication required." });
  }
  if (!process.env.JWT_SECRET) {
    return res
      .status(500)
      .json({ success: false, message: "Authentication is not configured." });
  }

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    const account = await User.findById(user._id || user.id)
      .select("role accountStatus")
      .lean();
    if (!account || account.accountStatus === "SUSPENDED") {
      return res
        .status(403)
        .json({ success: false, message: "This account is not active." });
    }
    if (account.role !== user.role) {
      return res
        .status(403)
        .json({ success: false, message: "Account permissions have changed." });
    }
    req.user = { ...user, _id: user._id || user.id };
    return next();
  } catch (error) {
    if (error.name !== "JsonWebTokenError" && error.name !== "TokenExpiredError") {
      console.error("Authentication could not be completed:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to verify account access.",
      });
    }
    return res
      .status(401)
      .json({ success: false, message: "Invalid or expired token." });
  }
};

module.exports = authenticateToken;
