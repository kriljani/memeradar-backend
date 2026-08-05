// src/routes/dex.js — DexScreener + price data proxy
const express = require("express");
const axios   = require("axios");

const router = express.Router();
const DEX_BASE = "https://api.dexscreener.com/latest/dex";

/* GET /api/dex/search?q=HEDGY — search tokens */
router.get("/search", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "q required" });
  try {
    const r = await axios.get(`${DEX_BASE}/search?q=${encodeURIComponent(q)}`, { timeout: 6000 });
    const pairs = (r.data?.pairs || [])
      .slice(0, 10)
      .map(p => ({
        chainId:       p.chainId,
        dexId:         p.dexId,
        pairAddress:   p.pairAddress,
        baseToken:     p.baseToken,
        quoteToken:    p.quoteToken,
        priceUsd:      p.priceUsd,
        priceNative:   p.priceNative,
        volume24h:     p.volume?.h24,
        liquidity:     p.liquidity?.usd,
        mcap:          p.marketCap,
        ageHours:      p.pairCreatedAt
          ? ((Date.now() - p.pairCreatedAt) / 3_600_000).toFixed(1)
          : null,
        url:           p.url,
        txns24h:       p.txns?.h24,
        priceChange:   p.priceChange,
      }));
    res.json({ pairs, q, ts: Date.now() });
  } catch (err) {
    console.error("[DEX] Search error:", err.message);
    res.status(502).json({ error: "DexScreener unavailable", pairs: [] });
  }
});

/* GET /api/dex/new — new Solana pairs < 24h */
router.get("/new", async (req, res) => {
  try {
    const r = await axios.get(`${DEX_BASE}/search?q=SOL`, { timeout: 6000 });
    const fresh = (r.data?.pairs || [])
      .filter(p => {
        if (!p.pairCreatedAt) return false;
        const ageH = (Date.now() - p.pairCreatedAt) / 3_600_000;
        return ageH < 48 && p.chainId === "solana";
      })
      .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
      .slice(0, 20)
      .map(p => ({
        name:        p.baseToken?.name,
        ticker:      p.baseToken?.symbol,
        address:     p.baseToken?.address,
        priceUsd:    p.priceUsd,
        volume24h:   p.volume?.h24,
        liquidity:   p.liquidity?.usd,
        mcap:        p.marketCap,
        ageHours:    ((Date.now() - p.pairCreatedAt) / 3_600_000).toFixed(1),
        url:         p.url,
        priceChange: p.priceChange,
      }));
    res.json({ pairs: fresh, ts: Date.now() });
  } catch (err) {
    res.status(502).json({ error: "DexScreener unavailable", pairs: [] });
  }
});

/* GET /api/dex/token/:address — single token data */
router.get("/token/:address", async (req, res) => {
  try {
    const r = await axios.get(`${DEX_BASE}/tokens/${req.params.address}`, { timeout: 6000 });
    res.json(r.data);
  } catch (err) {
    res.status(502).json({ error: "DexScreener unavailable" });
  }
});

module.exports = router;
