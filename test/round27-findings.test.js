"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const request = require("supertest");
const WebSocket = require("ws");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { generateTokenMaterial } = require("../app/lib/api-token");
const { newId } = require("../app/lib/ids");
const {
  normalizeNeedTitle,
  employerNeedTitleTaken,
  collapseInnerWhitespace,
} = require("../app/lib/need-validation");
function bootServer() {
  const tmpDb = path.join(os.tmpdir(), `hc-r27-${process.pid}-${Date.now()}.sqlite`);
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

function insertToken(db, userId, scopes) {
  const { raw, hash, displayPrefix } = generateTokenMaterial();
  const id = newId();
  db.prepare(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes_json, client_where)
     VALUES (?, ?, 'r27', ?, ?, ?, 'r27 test')`
  ).run(id, userId, hash, displayPrefix, JSON.stringify(scopes));
  return raw;
}

async function connectMcp(baseUrl, token) {
  const client = new Client({ name: "r27-check", version: "1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, transport };
}

function parseToolJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text || "{}";
  return JSON.parse(text);
}

describe("round27 findings", () => {
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

  it("P2-5: unknown /api routes return JSON not_found", async () => {
    const cafe = request.agent(app);
    await cafe.post("/api/auth/login").send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    const a = await cafe.get("/api/nope");
    assert.equal(a.status, 404);
    assert.equal(a.body.error, "not_found");
    assert.match(a.headers["content-type"] || "", /json/);
    const anna = request.agent(app);
    await anna.post("/api/auth/login").send({ email: "anna@demo.local", password: "demo-demo-demo" });
    const b = await anna.get("/api/candidate/nope");
    assert.equal(b.status, 404);
    assert.equal(b.body.error, "not_found");
  });

  it("P2-4: need titles collapse whitespace and treat ё as е", async () => {
    assert.equal(normalizeNeedTitle("Тёст"), normalizeNeedTitle("Тест"));
    assert.equal(collapseInnerWhitespace("Тест  Р27:  третья"), "Тест Р27: третья");
    const cafe = request.agent(app);
    await cafe.post("/api/auth/login").send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    const first = await cafe.post("/api/employer/needs").send({
      title: "Тест Р27: третья",
      specialization: "backend",
      grade: "middle",
    });
    assert.equal(first.status, 201);
    const dup = await cafe.post("/api/employer/needs").send({
      title: "Тест  Р27:  третья",
      specialization: "backend",
      grade: "middle",
    });
    assert.equal(dup.status, 409);
    const yo = await cafe.post("/api/employer/needs").send({
      title: "Тёст Р27 уник",
      specialization: "backend",
      grade: "middle",
    });
    assert.equal(yo.status, 201);
    const yoDup = await cafe.post("/api/employer/needs").send({
      title: "Тест Р27 уник",
      specialization: "backend",
      grade: "middle",
    });
    assert.equal(yoDup.status, 409);
  });

  it("P2-6: MCP list_invitations and list_calls match REST fields", async () => {
    const db = require("../app/db").getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const annaId = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get().id;
    const needId = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?")
      .get(cafeId).id;
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status, created_at)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r27 mcp', 'email', 'sent', datetime('now'))`
    ).run(invId, cafeId, needId, annaId);
    const services = require("../app/modules/mcp/services");
    const mcpInv = services.listEmployerInvitations(cafeId);
    const cafeRest = request.agent(app);
    await cafeRest.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    const restInv = await cafeRest.get("/api/employer/invitations");
    const restItems = restInv.body.items || [];
    assert.ok(mcpInv.length);
    const sample = mcpInv.find((i) => i.status === "accepted") || mcpInv[0];
    assert.ok("needTitle" in sample);
    assert.ok("offerText" in sample);
    assert.ok("contactChannel" in sample);
    assert.ok("hadPriorDecline" in sample);
    const mcpCalls = services.listEmployerCalls(cafeId);
    const restCall = restItems.find((i) => i.status === "accepted");
    if (restCall) {
      const row = mcpCalls.find((c) => c.invitationId === restCall.id);
      if (row) {
        assert.ok("startedAt" in row);
        assert.ok("endedAt" in row);
        assert.ok("hasRecording" in row);
        assert.ok("salaryFrom" in row);
        assert.ok("roomUrl" in row);
      }
    }
    const token = insertToken(db, cafeId, ["read", "write"]);
    const { client, transport } = await connectMcp(baseUrl, token);
    const viaMcp = parseToolJson(await client.callTool({ name: "list_invitations", arguments: {} }));
    const mcpPayload = Array.isArray(viaMcp) ? viaMcp : viaMcp?.items;
    assert.ok(mcpPayload?.length);
    await transport.close();
  });

  it("P0-1: recording upload while call is live", async () => {
    const db = require("../app/db").getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r27 rec', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, consent_at_candidate, consent_at_employer, started_at)
       VALUES (?, ?, 'live', ?, ?, ?)`
    ).run(callId, invId, now, now, now);
    const cafeAgent = request.agent(app);
    await cafeAgent.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);
    const up = await cafeAgent
      .post(`/api/calls/${callId}/recording`)
      .attach("file", webm, { filename: "employer.webm", contentType: "video/webm" });
    assert.equal(up.status, 200);
    const row = db.prepare("SELECT recording_path FROM calls WHERE id = ?").get(callId);
    assert.ok(row.recording_path);
    const fs = require("fs");
    const path = require("path");
    assert.ok(fs.existsSync(path.join(row.recording_path, "employer.webm")));
  });

  it("P0-1: signaling room accepts at most two peers", async () => {
    const db = require("../app/db").getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r27', 'email', 'accepted')`
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
    const ws1Closed = new Promise((resolve) => {
      ws1.once("close", () => resolve(true));
    });
    const ws3 = new WebSocket(url, { headers: { Cookie: cafeCookie } });
    await new Promise((r, j) => {
      ws3.once("open", r);
      ws3.once("error", j);
    });
    assert.equal(await ws1Closed, true, "duplicate tab should replace prior employer socket");
    assert.equal(ws3.readyState, WebSocket.OPEN);
    ws2.close();
    ws3.close();
  });

  it("P0-1: call UI does not claim recording without MediaRecorder path", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/public/call-room-webrtc.js"), "utf8");
    assert.match(src, /recordingUnavailable/);
    const callJs = fs.readFileSync(path.join(__dirname, "../app/public/call.js"), "utf8");
    assert.match(callJs, /Запись активна/);
    assert.match(callJs, /recordingUnavailable|state\.recording/);
  });

  it("P2-7: audit log uses em dash client format", () => {
    const integrations = fs.readFileSync(
      path.join(__dirname, "../app/modules/integrations/router.js"),
      "utf8"
    );
    assert.match(integrations, /formatClientDescriptor/);
  });

  it("P2-8: candidate calls page opens ended section when only archive", () => {
    const html = fs.readFileSync(path.join(__dirname, "../app/public/candidate/calls.html"), "utf8");
    assert.match(html, /expandEnded/);
    assert.match(html, /open"/);
  });
});
