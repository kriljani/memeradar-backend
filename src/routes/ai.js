// src/routes/ai.js — Anthropic API proxy
const express   = require("express");
const Anthropic  = require("@anthropic-ai/sdk");
const router    = express.Router();

const client = new Anthropic({
  apiKey:  process.env.ANTHROPIC_API_KEY,
  timeout: 120000,
});

router.post("/messages", async (req, res) => {
  try {
    const { system, messages } = req.body;

    if (!messages?.length) {
      return res.status(400).json({ error: "messages required" });
    }

    console.log("[AI] Request — messages:", messages.length, "system:", system?.length || 0);

    const params = {
      model:      "claude-sonnet-4-6",
      max_tokens: 8000,              // Maximum — fits all 10 signals comfortably
      messages:   messages.slice(-4),
    };

    if (system && system.trim().length > 10) {
      params.system = system.slice(0, 3000);
    }

    console.log("[AI] Calling Anthropic...");
    const response = await client.messages.create(params);
    console.log("[AI]", response.stop_reason, "— output tokens:", response.usage?.output_tokens);

    res.json(response);

  } catch (err) {
    console.error("[AI] Error:", err.status || 500, err.message);
    res.status(err.status || 500).json({ error: err.message || "AI error" });
  }
});

module.exports = router;
