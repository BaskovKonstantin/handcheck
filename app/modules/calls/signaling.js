"use strict";

const { WebSocketServer } = require("ws");
const { loadSession } = require("../../middleware/auth");
const { getDb } = require("../../db");

const rooms = new Map();

function broadcastCallEnded(callId) {
  const set = rooms.get(callId);
  if (!set) return;
  const payload = JSON.stringify({ t: "ended" });
  for (const peer of set) {
    if (peer.readyState === 1) peer.send(payload);
  }
}

function attachSignaling(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const m = req.url?.match(/^\/ws\/calls\/([^/?]+)/);
    if (!m) return;
    const callId = m[1];
    req.user = null;
    const fakeReq = { headers: { cookie: req.headers.cookie } };
    const session = loadSession(fakeReq);
    if (!session) {
      socket.destroy();
      return;
    }
    const db = getDb();
    const call = db.prepare("SELECT invitation_id, status FROM calls WHERE id = ?").get(callId);
    if (!call || call.status === "ended") {
      socket.destroy();
      return;
    }
    const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
    const uid = session.user_id;
    if (!inv || inv.status !== "accepted" || ![inv.candidate_user_id, inv.employer_user_id].includes(uid)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.callId = callId;
      ws.userId = uid;
      if (!rooms.has(callId)) rooms.set(callId, new Set());
      const set = rooms.get(callId);
      for (const peer of set) {
        if (peer.userId === uid) {
          set.delete(peer);
          try {
            peer.close();
          } catch {
            /* ignore */
          }
        }
      }
      if (set.size >= 2) {
        ws.close();
        return;
      }
      set.add(ws);
      ws.on("message", (data) => {
        const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        for (const peer of set) {
          if (peer !== ws && peer.readyState === 1) peer.send(text);
        }
      });
      ws.on("close", () => {
        const closedUserId = ws.userId;
        set.delete(ws);
        const sameUserReconnected = [...set].some(
          (peer) => peer.userId === closedUserId && peer.readyState === 1
        );
        if (set.size > 0 && !sameUserReconnected) {
          const payload = JSON.stringify({ t: "peer_left" });
          for (const peer of set) {
            if (peer.readyState === 1) peer.send(payload);
          }
        }
        if (set.size === 0) rooms.delete(callId);
      });
    });
  });
}

module.exports = { attachSignaling, broadcastCallEnded, roomsForTest: rooms };
