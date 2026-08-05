// src/routes/whale.js — Whale Entry Detection
// Uses: DexScreener (free), Helius (free tier), Solana public RPC
const express  = require("express");
const axios    = require("axios");
const db       = require("../db");
const { push } = require("../ws");
const { v4: uuid } = require("uuid");

const router = express.Router();

const HELIUS  = `https://api.helius.xyz/v0`;
const SOL_RPC = "https://api.mainnet-beta.solana.com";
const DEX_API = "https://api.dexscreener.com/latest/dex";
const BIRDEYE = "https://public-api.birdeye.so/defi";

const HELIUS_KEY = process.env.HELIUS_API_KEY || "";

// ── WHALE SCORING THRESHOLDS ──────────────────────────────
const WHALE_THRESHOLDS = {
  minBuySol:        5,      // Minimum SOL value of single buy to flag
  minWalletAgeDays: 14,     // Minimum wallet age in days
  minPriorTokens:   5,      // Minimum prior token interactions
  coordWindowMins:  60,     // Minutes window for coordinated buys
  minCoordWallets:  3,      // Wallets buying within window = coordinated
  accumSignal:      0.5,    // h1 volume / h24 volume ratio for accumulation
};

/* ── SCORE A WALLET AS WHALE ─────────────────────────────
   Returns 0-100 whale score + classification
──────────────────────────────────────────────────────── */
async function scoreWallet(address) {
  if (!HELIUS_KEY) {
    // Without Helius, use basic heuristic
    return { score: 50, classification: "UNKNOWN", reason: "No Helius key — add HELIUS_API_KEY for wallet scoring" };
  }
  try {
    // Get transaction history
    const txRes = await axios.get(`${HELIUS}/addresses/${address}/transactions`, {
      params: { "api-key": HELIUS_KEY, limit: 50 },
      timeout: 6000,
    });
    const txs = txRes.data || [];

    // Get balance
    const balRes = await axios.post(SOL_RPC, {
      jsonrpc: "2.0", id: 1, method: "getBalance", params: [address]
    }, { timeout: 5000 });
    const solBalance = (balRes.data?.result?.value || 0) / 1e9;

    // Calculate wallet age
    const oldestTx  = txs.length > 0 ? txs[txs.length - 1] : null;
    const walletAge = oldestTx
      ? (Date.now() / 1000 - oldestTx.timestamp) / 86400
      : 0;

    // Count unique token interactions
    const uniqueTokens = new Set(txs.flatMap(tx =>
      (tx.tokenTransfers || []).map(t => t.mint)
    )).size;

    // Score
    let score = 0;
    if (solBalance >= 500) score += 30;
    else if (solBalance >= 100) score += 20;
    else if (solBalance >= 20)  score += 10;

    if (walletAge >= 180) score += 25;
    else if (walletAge >= 90)  score += 18;
    else if (walletAge >= 30)  score += 10;
    else if (walletAge >= 14)  score += 5;

    if (uniqueTokens >= 50) score += 25;
    else if (uniqueTokens >= 20) score += 18;
    else if (uniqueTokens >= 10) score += 10;
    else if (uniqueTokens >= 5)  score += 5;

    if (txs.length >= 200) score += 20;
    else if (txs.length >= 100) score += 13;
    else if (txs.length >= 50)  score += 8;

    const classification =
      score >= 80 ? "MEGA_WHALE" :
      score >= 65 ? "WHALE" :
      score >= 45 ? "MID_FISH" :
      score >= 25 ? "RETAIL" : "FRESH_WALLET";

    return {
      score, classification, solBalance: solBalance.toFixed(2),
      walletAge: Math.floor(walletAge), uniqueTokens, txCount: txs.length,
      reason: `${solBalance.toFixed(0)} SOL · ${Math.floor(walletAge)}d old · ${uniqueTokens} tokens`,
    };
  } catch (e) {
    return { score: 40, classification: "UNKNOWN", reason: e.message };
  }
}

