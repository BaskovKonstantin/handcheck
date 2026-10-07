"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const request = require("supertest");
const WebSocket = require("ws");
const { registerPayload } = require("./register-payload");
const { INVALID_JSON_BODY_MSG, MCP_INVALID_JSON_MSG, MCP_PAYLOAD_TOO_LARGE_MSG } = require("../app/middleware/errors");
const { newId } = require("../app/lib/ids");

function bootServer() {
  const tmpDb = path.join(os.tmpdir(), `hc-r63-${process.pid}-${Date.now()}.sqlite`);
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

function assertMcpParseError(res) {
  assert.equal(res.status, 400);
  assert.equal(res.body.jsonrpc, "2.0");
  assert.equal(res.body.error?.code, -32700);
  assert.equal(res.body.error?.message, MCP_INVALID_JSON_MSG);
  assert.equal(res.body.id, null);
}

function assertMcpTooLarge(res) {
  assert.equal(res.status, 413);
  assert.equal(res.body.jsonrpc, "2.0");
  assert.equal(res.body.error?.code, -32000);
  assert.equal(res.body.error?.message, MCP_PAYLOAD_TOO_LARGE_MSG);
  assert.equal(res.body.id, null);
}

function assertRestInvalidJson(res) {
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_body");
  assert.equal(res.body.details?.message, INVALID_JSON_BODY_MSG);
}

function upgradeHttpStatus(url, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => reject(new Error("timeout waiting for upgrade response")), 4000);
    ws.on("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      resolve(res.statusCode);
    });
    ws.on("open", () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error("expected refusal but WebSocket opened"));
    });
  });
}

describe("round63 P3-1 MCP JSON parse and size errors are JSON-RPC", () => {
  let app;
  let token;

  before(async () => {
    app = bootServer().app;
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "anna@demo.local",
      password: "demo-demo-demo",
    });
    const created = await agent.post("/api/integrations/tokens").send({
      name: "r63 mcp",
      scopes: ["read", "write"],
      clientWhere: "test",
      loggingConsent: true,
    });
    token = created.body.token;
  });

  it("malformed JSON without Bearer returns JSON-RPC -32700", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .send("{bad");
    assertMcpParseError(res);
  });

  it("malformed JSON with Bearer returns JSON-RPC -32700", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send("{bad");
    assertMcpParseError(res);
  });

  it("oversized body on /mcp returns 413 JSON-RPC", async () => {
    const big = "x".repeat(300 * 1024);
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send(`{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1,"pad":"${big}"}`);
    assertMcpTooLarge(res);
  });

  it("malformed JSON on /api/auth/login keeps REST invalid_body", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{bad");
    assertRestInvalidJson(res);
  });

  it("valid tools/list still works", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", method: "tools/list", params: {}, id: 1 });
    assert.equal(res.status, 200);
    assert.match(res.text, /tools\/list|"tools"/);
  });

  it("missing token on valid JSON body stays 401", async () => {
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", method: "tools/list", params: {}, id: 1 });
    assert.equal(res.status, 401);
  });
});

describe("round63 P3-2 refused signaling upgrades return HTTP status", () => {
  let server;
  let port;
  let tmpDb;
  let baseUrl;

  before(async () => {
    const boot = bootServer();
    server = boot.server;
    tmpDb = boot.tmpDb;
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

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

  async function seedCall({ ended = false } = {}) {
    const db = require("../app/db").getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'r63 ws', 'email', 'accepted')`
    ).run(invId, cafe.id, need.id, anna.id);
    const callId = newId();
    const status = ended ? "ended" : "ready";
    db.prepare(`INSERT INTO calls (id, invitation_id, status) VALUES (?, ?, ?)`).run(callId, invId, status);
    return {
      callId,
      cafeCookie: await loginCookie("cafe@demo.local"),
      annaCookie: await loginCookie("anna@demo.local"),
    };
  }

  const wsUrl = (callId) => `ws://127.0.0.1:${port}/ws/calls/${callId}`;

  it("403 for foreign Origin", async () => {
    const { callId, cafeCookie } = await seedCall();
    const code = await upgradeHttpStatus(wsUrl(callId), {
      Cookie: cafeCookie,
      Origin: "https://evil.example",
    });
    assert.equal(code, 403);
  });

  it("403 for Sec-Fetch-Site cross-site", async () => {
    const { callId, cafeCookie } = await seedCall();
    const code = await upgradeHttpStatus(wsUrl(callId), {
      Cookie: cafeCookie,
      Origin: `http://127.0.0.1:${port}`,
      "Sec-Fetch-Site": "cross-site",
    });
    assert.equal(code, 403);
  });

  it("401 without session cookie", async () => {
    const { callId } = await seedCall();
    const code = await upgradeHttpStatus(wsUrl(callId), {
      Origin: `http://127.0.0.1:${port}`,
    });
    assert.equal(code, 401);
  });

  it("403 for non-participant session", async () => {
    const { callId } = await seedCall();
    const borisCookie = await loginCookie("boris@demo.local");
    const code = await upgradeHttpStatus(wsUrl(callId), {
      Cookie: borisCookie,
      Origin: `http://127.0.0.1:${port}`,
    });
    assert.equal(code, 403);
  });

  it("404 for unknown call id", async () => {
    const cafeCookie = await loginCookie("cafe@demo.local");
    const code = await upgradeHttpStatus(wsUrl(newId()), {
      Cookie: cafeCookie,
      Origin: `http://127.0.0.1:${port}`,
    });
    assert.equal(code, 404);
  });

  it("410 for ended call", async () => {
    const { callId, cafeCookie } = await seedCall({ ended: true });
    const code = await upgradeHttpStatus(wsUrl(callId), {
      Cookie: cafeCookie,
      Origin: `http://127.0.0.1:${port}`,
    });
    assert.equal(code, 410);
  });

  it("same-origin participant still connects and relays", async () => {
    const { callId, cafeCookie, annaCookie } = await seedCall();
    const origin = `http://127.0.0.1:${port}`;
    const ws1 = new WebSocket(wsUrl(callId), { headers: { Cookie: cafeCookie, Origin: origin } });
    const ws2 = new WebSocket(wsUrl(callId), { headers: { Cookie: annaCookie, Origin: origin } });
    await Promise.all([
      new Promise((r, j) => ws1.once("open", r).once("error", j)),
      new Promise((r, j) => ws2.once("open", r).once("error", j)),
    ]);
    const payload = JSON.stringify({ t: "r63-probe" });
    const received = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 3000);
      ws2.once("message", (data) => {
        clearTimeout(timer);
        resolve(String(data));
      });
      ws1.send(payload);
    });
    assert.equal(received, payload);
    ws1.close();
    ws2.close();
  });
});
