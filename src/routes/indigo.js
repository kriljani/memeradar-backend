// src/routes/indigo.js — INDIGO engine + Rug DNA API
const express   = require("express");
const Anthropic  = require("@anthropic-ai/sdk");
const rateLimit  = require("express-rate-limit");
const db         = require("../db");
const { push }   = require("../ws");
const { v4: uuid } = require("uuid");

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const limiter = rateLimit({
  windowMs: 60000,
  max: parseInt(process.env.AI_RATE_LIMIT_PER_MIN || "30"),
  message: { error: "Rate limit — slow down" },
});

/* POST /api/indigo/analyze — 8-layer signal fusion */
router.post("/analyze", limiter, async (req, res) => {
  const { userId, signals = [], news = [], positions = [], riskMode = "balanced", maxTrade = 1.5, stopLoss = 15, takeProfit = 50 } = req.body;

  try {
    const sigCtx  = signals.slice(0,6).map(s => `${s.name}|tri:${s.tri}|poly:${s.poly?.odds||0}%|coin:${s.coinStatus}|vel:${s.vel||0}`).join(";");
    const newsCtx = news.slice(0,4).map(n => `${n.headline}|impact:${n.impact}|${n.newsType}`).join(";");
    const posCtx  = positions.map(p => `${p.ticker}|${p.type}|pnl:${p.pnl}%`).join(";");

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: `INDIGO trading agent — 8-layer signal fusion for meme coins.
Layers: polymarket(18%) social(14%) narrative(14%) onchain(16%) whale(14%) kol(10%) momentum(8%) rug(6%)
Risk: ${riskMode} | Max: ${maxTrade} SOL | SL: ${stopLoss}% | TP: ${takeProfit}%
Signals: ${sigCtx}
News: ${newsCtx}
Positions: ${posCtx}
Return ONLY raw JSON:
{"recommendations":[{"id":"uid","ticker":"","name":"","action":"LONG|SHORT|HOLD|AVOID","confidence":0,"fusionScore":0,"layerScores":{"polymarket":0,"social":0,"narrative":0,"onchain":0,"whale":0,"kol":0,"momentum":0,"rug":0},"entry":"market","size":0,"stopLoss":0,"takeProfit":0,"reason":"","rugFlags":[],"whaleAlert":"","urgency":"HIGH|MEDIUM|LOW","signal":"","vikaAlert":""}]}`,
      messages: [{ role: "user", content: `Search DexScreener for coins in: ${sigCtx}. Check whale activity + rug patterns. Generate INDIGO trade recommendations using all 8 layers.` }]
    });

    const txt    = response.content.map(b => b.type === "text" ? b.text : "").join("");
    const match  = txt.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : null;
    const recs   = parsed?.recommendations || [];

    // Persist signals to DB
    if (userId && recs.length) {
      const insert = db.prepare(`INSERT OR REPLACE INTO indigo_signals (id,user_id,ticker,action,confidence,fusion_score,layer_scores_json,reason,rug_flags_json,whale_alert,urgency,signal_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      const tx = db.transaction(rows => {
        for (const r of rows) insert.run(r.id||uuid(), userId, r.ticker, r.action, r.confidence||0, r.fusionScore||0, JSON.stringify(r.layerScores||{}), r.reason||"", JSON.stringify(r.rugFlags||[]), r.whaleAlert||"", r.urgency||"MEDIUM", r.signal||"");
      });
      tx(recs);

      // Push HIGH urgency to WebSocket
      const urgent = recs.filter(r => r.urgency === "HIGH" && (r.action === "LONG" || r.action === "SHORT"));
      urgent.slice(0,2).forEach(r => {
        push(userId, { alertType:"indigo_signal", title:`◆ INDIGO: ${r.action} SIGNAL`, message:`${r.ticker} — Fusion ${r.fusionScore}/100 — ${r.reason?.slice(0,80)}`, ticker: r.ticker, action: r.action, fusionScore: r.fusionScore, vikaAlert: r.vikaAlert });
      });
    }

    res.json({ recommendations: recs, count: recs.length });
  } catch (err) {
    console.error("[INDIGO]", err.message);
    res.status(500).json({ error: "INDIGO analysis failed", recommendations: [] });
  }
});

/* POST /api/indigo/rug — Rug DNA scanner */
router.post("/rug", limiter, async (req, res) => {
  const { userId, ticker } = req.body;
  if (!ticker) return res.status(400).json({ error: "ticker required" });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: `Rug DNA scanner. Return ONLY raw JSON:
{"ticker":"","safeScore":0,"verdict":"SAFE|CAUTION|DANGER|RUG","checks":[{"name":"","pass":true,"detail":""}],"redFlags":[],"greenFlags":[],"recommendation":""}`,
      messages: [{ role: "user", content: `Search DexScreener for ${ticker}. Check: LP locked? Ownership renounced? Top 3 wallet %, deployer sold, honeypot patterns, contract age, volume/mcap. Score safety 0-100.` }]
    });

    const txt    = response.content.map(b => b.type === "text" ? b.text : "").join("");
    const match  = txt.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : { ticker, safeScore:0, verdict:"ERROR", checks:[], redFlags:["Scan failed"], greenFlags:[], recommendation:"Could not analyze — try again" };

    // Persist + alert
    if (userId) {
      db.prepare(`INSERT INTO rug_scans (id,user_id,ticker,safe_score,verdict,checks_json,red_flags_json,green_flags_json,recommendation) VALUES (?,?,?,?,?,?,?,?,?)`).run(uuid(), userId, ticker, result.safeScore||0, result.verdict, JSON.stringify(result.checks||[]), JSON.stringify(result.redFlags||[]), JSON.stringify(result.greenFlags||[]), result.recommendation||"");
      if (result.verdict === "RUG" || result.verdict === "DANGER") {
        push(userId, { alertType:"rug_detected", title:`🛡 RUG DETECTED: ${ticker}`, message:`Safety score: ${result.safeScore}/100 — ${result.verdict} — AVOID` });
      }
    }

    res.json(result);
  } catch (err) {
    console.error("[RUG]", err.message);
    res.status(500).json({ error: "Rug scan failed", ticker, verdict:"ERROR", safeScore:0 });
  }
});

/* GET /api/indigo/history/:userId — last 20 signals */
router.get("/history/:userId", (req, res) => {
  const rows = db.prepare("SELECT * FROM indigo_signals WHERE user_id=? ORDER BY created_at DESC LIMIT 20").all(req.params.userId);
  res.json(rows.map(r => ({ ...r, layerScores: JSON.parse(r.layer_scores_json||"{}"), rugFlags: JSON.parse(r.rug_flags_json||"[]") })));
});

/* GET /api/indigo/rug-history/:userId */
router.get("/rug-history/:userId", (req, res) => {
  const rows = db.prepare("SELECT * FROM rug_scans WHERE user_id=? ORDER BY scanned_at DESC LIMIT 20").all(req.params.userId);
  res.json(rows.map(r => ({ ...r, checks: JSON.parse(r.checks_json||"[]"), redFlags: JSON.parse(r.red_flags_json||"[]"), greenFlags: JSON.parse(r.green_flags_json||"[]") })));
});

module.exports = router;
