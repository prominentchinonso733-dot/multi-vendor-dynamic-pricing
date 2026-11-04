const express = require("express");
const {
  generateSupportReply,
  isGeminiCredentialError,
} = require("../services/gemini");

const router = express.Router();
const STATIC_SUPPORT_REPLY =
  "You can track orders from My Orders. Payments are held in escrow until delivery is confirmed. If an order is late, missing, or incorrect, open it in My Orders and raise a dispute for admin review. I cannot access account-specific order details, and you should never share passwords or payment details in chat.";

router.post("/support", async (req, res) => {
  const message =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const history = req.body?.history ?? [];
  if (
    !message ||
    message.length > 1200 ||
    !Array.isArray(history) ||
    history.length > 10
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Provide a message up to 1,200 characters and at most 10 history entries.",
    });
  }
  if (
    history.some(
      (entry) =>
        !["user", "assistant"].includes(entry?.role) ||
        typeof entry.content !== "string" ||
        entry.content.length > 1200,
    )
  ) {
    return res.status(400).json({
      success: false,
      message: "Support conversation history is invalid.",
    });
  }

  try {
    const reply = await generateSupportReply({ message, history });
    return res.json({ success: true, reply });
  } catch (error) {
    if (isGeminiCredentialError(error)) {
      return res.json({
        success: true,
        reply: STATIC_SUPPORT_REPLY,
        fallback: true,
      });
    }
    console.error("AI support response could not be generated:", error.message);
    return res.status(502).json({
      success: false,
      message: "AI customer support is temporarily unavailable.",
    });
  }
});

module.exports = router;