/* ── DETECT WHALE ENTRIES ON A TOKEN ────────────────────
   Main detection function — checks multiple sources
──────────────────────────────────────────────────────── */
async function detectWhales(tokenAddress, pairAddress) {
  const signals = [];

  // 1. DexScreener — volume/price signals
  try {
    const dexRes = await axios.get(`${DEX_API}/tokens/${tokenAddress}`, { timeout: 8000 });
    const pairs  = dexRes.data?.pairs || [];
    const pair   = pairs.find(p => p.chainId === "solana") || pairs[0];

    if (pair) {
      const h1Vol  = pair.volume?.h1  || 0;
      const h24Vol = pair.volume?.h24 || 1;
      const h1Buys = pair.txns?.h1?.buys  || 0;
      const h1Change = Math.abs(pair.priceChange?.h1 || 0);

      // Accumulation signal: volume spike without price spike
      if (h1Vol > 1000 && h1Change < 5 && h1Buys >= 5) {
        signals.push({
          type:   "ACCUMULATION",
          detail: `$${h1Vol.toLocaleString()} bought in last 1h with only ${h1Change.toFixed(1)}% price move — classic accumulation`,
          severity: "HIGH",
          source: "DexScreener"
        });
      }

      // Sudden volume spike
      const volRatio = h24Vol > 0 ? h1Vol / (h24Vol / 24) : 0;
      if (volRatio > 3) {
        signals.push({
          type:   "VOLUME_SPIKE",
          detail: `1h volume is ${volRatio.toFixed(1)}x the hourly average — abnormal buying pressure`,
          severity: volRatio > 6 ? "CRITICAL" : "HIGH",
          source: "DexScreener"
        });
      }

      // Lopsided buy/sell ratio
      const h1Sells = pair.txns?.h1?.sells || 1;
      const buyRatio = h1Buys / h1Sells;
      if (buyRatio > 4 && h1Buys > 10) {
        signals.push({
          type:   "BUY_PRESSURE",
          detail: `${h1Buys} buys vs ${h1Sells} sells in last 1h — ${buyRatio.toFixed(1)}:1 ratio`,
          severity: "HIGH",
          source: "DexScreener"
        });
      }
    }
  } catch (e) {
    console.warn("[Whale] DexScreener error:", e.message);
  }

  // 2. Solana RPC — top holders
  let topHolders = [];
  try {
    const holdersRes = await axios.post(SOL_RPC, {
      jsonrpc:"2.0", id:1,
      method: "getTokenLargestAccounts",
      params: [tokenAddress, { commitment: "confirmed" }]
    }, { timeout: 8000 });

    topHolders = holdersRes.data?.result?.value || [];

    // Check top 5 holders for concentration
    const top5Pct = topHolders.slice(0,5).reduce((a,h) => a + (h.uiAmount||0), 0);
    if (top5Pct > 0) {
      // Can't get total supply easily here but flag high holder count changes
    }
  } catch (e) {
    console.warn("[Whale] RPC error:", e.message);
  }

  // 3. Birdeye — recent large trades (free tier)
  let largeTraders = [];
  try {
    const beRes = await axios.get(`${BIRDEYE}/trades/token`, {
      params: { address: tokenAddress, tx_type: "buy", sort_type: "DESC", limit: 20 },
      headers: { "X-API-KEY": process.env.BIRDEYE_API_KEY || "public" },
      timeout: 8000,
    });
    const trades = beRes.data?.data?.items || [];

    // Flag trades over 5 SOL (~$900 at ~$180/SOL)
    const bigTrades = trades.filter(t => (t.volume || 0) > 900);
    if (bigTrades.length >= 2) {
      largeTraders = bigTrades.slice(0,5).map(t => ({
        address: t.owner || "unknown",
        amount:  `$${Math.round(t.volume).toLocaleString()}`,
        time:    new Date(t.blockUnixTime * 1000).toISOString(),
      }));

      signals.push({
        type:   "LARGE_BUYS",
        detail: `${bigTrades.length} buys over $900 in recent transactions — large wallets entering`,
        severity: bigTrades.length >= 5 ? "CRITICAL" : "HIGH",
        source: "Birdeye",
        wallets: largeTraders
      });
    }

    // Check for coordinated buying (multiple large buys within 60 min)
    if (bigTrades.length >= 3) {
      const now    = Date.now() / 1000;
      const window = 60 * 60;
      const recent = bigTrades.filter(t => now - (t.blockUnixTime || 0) < window);
      if (recent.length >= 3) {
        signals.push({
          type:   "COORDINATED_BUYING",
          detail: `${recent.length} large buys within 60 minutes — possible coordinated whale entry`,
          severity: "CRITICAL",
          source: "Birdeye"
        });
      }
    }
  } catch (e) {
    console.warn("[Whale] Birdeye error:", e.message);
  }

  // 4. Score top holders via Helius
  let whaleWallets = [];
  if (HELIUS_KEY && topHolders.length > 0) {
    const scored = await Promise.allSettled(
      topHolders.slice(0,3).map(h => scoreWallet(h.address))
    );
    whaleWallets = scored
      .map((r,i) => r.status==="fulfilled" ? { address: topHolders[i]?.address, ...r.value } : null)
      .filter(Boolean)
      .filter(w => w.score >= 65);

    if (whaleWallets.length > 0) {
      signals.push({
        type:   "WHALE_HOLDER",
        detail: `${whaleWallets.length} whale-classified wallet(s) in top holders: ${whaleWallets.map(w=>w.classification).join(", ")}`,
        severity: whaleWallets.some(w=>w.score>=80) ? "CRITICAL" : "HIGH",
        source: "Helius",
        wallets: whaleWallets
      });
    }
  }

  // Overall whale score
  const severity = signals.some(s=>s.severity==="CRITICAL") ? "CRITICAL" :
                   signals.some(s=>s.severity==="HIGH")     ? "HIGH"     :
                   signals.length > 0                        ? "MEDIUM"   : "NONE";

  const whaleScore = Math.min(100,
    signals.reduce((a,s) => a + (s.severity==="CRITICAL"?35:s.severity==="HIGH"?20:10), 0)
  );

  return { signals, severity, whaleScore, largeTraders, whaleWallets, tokenAddress };
}

