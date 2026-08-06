// src/routes/ai.js — Anthropic API proxy
const express = require("express");
const axios   = require("axios");
const router  = express.Router();

router.post("/messages", async (req, res) => {
  try {
    const { model, system, messages } = req.body;
    // Note: we intentionally ignore 'tools' here to prevent
    // web search from consuming the entire 200k context window

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const body = {
      model:      "claude-sonnet-4-6",
      max_tokens: 4000,
      messages:   messages.slice(-6),        // Last 6 turns only
      system:     (system || "").slice(0, 4000), // Hard limit on system prompt
    };

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      body,
      {
        headers: {
          "x-api-key":        process.env.ANTHROPIC_API_KEY,
          "anthropic-version":"2023-06-01",
          "content-type":     "application/json",
        },
        timeout: 60000,
      }
    );

    res.json(response.data);

  } catch (err) {
    const status  = err.response?.status  || 500;
    const message = err.response?.data?.error?.message || err.message;
    console.error("[AI] Error:", status, message);
    res.status(status).json({ error: message });
  }
});

module.exports = router;
