"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const net = require("net");
const request = require("supertest");
const {
  HTTP_KEEP_ALIVE_TIMEOUT_MS,
  HTTP_HEADERS_TIMEOUT_MS,
  configureHttpServerTimeouts,
  start,
} = require("../app/server");
const {
  shouldAttachTailOnFinalizeAttempt,
  finalizeRetryDelayMs,
  recordingFinalizeNeedsTailAgain,
  isRetryableFinalizeStatus,
} = require("../app/lib/recording-finalize-retry");
const { isPlayableRecordingFile, MIN_PLAYABLE_RECORDING_BYTES } = require("../app/lib/call-recording");

function fakeEbml(size = MIN_PLAYABLE_RECORDING_BYTES + 200) {
  const buf = Buffer.alloc(size, 0xab);
  buf[0] = 0x1a;
  buf[1] = 0x45;
  buf[2] = 0xdf;
  buf[3] = 0xa3;
  return buf;
}

function fakeCluster(size = MIN_PLAYABLE_RECORDING_BYTES + 200) {
  const buf = Buffer.alloc(size, 0xcd);
  buf[0] = 0x1f;
  buf[1] = 0x43;
  buf[2] = 0xb6;
  buf[3] = 0x75;
  return buf;
}

function freshApp(extraEnv = {}) {
  const tmpDb = path.join(os.tmpdir(), `hc-r106-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  process.env.CALLS_DIR = path.join(os.tmpdir(), `hc-r106-calls-${process.pid}-${Date.now()}`);
  Object.assign(process.env, extraEnv);
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  return { app: createApp(), tmpDb };
}

function httpExchange(socket, payload) {
  return new Promise((resolve, reject) => {
    socket.write(payload);
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buf.slice(0, headerEnd).toString("utf8");
      const m = header.match(/Content-Length:\s*(\d+)/i);
      const bodyLen = m ? Number(m[1]) : 0;
      const total = headerEnd + 4 + bodyLen;
      if (buf.length >= total) {
        socket.off("data", onData);
        const body = buf.slice(headerEnd + 4, total).toString("utf8");
        const statusLine = header.split("\r\n")[0];
        const status = Number(statusLine.split(" ")[1]);
        resolve({ status, body, header });
      }
    };
    socket.on("data", onData);
    socket.on("error", reject);
  });
}

describe("round106 recording finalize keep-alive + idempotency", () => {
  it("configures HTTP keep-alive above Node default for reverse-proxy pools", () => {
    assert.equal(HTTP_KEEP_ALIVE_TIMEOUT_MS, 65_000);
    assert.ok(HTTP_HEADERS_TIMEOUT_MS > HTTP_KEEP_ALIVE_TIMEOUT_MS);
    const server = http.createServer();
    configureHttpServerTimeouts(server);
    assert.equal(server.keepAliveTimeout, HTTP_KEEP_ALIVE_TIMEOUT_MS);
    assert.equal(server.headersTimeout, HTTP_HEADERS_TIMEOUT_MS);
    server.close();
  });

  it("client finalize retry policy: tail once, then duration-only; tail again if still missing", () => {
    assert.equal(shouldAttachTailOnFinalizeAttempt(0, 1000, false), true);
    assert.equal(shouldAttachTailOnFinalizeAttempt(1, 1000, true), false);
    assert.equal(shouldAttachTailOnFinalizeAttempt(2, 1000, true), false);
    assert.ok(finalizeRetryDelayMs(2) >= finalizeRetryDelayMs(1));
    assert.equal(isRetryableFinalizeStatus(502), true);
    assert.equal(
      recordingFinalizeNeedsTailAgain(400, { error: "file_required" }, true),
      true
    );
    assert.equal(
      recordingFinalizeNeedsTailAgain(400, { error: "file_required" }, false),
      false
    );
  });

  it("call-room webrtc exposes finalize retry helpers and retry loop", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/public/call-room-webrtc.js"), "utf8");
    assert.match(src, /FINALIZE_RETRY_STATUSES/);
    assert.match(src, /shouldAttachFinalizeTail/);
    assert.match(src, /finalizeNeedsTailAgain/);
    assert.match(src, /for \(let attempt = 0; attempt < FINALIZE_MAX_ATTEMPTS/);
  });

  it("writeFinalRecording is idempotent when final file already playable", () => {
    const dataDir = path.join(os.tmpdir(), `hc-r106-data-${process.pid}-${Date.now()}`);
    process.env.DB_PATH = path.join(dataDir, "x.sqlite");
    process.env.CALLS_DIR = path.join(dataDir, "calls");
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/app/")) delete require.cache[key];
    }
    const store = require("../app/lib/recording-store");
    const callId = "00000000-0000-4000-8000-000000000101";
    const side = "candidate";
    store.appendChunk(callId, side, fakeEbml(12_000));
    const first = store.writeFinalRecording(callId, side, Buffer.alloc(0), 30_000);
    assert.ok(first);
    const size1 = fs.statSync(first).size;
    const second = store.writeFinalRecording(callId, side, Buffer.alloc(0), 30_000);
    assert.equal(second, first);
    assert.equal(fs.statSync(first).size, size1);
    assert.equal(store.listChunkFiles(callId, side).length, 0);
  });

  it("duplicate finalize with tail does not shorten an existing playable file", () => {
    const dataDir = path.join(os.tmpdir(), `hc-r106-tail-${process.pid}-${Date.now()}`);
    process.env.DB_PATH = path.join(dataDir, "x.sqlite");
    process.env.CALLS_DIR = path.join(dataDir, "calls");
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/app/")) delete require.cache[key];
    }
    const store = require("../app/lib/recording-store");
    const callId = "00000000-0000-4000-8000-000000000102";
    const side = "employer";
    store.appendChunk(callId, side, fakeEbml(12_000));
    const path1 = store.writeFinalRecording(callId, side, fakeCluster(8_000), 45_000);
    assert.ok(path1 && isPlayableRecordingFile(path1));
    const size1 = fs.statSync(path1).size;
    const path2 = store.writeFinalRecording(callId, side, fakeCluster(8_000), 45_000);
    assert.equal(path2, path1);
    assert.ok(fs.statSync(path1).size >= size1);
  });

  it("finalize API: duplicate POST and race with call end keep one playable side", async () => {
    const { app } = freshApp();
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r106', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, started_at, consent_at_candidate, consent_at_employer) VALUES (?, ?, 'live', datetime('now'), datetime('now'), datetime('now'))`
    ).run(callId, invId);
    const cafeAgent = request.agent(app);
    const annaAgent = request.agent(app);
    await cafeAgent.post("/api/auth/login").send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    await annaAgent.post("/api/auth/login").send({ email: "anna@demo.local", password: "demo-demo-demo" });
    await annaAgent
      .post(`/api/calls/${callId}/recording-chunk`)
      .attach("file", fakeEbml(12_000), "c1.webm");
    const fin1 = await annaAgent
      .post(`/api/calls/${callId}/recording`)
      .field("durationMs", "30000");
    assert.equal(fin1.status, 200);
    const fin2 = await annaAgent
      .post(`/api/calls/${callId}/recording`)
      .field("durationMs", "30000");
    assert.equal(fin2.status, 200);
    const endPromise = cafeAgent.post(`/api/calls/${callId}/end`);
    const fin3Promise = annaAgent
      .post(`/api/calls/${callId}/recording`)
      .field("durationMs", "30000");
    const [endRes, fin3] = await Promise.all([endPromise, fin3Promise]);
    assert.equal(endRes.status, 200);
    assert.ok([200, 409].includes(fin3.status));
    await new Promise((r) => setTimeout(r, 50));
    const call = db.prepare("SELECT recording_path FROM calls WHERE id = ?").get(callId);
    const sides = require("../app/lib/call-recording").listPlayableRecordingSides(call.recording_path);
    assert.ok(sides.includes("candidate"));
  });

  it("kept-alive socket gets a response while the event loop is blocked (production timeouts)", async () => {
    process.env.HANDCHECK_TEST_HOOKS = "1";
    process.env.DB_PATH = path.join(os.tmpdir(), `hc-r106-ka-${process.pid}.sqlite`);
    process.env.DEMO_MODE = "1";
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/app/")) delete require.cache[key];
    }
    const server = start({ port: 0 });
    await new Promise((resolve) => server.once("listening", resolve));
    const port = server.address().port;
    const socket = net.connect({ host: "127.0.0.1", port });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const req1 =
      "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n";
    const res1 = await httpExchange(socket, req1);
    assert.equal(res1.status, 200);
    const req2 =
      "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n";
    const res2Promise = httpExchange(socket, req2);
    const deadline = Date.now() + 2_500;
    while (Date.now() < deadline) {
      /* simulate recording ffmpeg merge blocking the event loop */
    }
    const res2 = await res2Promise;
    assert.equal(res2.status, 200);
    socket.end();
    await new Promise((resolve) => server.close(resolve));
    delete process.env.HANDCHECK_TEST_HOOKS;
  });
});
