// src/routes/data.js — Reminders, news cache, user sessions, alerts
const express = require("express");
const db      = require("../db");
const { v4: uuid } = require("uuid");

const router = express.Router();

/* ── SESSIONS ── */
router.post("/session", (req, res) => {
  const id = req.body.userId || uuid();
  db.prepare(
    "INSERT OR REPLACE INTO users (id, last_seen) VALUES (?, strftime('%s','now'))"
  ).run(id);
  res.json({ userId: id });
});

/* ── REMINDERS ── */
router.get("/reminders/:userId", (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM reminders WHERE user_id=? AND done=0 ORDER BY created_at ASC"
  ).all(req.params.userId);
  res.json(rows);
});

router.post("/reminders", (req, res) => {
  const { userId, text, timeLabel, urgent } = req.body;
  if (!userId || !text) return res.status(400).json({ error: "userId + text required" });
  const id = uuid();
  db.prepare(
    "INSERT INTO reminders (id,user_id,text,time_label,urgent) VALUES (?,?,?,?,?)"
  ).run(id, userId, text, timeLabel || "No time set", urgent ? 1 : 0);
  res.json({ id, text, timeLabel });
});

router.delete("/reminders/:id", (req, res) => {
  db.prepare("UPDATE reminders SET done=1 WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

/* ── NEWS CACHE ── */
router.get("/news", (req, res) => {
  // Return cached news (refreshed by scheduler)
  const rows = db.prepare(
    "SELECT * FROM news_cache ORDER BY impact DESC, fetched_at DESC LIMIT 20"
  ).all();
  res.json(rows.map(r => ({
    ...r,
    sources: JSON.parse(r.sources_json || "[]"),
    topics:  JSON.parse(r.topics_json  || "[]"),
  })));
});

router.post("/news", (req, res) => {
  // Cache news items (called by AI scan route)
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: "items array required" });
  const insert = db.prepare(`
    INSERT OR REPLACE INTO news_cache
      (id, headline, brief, sources_json, impact, category, news_type, why_matters, topics_json, emoji)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);
  const insertMany = db.transaction(rows => {
    for (const n of rows) insert.run(
      n.id || uuid(), n.headline, n.brief,
      JSON.stringify(n.sources || []), n.impact || 50,
      n.category, n.newsType || "ANALYSIS",
      n.whyMatters, JSON.stringify(n.topics || []), n.emoji || "📰"
    );
  });
  insertMany(items.slice(0, 20));
  res.json({ ok: true, count: items.length });
});

/* ── CONVERSATIONS ── */
router.get("/conversation/:userId", (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM conversations WHERE user_id=? ORDER BY created_at ASC LIMIT 40"
  ).all(req.params.userId);
  res.json(rows);
});

router.post("/conversation", (req, res) => {
  const { userId, role, content } = req.body;
  if (!userId || !role || !content) return res.status(400).json({ error: "missing fields" });
  db.prepare(
    "INSERT INTO conversations (id,user_id,role,content) VALUES (?,?,?,?)"
  ).run(uuid(), userId, role, content);
  res.json({ ok: true });
});

router.delete("/conversation/:userId", (req, res) => {
  db.prepare("DELETE FROM conversations WHERE user_id=?").run(req.params.userId);
  res.json({ ok: true });
});

/* ── ALERTS ── */
router.get("/alerts/:userId", (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 50"
  ).all(req.params.userId);
  res.json(rows);
});

router.post("/alerts/:id/read", (req, res) => {
  db.prepare("UPDATE alerts SET read=1 WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

/* ── TRADE LOG ── */
router.get("/trades/:userId", (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM trade_log WHERE user_id=? ORDER BY opened_at DESC LIMIT 50"
  ).all(req.params.userId);
  res.json(rows);
});

router.post("/trades", (req, res) => {
  const { userId, action, ticker, sizeSol, entryPrice, reason } = req.body;
  db.prepare(
    "INSERT INTO trade_log (id,user_id,action,ticker,size_sol,entry_price,reason) VALUES (?,?,?,?,?,?,?)"
  ).run(uuid(), userId, action, ticker, sizeSol || 0, entryPrice || 0, reason || "");
  res.json({ ok: true });
});

router.patch("/trades/:id/close", (req, res) => {
  const { pnlPct } = req.body;
  db.prepare(
    "UPDATE trade_log SET status='closed', pnl_pct=?, closed_at=strftime('%s','now') WHERE id=?"
  ).run(pnlPct || 0, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
