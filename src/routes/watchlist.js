// src/routes/watchlist.js — Watchlist CRUD + monitoring logic
const express  = require("express");
const axios    = require("axios");
const Anthropic = require("@anthropic-ai/sdk");
const db       = require("../db");
const { push } = require("../ws");
const { v4: uuid } = require("uuid");

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/* GET /api/watchlist/:userId */
router.get("/:userId", (req, res) => {
  const items = db.prepare("SELECT * FROM watchlist WHERE user_id=? ORDER BY added_at DESC")
    .all(req.params.userId);
  res.json(items.map(i => ({ ...i, signal: JSON.parse(i.signal_json) })));
});

/* POST /api/watchlist — add item */
router.post("/", (req, res) => {
  const { userId, signal } = req.body;
  if (!userId || !signal?.id) return res.status(400).json({ error: "userId + signal required" });
  try {
    db.prepare(
      "INSERT OR IGNORE INTO watchlist (id,user_id,signal_id,signal_json) VALUES (?,?,?,?)"
    ).run(uuid(), userId, signal.id, JSON.stringify(signal));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/watchlist/:userId/:signalId */
router.delete("/:userId/:signalId", (req, res) => {
  db.prepare("DELETE FROM watchlist WHERE user_id=? AND signal_id=?")
    .run(req.params.userId, req.params.signalId);
  res.json({ ok: true });
});

/* POST /api/watchlist/check — manual trigger: check all watchlist items for coin launches */
router.post("/check", async (req, res) => {
  const { userId } = req.body;
  const results = await runWatchlistCheck(userId);
  res.json({ results });
});

/* ── WATCHLIST MONITOR FUNCTION (runs on schedule too) ── */
async function runWatchlistCheck(userId) {
  const filter = userId
    ? "SELECT * FROM watchlist WHERE user_id=? AND coin_detected=0"
    : "SELECT * FROM watchlist WHERE coin_detected=0";
  const items = userId
    ? db.prepare(filter).all(userId)
    : db.prepare(filter).all();

  if (!items.length) return [];

  const results = [];

  // 1. Quick DexScreener check for each signal name
  for (const item of items) {
    const signal = JSON.parse(item.signal_json);
    const keyword = signal.name.split(/[\s—–]/)[0];

    try {
      const dexRes = await axios.get(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(keyword)}`,
        { timeout: 5000 }
      );
      const fresh = (dexRes.data?.pairs || []).filter(p => {
        const ageH = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3_600_000 : 999;
        return ageH < 72 && p.chainId === "solana";
      });

      if (fresh.length > 0) {
        const coin = fresh[0];
        const detectedCoin = {
          name:     coin.baseToken?.name,
          ticker:   "$" + coin.baseToken?.symbol,
          chain:    "SOL",
          age:      ((Date.now() - coin.pairCreatedAt) / 3_600_000).toFixed(1) + "h old",
          mcap:     coin.marketCap ? "$" + Number(coin.marketCap).toLocaleString() : "Unknown",
          dex:      coin.url || `https://dexscreener.com/search?q=${keyword}`,
          pump:     `https://pump.fun/board?search=${encodeURIComponent(keyword)}`,
        };

        db.prepare(
          "UPDATE watchlist SET coin_detected=1, detected_coin=? WHERE id=?"
        ).run(JSON.stringify(detectedCoin), item.id);

        // Push alert via WebSocket
        push(item.user_id, {
          alertType: "coin_launch",
          title: "🚀 COIN LAUNCHED!",
          message: `${detectedCoin.ticker} just launched for "${signal.name}" — ${detectedCoin.age} · ${detectedCoin.mcap}`,
          coin: detectedCoin,
          signal,
        });

        results.push({ signalId: item.signal_id, status: "coin_detected", coin: detectedCoin });
      } else {
        results.push({ signalId: item.signal_id, status: "monitoring" });
      }
    } catch {
      results.push({ signalId: item.signal_id, status: "error" });
    }
  }

  return results;
}

module.exports = { router, runWatchlistCheck };
