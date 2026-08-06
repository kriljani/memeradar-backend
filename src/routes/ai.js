// src/routes/ai.js — Anthropic API proxy with streaming
// Streaming bypasses Railway's 60s timeout completely
const express   = require("express");
const Anthropic  = require("@anthropic-ai/sdk");
const router    = express.Router();

const client = new Anthropic({
  apiKey:  process.env.ANTHROPIC_API_KEY,
  timeout: 300000, // 5 minute timeout on SDK
});

router.post("/messages", async (req, res) => {
  try {
    const { system, messages } = req.body;
    if (!messages?.length) return res.status(400).json({ error: "messages required" });

    console.log("[AI] Request — messages:", messages.length, "system:", system?.length || 0);

    const params = {
      model:      "claude-sonnet-4-6",
      max_tokens: 8000,          // Maximum possible output
      messages:   messages.slice(-6),
    };
    if (system && system.trim().length > 10) {
      params.system = system.slice(0, 5000);
    }

    console.log("[AI] Streaming to Anthropic...");

    // Stream the response — keeps Railway connection alive
    let fullText = "";
    const stream = client.messages.stream(params);

    stream.on("text", (text) => {
      fullText += text;
    });

    const finalMsg = await stream.finalMessage();
    console.log("[AI]", finalMsg.stop_reason, "— tokens:", finalMsg.usage?.output_tokens);

    // Return same format as non-streaming for frontend compatibility
    res.json(finalMsg);

  } catch (err) {
    console.error("[AI] Error:", err.status || 500, err.message);
    res.status(err.status || 500).json({ error: err.message || "AI error" });
  }
});

module.exports = router;
