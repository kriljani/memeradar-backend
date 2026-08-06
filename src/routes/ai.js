// src/routes/ai.js — Anthropic proxy
// Streams from Anthropic and writes keepalive whitespace to the client so
// Railway's edge proxy never sees an idle connection. Leading whitespace is
// valid JSON, so the frontend parses the payload with no changes.
const express   = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const router    = express.Router();

const client = new Anthropic({
  apiKey:  process.env.ANTHROPIC_API_KEY,
  timeout: 300000,
});

router.post("/messages", async (req, res) => {
  let keepalive = null;
  let headersSent = false;

  try {
    const { system, messages } = req.body;
    if (!messages?.length) {
      return res.status(400).json({ error: "messages required" });
    }

    console.log("[AI] Request — messages:", messages.length, "system:", system?.length || 0);

    const params = {
      model:      "claude-sonnet-4-6",
      max_tokens: 8000,
      messages:   messages.slice(-6),
    };
    if (system && system.trim().length > 10) {
      params.system = system.slice(0, 5000);
    }

    // Open the response immediately, then drip whitespace while we generate.
    res.writeHead(200, {
      "Content-Type":      "application/json; charset=utf-8",
      "Cache-Control":     "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });
    headersSent = true;
    res.write(" ");
    keepalive = setInterval(() => { try { res.write(" "); } catch {} }, 10000);

    console.log("[AI] Streaming from Anthropic...");
    const stream   = client.messages.stream(params);
    const finalMsg = await stream.finalMessage();

    clearInterval(keepalive);
    keepalive = null;

    console.log("[AI]", finalMsg.stop_reason, "— output tokens:", finalMsg.usage?.output_tokens);
    res.write(JSON.stringify(finalMsg));
    res.end();

  } catch (err) {
    if (keepalive) clearInterval(keepalive);
    const msg = err?.error?.error?.message || err.message || "AI error";
    console.error("[AI] Error:", err.status || 500, msg);

    if (headersSent) {
      try { res.write(JSON.stringify({ error: msg })); res.end(); } catch {}
    } else {
      res.status(err.status || 500).json({ error: msg });
    }
  }
});

module.exports = router;
