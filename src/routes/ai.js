// src/routes/ai.js — Anthropic API proxy using official SDK
const express   = require("express");
const Anthropic  = require("@anthropic-ai/sdk");
const router    = express.Router();

// Initialize once at startup
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120000, // 2 minute timeout
});

router.post("/messages", async (req, res) => {
  try {
    const { system, messages } = req.body;

    if (!messages?.length) {
      return res.status(400).json({ error: "messages required" });
    }

    console.log("[AI] Request — messages:", messages.length, "system length:", system?.length || 0);

    const params = {
      model:      "claude-sonnet-4-6",
      max_tokens: 2000,
      messages:   messages.slice(-4), // Last 4 turns only
    };

    // Only add system if non-empty (empty string causes API issues)
    if (system && system.trim().length > 10) {
      params.system = system.slice(0, 3000);
    }

    console.log("[AI] Calling Anthropic...");
    const response = await client.messages.create(params);
    console.log("[AI] Success — stop_reason:", response.stop_reason, "output tokens:", response.usage?.output_tokens);

    res.json(response);

  } catch (err) {
    console.error("[AI] Error:", err.status || 500, err.message);
    res.status(err.status || 500).json({
      error: err.message || "AI service error"
    });
  }
});

module.exports = router;
