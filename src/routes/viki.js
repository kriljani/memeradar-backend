// src/routes/viki.js — VIKI conversation + memory API
const express   = require("express");
const Anthropic  = require("@anthropic-ai/sdk");
const rateLimit  = require("express-rate-limit");
const db         = require("../db");
const { push }   = require("../ws");
const { v4: uuid } = require("uuid");

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const limiter = rateLimit({ windowMs: 60000, max: 30, message: { error: "Rate limit" } });

/* POST /api/viki/chat — main conversation endpoint */
router.post("/chat", limiter, async (req, res) => {
  const { userId, message, context = {} } = req.body;
  if (!userId || !message) return res.status(400).json({ error: "userId + message required" });

  // Load last 12 messages from DB
  const history = db.prepare("SELECT role,content FROM conversations WHERE user_id=? ORDER BY created_at DESC LIMIT 12").all(userId).reverse();

  const { signals=[], news=[], watchlist=[], positions=[] } = context;
  const sigCtx  = signals.slice(0,5).map(s => `${s.name}|tri:${s.tri}|poly:${s.poly?.odds||"—"}%|coin:${s.coinStatus}`).join(";");
  const newsCtx = news.slice(0,4).map(n => `${n.headline}|impact:${n.impact}|${n.newsType}`).join(";");
  const wlCtx   = watchlist.slice(0,4).map(w => `${w.sig?.name}|${w.coinDetected?"COIN DETECTED":"monitoring"}`).join(";");
  const posCtx  = positions.map(p => `${p.ticker}|${p.type}|pnl:${p.pnl}%`).join(";");

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: `You are VIKI — Virtual Intelligence for Knowledge & Investment. Warm, calm, intelligent female AI investment assistant for MemeRadar.

PERSONALITY: Calm, elegant, reassuring. Like a trusted advisor. Use flowing prose that sounds natural spoken aloud. Start with the user's name if known.

LIVE CONTEXT:
Signals (${signals.length}): ${sigCtx}
News (${news.length}): ${newsCtx}
Watchlist (${watchlist.length}): ${wlCtx}
Bot positions: ${posCtx}

When setting a reminder reply with REMINDER_SET: [title] | [time] on its own line.
Be specific with tickers, scores, and timing. Search web for current data if needed.`,
      messages: [
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: "user", content: message }
      ]
    });

    const reply = response.content.map(b => b.type === "text" ? b.text : "").join("").trim();

    // Parse reminder
    let cleanReply = reply;
    const remMatch = reply.match(/REMINDER_SET:\s*([^|\n]+)\|([^\n]+)/);
    if (remMatch && userId) {
      cleanReply = reply.replace(/REMINDER_SET:[^\n]*/,"").trim();
      db.prepare("INSERT INTO reminders (id,user_id,text,time_label) VALUES (?,?,?,?)").run(uuid(), userId, remMatch[1].trim(), remMatch[2].trim());
      push(userId, { alertType:"reminder_set", title:"◈ VIKI set a reminder", message:`${remMatch[1].trim()} — ${remMatch[2].trim()}` });
    }

    // Save conversation
    const ts = Math.floor(Date.now()/1000);
    db.prepare("INSERT INTO conversations (id,user_id,role,content,created_at) VALUES (?,?,?,?,?)").run(uuid(), userId, "user", message, ts);
    db.prepare("INSERT INTO conversations (id,user_id,role,content,created_at) VALUES (?,?,?,?,?)").run(uuid(), userId, "assistant", cleanReply, ts+1);

    // Keep only last 80 messages per user
    db.prepare("DELETE FROM conversations WHERE user_id=? AND id NOT IN (SELECT id FROM conversations WHERE user_id=? ORDER BY created_at DESC LIMIT 80)").run(userId, userId);

    res.json({ reply: cleanReply, reminderSet: !!remMatch });
  } catch (err) {
    console.error("[VIKI]", err.message);
    res.status(500).json({ error: "VIKI unavailable", reply: "I seem to have lost my connection for a moment. Please try again — I'm still here." });
  }
});

/* GET /api/viki/history/:userId */
router.get("/history/:userId", (req, res) => {
  const rows = db.prepare("SELECT role,content,created_at FROM conversations WHERE user_id=? ORDER BY created_at ASC LIMIT 40").all(req.params.userId);
  res.json(rows);
});

/* DELETE /api/viki/history/:userId */
router.delete("/history/:userId", (req, res) => {
  db.prepare("DELETE FROM conversations WHERE user_id=?").run(req.params.userId);
  res.json({ ok: true });
});

module.exports = router;
