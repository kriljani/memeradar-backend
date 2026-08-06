// src/routes/ai.js — Anthropic API proxy
const express = require("express");
const axios   = require("axios");
const router  = express.Router();

router.post("/messages", async (req, res) => {
  try {
    const { model, system, messages, tools } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const body = {
      model:      "claude-sonnet-4-6",
      max_tokens: 4000,            // Always 4000 — never truncate JSON responses
      messages:   messages.slice(-10), // Last 10 turns only to save input tokens
    };

    if (system)        body.system = system.slice(0, 6000); // Limit system prompt
    if (tools?.length) body.tools  = tools;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      body,
      {
        headers: {
          "x-api-key":        process.env.ANTHROPIC_API_KEY,
          "anthropic-version":"2023-06-01",
          "anthropic-beta":   "web-search-2025-03-05",
          "content-type":     "application/json",
        },
        timeout: 120000,
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
