// src/db/index.js — Singleton DB connection
const Database = require("better-sqlite3");
const path     = require("path");
const fs       = require("fs");

const dbPath = process.env.DB_PATH || "./data/memeradar.db";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

module.exports = db;
