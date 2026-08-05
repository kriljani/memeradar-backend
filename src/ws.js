// src/ws.js — WebSocket manager for real-time push alerts
const { WebSocketServer } = require("ws");
const db = require("./db");
const { v4: uuid } = require("uuid");

let wss;
// Map: userId → Set of WebSocket connections
const userSockets = new Map();

function init(server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    // Expect client to send { type:"auth", userId:"..." } as first message
    let userId = null;

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === "auth" && msg.userId) {
          userId = msg.userId;
          if (!userSockets.has(userId)) userSockets.set(userId, new Set());
          userSockets.get(userId).add(ws);
          ws.send(JSON.stringify({ type: "auth_ok", userId }));
          // Send any unread alerts
          const unread = db.prepare(
            "SELECT * FROM alerts WHERE user_id=? AND read=0 ORDER BY created_at DESC LIMIT 20"
          ).all(userId);
          if (unread.length) ws.send(JSON.stringify({ type: "unread_alerts", alerts: unread }));
        }
      } catch {}
    });

    ws.on("close", () => {
      if (userId && userSockets.has(userId)) {
        userSockets.get(userId).delete(ws);
        if (userSockets.get(userId).size === 0) userSockets.delete(userId);
      }
    });
  });

  console.log("✅ WebSocket server ready");
}

/* Push alert to a specific user (or broadcast if userId is null) */
function push(userId, payload) {
  const message = JSON.stringify({ type: "alert", ...payload });
  if (userId) {
    const sockets = userSockets.get(userId);
    if (sockets) sockets.forEach(ws => { try { ws.send(message); } catch {} });
  } else {
    // Broadcast to all connected clients
    wss?.clients.forEach(ws => { try { ws.send(message); } catch {} });
  }
  // Persist to alerts table
  if (userId) {
    db.prepare(
      "INSERT INTO alerts (id,user_id,type,title,message) VALUES (?,?,?,?,?)"
    ).run(uuid(), userId, payload.alertType || "info", payload.title || "", payload.message || "");
  }
}

module.exports = { init, push };
