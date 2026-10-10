const jwt = require("jsonwebtoken");

const authenticateToken = (req, res, next) => {
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
    req.user = { ...user, _id: user._id || user.id };
    return next();
  } catch {
    return res
      .status(401)
      .json({ success: false, message: "Invalid or expired token." });
  }
};

module.exports = authenticateToken;
