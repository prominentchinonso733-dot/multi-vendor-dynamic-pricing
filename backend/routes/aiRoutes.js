const express = require("express");
const { generateSupportReply } = require("../services/gemini");

const router = express.Router();

router.post("/support", async (req, res) => {
  const message =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const history = req.body?.history ?? [];
  if (!message || message.length > 1200 || !Array.isArray(history) || history.length > 10) {
    return res.status(400).json({
      success: false,
      message: "Provide a message up to 1,200 characters and at most 10 history entries.",
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
    if (error.code === "GEMINI_NOT_CONFIGURED") {
      return res.status(503).json({
        success: false,
        message: "AI customer support is not configured.",
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
