// src/routes/ai.js — Anthropic API proxy
// Uses axios directly to ensure correct headers for web search tool
const express   = require("express");
const axios     = require("axios");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.AI_RATE_LIMIT_PER_MIN || "30"),
  message: { error: "Too many requests — slow down" },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/ai/messages — drop-in replacement for direct Anthropic calls
router.post("/messages", limiter, async (req, res) => {
  try {
    const { model, max_tokens, system, messages, tools } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const body = {
      model:      model || "claude-sonnet-4-20250514",
      max_tokens: Math.min(parseInt(max_tokens) || 1000, 4000),
      messages:   messages.slice(-20),
    };

    if (system)        body.system = system.slice(0, 12000);
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
        timeout: 90000,
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
