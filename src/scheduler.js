// src/scheduler.js — Auto news scan + watchlist monitor + Polymarket
const cron       = require("node-cron");
const Anthropic   = require("@anthropic-ai/sdk");
const db          = require("./db");
const { push }    = require("./ws");
const { runWatchlistCheck } = require("./routes/watchlist");
const { v4: uuid } = require("uuid");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WATCH_MINS = parseInt(process.env.MONITOR_INTERVAL_MINS || "3");
const NEWS_MINS  = parseInt(process.env.NEWS_SCAN_INTERVAL_MINS || "15");

function start() {
  // ── Watchlist check every N minutes ──────────────
  cron.schedule(`*/${WATCH_MINS} * * * *`, async () => {
    try { await runWatchlistCheck(null); } catch (e) { console.error("[Scheduler] watchlist:", e.message); }
  });

  // ── News scan every N minutes ─────────────────────
  cron.schedule(`*/${NEWS_MINS} * * * *`, async () => {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6", max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: `News bot. Return ONLY raw JSON: {"news":[{"id":"uid","emoji":"","headline":"","brief":"","sources":[{"name":"","url":""}],"publishedAt":"","topics":[],"category":"POLITICS|SOCIAL|NEWS|PLATFORM","impact":0,"newsType":"BREAKING|ANALYSIS|RUMOR","whyMatters":""}]} — only impact 70+, max 8 items.`,
        messages: [{ role:"user", content:"Latest verified crypto/political news (last 3h) impacting meme coins. Focus on Dem 2028 candidates, midterm moments, viral stories, Pump.fun." }]
      });
      const txt   = response.content.map(b => b.type==="text"?b.text:"").join("");
      const match = txt.match(/\{[\s\S]*\}/);
      if (!match) return;
      const items = JSON.parse(match[0]).news || [];
      const insert = db.prepare(`INSERT OR REPLACE INTO news_cache (id,headline,brief,sources_json,impact,category,news_type,why_matters,topics_json,emoji,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,strftime('%s','now'))`);
      db.transaction(rows => { for (const n of rows) insert.run(n.id||uuid(),n.headline,n.brief,JSON.stringify(n.sources||[]),n.impact||50,n.category,n.newsType||"ANALYSIS",n.whyMatters,JSON.stringify(n.topics||[]),n.emoji||"📰"); })(items.slice(0,8));
      items.filter(n=>n.newsType==="BREAKING"&&n.impact>=85).forEach(n => {
        push(null, { alertType:"breaking_news", title:`📰 BREAKING: ${n.emoji} ${n.headline.slice(0,60)}`, message:`Impact ${n.impact}/100 — ${n.whyMatters?.slice(0,100)}` });
      });
      console.log(`[Scheduler] News: ${items.length} cached`);
    } catch(e) { console.error("[Scheduler] news:", e.message); }
  });

  // ── Polymarket odds monitor every 30 min ─────────
  cron.schedule("*/30 * * * *", async () => {
    try {
      const axios = require("axios");
      const res   = await axios.get("https://gamma-api.polymarket.com/markets?tag=politics&limit=5&sort=volume", { timeout:5000 });
      (res.data||[]).slice(0,3).forEach(m => {
        if ((m.volume24h||0) > 100000) {
          push(null, { alertType:"polymarket", title:"📊 Polymarket Volume Spike", message:`${m.question||"Market"} — 24h vol: $${Number(m.volume24h).toLocaleString()}` });
        }
      });
    } catch {}
  });


  // ── Whale monitor every 15 minutes ──────────────────
  cron.schedule("*/15 * * * *", async () => {
    try {
      const { detectWhales } = require("./routes/whale");
      // Get all watchlist items with coin detected (have a token address)
      const coins = db.prepare(
        "SELECT detected_coin FROM watchlist WHERE coin_detected=1 LIMIT 10"
      ).all();
      for (const row of coins) {
        if (!row.detected_coin) continue;
        try {
          const coin = JSON.parse(row.detected_coin);
          if (!coin.address) continue;
          const result = await detectWhales(coin.address, null);
          if (result.severity === "CRITICAL" || result.severity === "HIGH") {
            // Push to all connected users who watch this
            push(null, {
              alertType: "whale_entry",
              title: `🐋 WHALE ${result.severity}: ${coin.ticker || coin.name}`,
              message: result.signals[0]?.detail || "Whale activity detected",
              whaleScore: result.whaleScore,
              vikaAlert: `Whale alert on ${coin.ticker}. Score ${result.whaleScore} out of 100. ${result.signals[0]?.detail}`,
            });
          }
        } catch {}
      }
    } catch(e) { console.error("[Scheduler] whale:", e.message); }
  });
  console.log(`✅ Scheduler: watchlist every ${WATCH_MINS}m · news every ${NEWS_MINS}m · Polymarket every 30m`);
}

module.exports = { start };
