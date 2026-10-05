"use strict";

const { WebSocketServer } = require("ws");
const { loadSession } = require("../../middleware/auth");
const { getDb } = require("../../db");

function attachSignaling(server) {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map();

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
    const call = db.prepare("SELECT invitation_id FROM calls WHERE id = ?").get(callId);
    if (!call) {
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
      if (set.size >= 2) {
        ws.close();
        return;
      }
      set.add(ws);
      ws.on("message", (data) => {
        for (const peer of set) {
          if (peer !== ws && peer.readyState === 1) peer.send(data);
        }
      });
      ws.on("close", () => {
        set.delete(ws);
        if (set.size === 0) rooms.delete(callId);
      });
    });
  });
}

module.exports = { attachSignaling };
