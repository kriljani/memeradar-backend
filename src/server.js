// src/server.js — MemeRadar v14 Production Server
require("dotenv").config();
const express  = require("express");
const helmet   = require("helmet");
const cors     = require("cors");
const http     = require("http");

// Init DB first
try { require("./db/migrate"); } catch {}

const ws        = require("./ws");
const scheduler = require("./scheduler");

const app    = express();
const server = http.createServer(app);

// Trust Railway proxy
app.set("trust proxy", 1);

// ── Security ──────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const allowed = [
  process.env.FRONTEND_URL,
  "http://localhost:3000", "http://localhost:5173", "https://claude.ai",
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl)
    if (!origin) return cb(null, true);
    // Allow all vercel.app subdomains
    if (origin.endsWith(".vercel.app")) return cb(null, true);
    // Allow configured frontend URL
    if (allowed.some(o => o && origin.startsWith(o))) return cb(null, true);
    return cb(null, true); // Allow all for now — tighten after testing
  },
  credentials: true,
}));
// ── Self-healing JSON body parser ─────────────────
// Escapes raw control characters inside string literals, which is the exact
// cause of "Bad control character in string literal". Strict express.json()
// throws a 500 on these; this repairs them instead.
function sanitizeJson(raw){
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i], code = raw.charCodeAt(i);
    if (esc) { out += ch; esc = false; continue; }
    if (ch === "\\" && inStr) { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && code < 0x20) {
      if      (code === 0x0A) out += "\\n";
      else if (code === 0x0D) out += "\\r";
      else if (code === 0x09) out += "\\t";
      else if (code === 0x08) out += "\\b";
      else if (code === 0x0C) out += "\\f";
      else out += "\\u" + code.toString(16).padStart(4, "0");
      continue;
    }
    out += ch;
  }
  return out;
}

app.use(express.text({ type: ["application/json", "text/plain"], limit: "4mb" }));
app.use((req, res, next) => {
  if (typeof req.body !== "string" || !req.body.length) {
    if (typeof req.body !== "object" || req.body === null) req.body = {};
    return next();
  }
  try {
    req.body = JSON.parse(req.body);
  } catch (e1) {
    try {
      req.body = JSON.parse(sanitizeJson(req.body));
      console.warn("[Body] Repaired malformed JSON on", req.path);
    } catch (e2) {
      console.error("[Body] Unparseable JSON on", req.path, "-", e2.message);
      return res.status(400).json({ error: "Malformed JSON body: " + e2.message });
    }
  }
  next();
});

// ── Health ────────────────────────────────────────
app.get("/health", (_, res) => res.json({
  status:"ok", version:"2.0.0",
  ts: new Date().toISOString(),
  trading: process.env.TRADING_ENABLED === "true" ? "live" : "simulated",
}));

// ── Routes ────────────────────────────────────────
app.use("/api/ai",        require("./routes/ai"));
app.use("/api/viki",      require("./routes/viki"));
app.use("/api/indigo",    require("./routes/indigo"));
app.use("/api/wallet",    require("./routes/wallet"));
app.use("/api/dex",       require("./routes/dex"));
app.use("/api/watchlist", require("./routes/watchlist").router);
app.use("/api/data",      require("./routes/data"));
app.use("/api/whale",     require("./routes/whale").router);

app.use((req, res) => res.status(404).json({ error: `Not found: ${req.path}` }));
app.use((err, req, res, next) => {
  console.error("[Server]", req.method, req.path, "-", err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal error" });
});

// ── WebSocket + Scheduler ─────────────────────────
ws.init(server);
if (process.env.NODE_ENV !== "test") scheduler.start();

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║    M E M E R A D A R  v14 · BACKEND v2.0    ║
╠══════════════════════════════════════════════╣
║  Port:    ${String(PORT).padEnd(34)}║
║  Mode:    ${(process.env.NODE_ENV||"dev").padEnd(34)}║
║  Trading: ${(process.env.TRADING_ENABLED==="true"?"LIVE":"Simulated").padEnd(34)}║
╚══════════════════════════════════════════════╝

Routes active:
  POST /api/ai/messages          AI proxy (secure)
  POST /api/viki/chat            VIKI conversation
  GET  /api/viki/history/:uid    VIKI chat history
  POST /api/indigo/analyze       INDIGO 8-layer engine
  POST /api/indigo/rug           Rug DNA scanner
  GET  /api/dex/search           DexScreener search
  GET  /api/dex/new              New pairs < 48h
  GET  /api/wallet/:address      SOL balance + tokens
  POST /api/watchlist            Add to watchlist
  POST /api/data/session         Create/refresh session
  WS   /ws                       Real-time push alerts
  `);
});

module.exports = { app, server };
