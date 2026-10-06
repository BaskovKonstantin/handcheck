"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const request = require("supertest");
const WebSocket = require("ws");

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

  it("P0-2: codec-suffixed WebM mimetype is accepted", async () => {
    const { assertWebmUpload, normalizeWebmMime } = require("../app/lib/webm");
    assert.equal(normalizeWebmMime("video/webm;codecs=vp9,opus"), "video/webm");
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]);
    assert.ok(
      assertWebmUpload({
        buffer: webm,
        mimetype: "video/webm;codecs=vp9,opus",
      })
    );
    const db = require("../app/db").getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r28', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, consent_at_candidate, consent_at_employer, started_at)
       VALUES (?, ?, 'live', ?, ?, ?)`
    ).run(callId, invId, now, now, now);
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    const up = await agent
      .post(`/api/calls/${callId}/recording`)
      .attach("file", webm, {
        filename: "employer.webm",
        contentType: "video/webm;codecs=vp9,opus",
      });
    assert.equal(up.status, 200);
  });

  it("P0-1: signaling relays UTF-8 text frames parseable as JSON", async () => {
    const db = require("../app/db").getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r28 ws', 'email', 'accepted')`
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
    const payload = JSON.stringify({ t: "offer", sdp: { type: "offer" } });
    const received = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 3000);
      ws2.once("message", (data) => {
        clearTimeout(timer);
        resolve(data);
      });
      ws1.send(Buffer.from(payload, "utf8"));
    });
    const text = Buffer.isBuffer(received) ? received.toString("utf8") : String(received);
    const parsed = JSON.parse(text);
    assert.equal(parsed.t, "offer");
    ws1.close();
    ws2.close();
  });

  it("P1-3: recorder bitrate fits 80 MB for 60 minutes", () => {
    const webrtcSrc = fs.readFileSync(
      path.join(__dirname, "../app/public/call-room-webrtc.js"),
      "utf8"
    );
    assert.match(webrtcSrc, /RECORDER_VIDEO_BPS\s*=\s*100_000/);
    assert.match(webrtcSrc, /RECORDER_AUDIO_BPS\s*=\s*15_000/);
    const RECORDING_LIMIT_BYTES = 80 * 1024 * 1024;
    const RECORDING_TARGET_SECONDS = 60 * 60;
    const RECORDER_TOTAL_BPS = 100_000 + 15_000;
    const projected = (RECORDER_TOTAL_BPS / 8) * RECORDING_TARGET_SECONDS;
    assert.ok(projected < RECORDING_LIMIT_BYTES * 0.85);
  });

  it("P2-10: ended calls reject WS upgrade", async () => {
    const db = require("../app/db").getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r28 end', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, ended_at) VALUES (?, ?, 'ended', datetime('now'))`
    ).run(callId, invId);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "cafe@demo.local", password: "demo-demo-demo" }),
    });
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const cookie = raw.map((c) => c.split(";")[0]).join("; ");
    const port = server.address().port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/calls/${callId}`, {
      headers: { Cookie: cookie },
    });
    const rejected = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(ws.readyState !== WebSocket.OPEN), 500);
      ws.once("close", () => {
        clearTimeout(timer);
        resolve(true);
      });
      ws.once("error", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    assert.equal(rejected, true);
    ws.terminate?.();
  });

  it("P1-5: speech recognition handles error and end in client", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../app/public/call-room-webrtc.js"),
      "utf8"
    );
    assert.match(src, /speech\.onerror/);
    assert.match(src, /speech\.onend/);
    assert.match(src, /JSON\.stringify\(\{ text, at \}\)/);
  });

  it("P2-8: duration hint is capitalized", async () => {
    const cafe = request.agent(app);
    await cafe.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    const db = require("../app/db").getDb();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafeId);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r28 dur', 'email', 'accepted')`
    ).run(invId, cafeId, need.id, anna.id);
    const callId = newId();
    const started = new Date(Date.now() - 30_000).toISOString();
    const ended = new Date().toISOString();
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, started_at, ended_at) VALUES (?, ?, 'ended', ?, ?)`
    ).run(callId, invId, started, ended);
    const info = await cafe.get(`/api/calls/for-invitation/${invId}`);
    assert.match(info.body.durationHint || "", /^Короткий/);
  });
});
