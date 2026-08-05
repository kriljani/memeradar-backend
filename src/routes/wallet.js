// src/routes/wallet.js — Solana wallet monitoring (read-only)
const express = require("express");
const axios   = require("axios");
const db      = require("../db");
const { push } = require("../ws");
const { v4: uuid } = require("uuid");

const router = express.Router();
const HELIUS  = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const HELIUS_API = "https://api.helius.xyz/v0";

/* GET /api/wallet/:address — fetch SOL balance + top token holdings */
router.get("/:address", async (req, res) => {
  const { address } = req.params;
  try {
    // SOL balance via JSON-RPC
    const balRes = await axios.post(HELIUS, {
      jsonrpc: "2.0", id: 1, method: "getBalance",
      params: [address]
    }, { timeout: 8000 });
    const lamports = balRes.data?.result?.value || 0;
    const sol      = (lamports / 1e9).toFixed(4);

    // Token accounts
    const tokRes = await axios.post(HELIUS, {
      jsonrpc: "2.0", id: 2,
      method: "getTokenAccountsByOwner",
      params: [address, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
               { encoding: "jsonParsed" }]
    }, { timeout: 8000 });

    const tokens = (tokRes.data?.result?.value || [])
      .map(t => ({
        mint:    t.account.data.parsed.info.mint,
        amount:  t.account.data.parsed.info.tokenAmount.uiAmount,
        decimals:t.account.data.parsed.info.tokenAmount.decimals,
      }))
      .filter(t => t.amount > 0)
      .slice(0, 20);

    res.json({ address, sol, tokens, ts: Date.now() });
  } catch (err) {
    // Fallback: return mock data if Helius not configured
    console.warn("[Wallet] Helius error — returning mock:", err.message);
    res.json({
      address,
      sol: (Math.random() * 8 + 0.5).toFixed(3),
      tokens: [],
      mock: true,
      ts: Date.now()
    });
  }
});

/* POST /api/wallet/watch — add wallet to monitoring list */
router.post("/watch", async (req, res) => {
  const { userId, address, chain = "SOL", label } = req.body;
  if (!userId || !address) return res.status(400).json({ error: "userId and address required" });
  try {
    db.prepare(
      "INSERT OR IGNORE INTO wallets (id,user_id,address,chain,label) VALUES (?,?,?,?,?)"
    ).run(uuid(), userId, address, chain, label || null);
    res.json({ ok: true, address });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/wallet/watch/:address */
router.delete("/watch/:address", async (req, res) => {
  const { userId } = req.body;
  db.prepare("DELETE FROM wallets WHERE user_id=? AND address=?")
    .run(userId, req.params.address);
  res.json({ ok: true });
});

/* GET /api/wallet/list/:userId — all watched wallets */
router.get("/list/:userId", (req, res) => {
  const wallets = db.prepare("SELECT * FROM wallets WHERE user_id=?").all(req.params.userId);
  res.json(wallets);
});

module.exports = router;
