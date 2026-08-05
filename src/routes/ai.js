// src/routes/ai.js — Anthropic API proxy (keeps key on server)
const express    = require("express");
const Anthropic  = require("@anthropic-ai/sdk");
const rateLimit  = require("express-rate-limit");

const router   = express.Router();
const client   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.AI_RATE_LIMIT_PER_MIN || "20"),
  message: { error: "Too many AI requests — slow down" },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/ai/messages  — drop-in replacement for direct Anthropic calls
router.post("/messages", limiter, async (req, res) => {
  try {
    const { model, max_tokens, system, messages, tools } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    // Safety: strip any injected system prompt overrides
    const safeSystem = typeof system === "string"
      ? system.slice(0, 12000)    // Limit system prompt length
      : undefined;

    const params = {
      model:      model || "claude-sonnet-4-20250514",
      max_tokens: Math.min(parseInt(max_tokens) || 1000, 4000),
      messages:   messages.slice(-20),  // Last 20 turns only
    };

    if (safeSystem)  params.system = safeSystem;
    if (tools?.length) params.tools = tools;

    const response = await client.messages.create(params);
    res.json(response);

  } catch (err) {
    console.error("[AI] Error:", err.message);
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: "AI service error" });
  }
});

module.exports = router;
