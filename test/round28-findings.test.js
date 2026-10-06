"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const request = require("supertest");
const WebSocket = require("ws");
const { isWebmMime, normalizeWebmMime } = require("../app/lib/webm");
const { newId } = require("../app/lib/ids");

function bootServer() {
  const tmpDb = path.join(os.tmpdir(), `hc-r28-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  const { attachSignaling } = require("../app/modules/calls/signaling");
  const app = createApp();
  const server = http.createServer(app);
  attachSignaling(server);
  return { app, server, tmpDb };
}

describe("round28 findings", () => {
  let app;
  let server;
  let baseUrl;
  let tmpDb;

  before(async () => {
    const boot = bootServer();
    app = boot.app;
    server = boot.server;
    tmpDb = boot.tmpDb;
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("accepts recording upload with video/webm codec suffix in Content-Type", async () => {
    assert.equal(normalizeWebmMime("video/webm;codecs=vp9,opus"), "video/webm");
    assert.equal(isWebmMime("video/webm;codecs=vp8,opus"), true);
    const db = require("../app/db").getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r28 rec', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, consent_at_candidate, consent_at_employer, started_at)
       VALUES (?, ?, 'live', ?, ?, ?)`
    ).run(callId, invId, now, now, now);
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "cafe@demo.local", password: "demo-demo-demo" }),
    });
    assert.equal(loginRes.status, 200);
    const cookie = (loginRes.headers.getSetCookie?.() || [])
      .map((c) => c.split(";")[0])
      .join("; ");
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);
    const form = new FormData();
    form.append(
      "file",
      new Blob([webm], { type: "video/webm;codecs=vp9,opus" }),
      "employer.webm"
    );
    const up = await fetch(`${baseUrl}/api/calls/${callId}/recording`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    assert.equal(up.status, 200);
    const row = db.prepare("SELECT recording_path FROM calls WHERE id = ?").get(callId);
    assert.ok(fs.existsSync(path.join(row.recording_path, "employer.webm")));
  });

  it("signaling relays JSON as UTF-8 text (not opaque binary)", async () => {
    const db = require("../app/db").getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r28 sig', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    db.prepare(`INSERT INTO calls (id, invitation_id, status) VALUES (?, ?, 'ready')`).run(callId, invId);

    async function loginCookie(email) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "demo-demo-demo" }),
      });
      assert.equal(res.status, 200);
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      return raw.map((c) => c.split(";")[0]).join("; ");
    }
    const cafeCookie = await loginCookie("cafe@demo.local");
    const annaCookie = await loginCookie("anna@demo.local");
    const port = server.address().port;
    const url = `ws://127.0.0.1:${port}/ws/calls/${callId}`;
    const ws1 = new WebSocket(url, { headers: { Cookie: cafeCookie } });
    const ws2 = new WebSocket(url, { headers: { Cookie: annaCookie } });
    await Promise.all([
      new Promise((r, j) => {
        ws1.once("open", r);
        ws1.once("error", j);
      }),
      new Promise((r, j) => {
        ws2.once("open", r);
        ws2.once("error", j);
      }),
    ]);

    const offer = JSON.stringify({ t: "offer", sdp: { type: "offer", sdp: "v=0" } });
    const got = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 2000);
      ws2.once("message", (data, isBinary) => {
        clearTimeout(timer);
        resolve({ data, isBinary });
      });
    });
    ws1.send(offer);
    const { data, isBinary } = await got;
    assert.equal(isBinary, false);
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    assert.deepEqual(JSON.parse(text), JSON.parse(offer));
    ws1.close();
    ws2.close();
  });

  it("call UI defers В эфире until peer connection state", () => {
    const callJs = fs.readFileSync(path.join(__dirname, "../app/public/call.js"), "utf8");
    assert.match(callJs, /applyLiveUiIfReady/);
    assert.match(callJs, /peerConnected/);
    assert.doesNotMatch(callJs, /setLivePanel\(peerName, true\)/);
  });

  it("webrtc client parses binary WS payloads when present", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/public/call-room-webrtc.js"), "utf8");
    assert.match(src, /instanceof Blob/);
    assert.match(src, /recordingHasData/);
  });
});
