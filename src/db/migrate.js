// src/db/migrate.js — MemeRadar v14 schema
const Database = require("better-sqlite3");
const fs = require("fs");
require("dotenv").config();

const dbPath = process.env.DB_PATH || "./data/memeradar.db";
fs.mkdirSync(require("path").dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    last_seen  INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    address TEXT NOT NULL, chain TEXT DEFAULT 'SOL', label TEXT,
    added_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(user_id, address)
  );
  CREATE TABLE IF NOT EXISTS watchlist (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    signal_id TEXT NOT NULL, signal_json TEXT NOT NULL,
    added_at INTEGER DEFAULT (strftime('%s','now')),
    coin_detected INTEGER DEFAULT 0, detected_coin TEXT,
    UNIQUE(user_id, signal_id)
  );
  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    text TEXT NOT NULL, time_label TEXT NOT NULL,
    urgent INTEGER DEFAULT 0, done INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS news_cache (
    id TEXT PRIMARY KEY, headline TEXT NOT NULL,
    brief TEXT, sources_json TEXT, impact INTEGER,
    category TEXT, news_type TEXT, why_matters TEXT,
    topics_json TEXT, emoji TEXT,
    fetched_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS trade_log (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    action TEXT NOT NULL, ticker TEXT NOT NULL,
    size_sol REAL, entry_price REAL, pnl_pct REAL,
    fusion_score INTEGER, reason TEXT,
    status TEXT DEFAULT 'open',
    opened_at INTEGER DEFAULT (strftime('%s','now')),
    closed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS indigo_signals (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    ticker TEXT NOT NULL, action TEXT NOT NULL,
    confidence INTEGER, fusion_score INTEGER,
    layer_scores_json TEXT, reason TEXT,
    rug_flags_json TEXT, whale_alert TEXT,
    urgency TEXT, signal_source TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS rug_scans (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    ticker TEXT NOT NULL, safe_score INTEGER,
    verdict TEXT, checks_json TEXT,
    red_flags_json TEXT, green_flags_json TEXT,
    recommendation TEXT,
    scanned_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    type TEXT NOT NULL, title TEXT NOT NULL,
    message TEXT NOT NULL, read INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
`);

console.log("✅  MemeRadar v14 — DB migrated:", dbPath);
db.close();