/* ── ROUTES ──────────────────────────────────────────── */

// POST /api/whale/scan — scan a specific token for whale activity
router.post("/scan", async (req, res) => {
  const { userId, tokenAddress, ticker } = req.body;
  if (!tokenAddress && !ticker) return res.status(400).json({ error: "tokenAddress or ticker required" });

  try {
    let addr = tokenAddress;

    // If only ticker given, look it up on DexScreener first
    if (!addr && ticker) {
      const dexRes = await axios.get(`${DEX_API}/search?q=${encodeURIComponent(ticker)}`, { timeout: 8000 });
      const pair   = (dexRes.data?.pairs||[]).find(p=>p.chainId==="solana");
      if (!pair) return res.status(404).json({ error: `No Solana pair found for ${ticker}` });
      addr = pair.baseToken?.address;
    }

    const result = await detectWhales(addr, null);

    // Persist and push alert if critical
    if (userId && result.severity !== "NONE") {
      push(userId, {
        alertType: result.severity === "CRITICAL" ? "whale_critical" : "whale_entry",
        title:     `🐋 WHALE ${result.severity}: ${ticker || addr.slice(0,8)}`,
        message:   result.signals[0]?.detail || "Whale activity detected",
        whaleScore: result.whaleScore,
        signals:   result.signals,
      });
    }

    res.json({ ...result, ticker, ts: Date.now() });
  } catch (e) {
    console.error("[Whale] scan error:", e.message);
    res.status(500).json({ error: "Whale scan failed", message: e.message });
  }
});

// GET /api/whale/monitor/:userId — scan all watchlist coins
router.post("/monitor", async (req, res) => {
  const { userId, tokens = [] } = req.body;
  if (!userId || !tokens.length) return res.status(400).json({ error: "userId + tokens required" });

  const results = [];
  for (const token of tokens.slice(0, 5)) { // max 5 per call to avoid rate limits
    try {
      const r = await detectWhales(token.address, null);
      results.push({ ...r, name: token.name, ticker: token.ticker });
      if (r.severity === "CRITICAL" || r.severity === "HIGH") {
        push(userId, {
          alertType: "whale_entry",
          title:     `🐋 WHALE DETECTED: ${token.ticker}`,
          message:   r.signals[0]?.detail,
          whaleScore: r.whaleScore,
          vikaAlert: `Whale alert on ${token.ticker}. Score ${r.whaleScore} out of 100. ${r.signals[0]?.detail}. ${r.severity === "CRITICAL" ? "This is a critical signal — act fast." : "Worth watching closely."}`,
        });
      }
    } catch (e) {
      results.push({ tokenAddress: token.address, error: e.message });
    }
  }
  res.json({ results, ts: Date.now() });
});

module.exports = { router, detectWhales };
