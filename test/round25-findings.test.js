"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const request = require("supertest");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { generateTokenMaterial } = require("../app/lib/api-token");
const { newId } = require("../app/lib/ids");
const { validateOptionalPhone } = require("../app/lib/validation");
const answers = require("../scripts/fixtures/canonical-answer-ab.json");

function bootServer() {
  const tmpDb = path.join(os.tmpdir(), `hc-r25-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  const app = createApp();
  const server = http.createServer(app);
  return { app, server, tmpDb };
}

function insertToken(db, userId, scopes) {
  const { raw, hash, displayPrefix } = generateTokenMaterial();
  const id = newId();
  db.prepare(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes_json, client_where)
     VALUES (?, ?, 'r25', ?, ?, ?, 'test')`
  ).run(id, userId, hash, displayPrefix, JSON.stringify(scopes));
  return raw;
}

async function connectMcp(baseUrl, token) {
  const client = new Client({ name: "hc-r25", version: "0.5.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, transport };
}

function parseToolJson(result) {
  const text = result.content?.[0]?.text || "{}";
  return JSON.parse(text);
}

async function registerEmployer(app, email) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ email, password: "demo-demo-demo", role: "employer" });
  await agent.post("/api/auth/confirm").send({ email, code: "000000" });
  await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
  await agent.put("/api/employer/profile").send({ companyName: "R25 Co", contactEmail: email });
  return agent;
}

async function registerCandidate(app, email) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ email, password: "demo-demo-demo", role: "candidate" });
  await agent.post("/api/auth/confirm").send({ email, code: "000000" });
  await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
  return agent;
}

async function passTest(agent) {
  await agent.put("/api/candidate/profile").send({
    stack: ["node"],
    phone: "+79001234567",
    contactEmail: "c@test.local",
  });
  await agent.post("/api/assessment/battery/start").send({
    specialization: "backend",
    grade: "middle",
      privacyConsent: true,
  });
  const cur = await agent.get("/api/assessment/battery/current");
  for (const a of cur.body.battery.attempts) {
    const task = await agent.get(`/api/assessment/tasks/${a.id}`);
    const text = task.body.type === "work" ? answers.workAnswer : answers.quickAnswer;
    await agent.post(`/api/assessment/tasks/${a.id}/open`);
    await agent.post(`/api/assessment/tasks/${a.id}/submit`).send({ answerText: text });
  }
}

describe("round 25 findings", () => {
  let server;
  let tmpDb;
  let app;
  let baseUrl;

  before(async () => {
    const boot = bootServer();
    server = boot.server;
    tmpDb = boot.tmpDb;
    app = boot.app;
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("P1-1: employer MCP list_calls returns rows with accepted invitation", async () => {
    const db = require("../app/db").getDb();
    const employer = await registerEmployer(app, `r25e-${Date.now()}@demo.local`);
    const me = await employer.get("/api/me");
    const need = await employer.post("/api/employer/needs").send({
      title: "Calls need",
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const cand = await registerCandidate(app, `r25c-${Date.now()}@demo.local`);
    await passTest(cand);
    const candMe = await cand.get("/api/me");
    const inv = await employer.post("/api/employer/invitations").send({
      needId: need.body.id,
      candidateId: candMe.body.id,
      salaryFrom: 150000,
      salaryTo: 200000,
      offerText: "Join",
      contactChannel: "email",
    });
    await cand.post(`/api/candidate/invitations/${inv.body.id}/accept`);
    const token = insertToken(db, me.body.id, ["read"]);
    const { client, transport } = await connectMcp(baseUrl, token);
    const listed = parseToolJson(await client.callTool({ name: "list_calls", arguments: {} }));
    assert.ok(Array.isArray(listed));
    assert.ok(listed.some((r) => r.invitationId === inv.body.id));
    await transport.close();
  });

  it("P1-2: MCP create_need honours active:false", async () => {
    const db = require("../app/db").getDb();
    const employer = await registerEmployer(app, `r25n-${Date.now()}@demo.local`);
    const me = await employer.get("/api/me");
    const token = insertToken(db, me.body.id, ["read", "write"]);
    const { client, transport } = await connectMcp(baseUrl, token);
    const created = parseToolJson(
      await client.callTool({
        name: "create_need",
        arguments: {
          title: "Inactive MCP need",
          specialization: "backend",
          grade: "middle",
          active: false,
        },
      })
    );
    const row = db.prepare("SELECT active FROM employer_needs WHERE id = ?").get(created.id);
    assert.equal(row.active, 0);
    const needs = parseToolJson(await client.callTool({ name: "list_needs", arguments: {} }));
    const item = needs.find((n) => n.id === created.id);
    assert.equal(item.active, false);
    await transport.close();
  });

  it("P1-3: post-test AI usage hidden from unrelated employer", async () => {
    const { summarizeAiUsageForEmployer } = require("../app/lib/ai-usage-summary");
    const db = require("../app/db").getDb();
    const cand = await registerCandidate(app, `r25ai-${Date.now()}@demo.local`);
    await passTest(cand);
    const candId = (await cand.get("/api/me")).body.id;
    const inviter = await registerEmployer(app, `r25inv-${Date.now()}@demo.local`);
    const need = await inviter.post("/api/employer/needs").send({
      title: "AI need",
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const inv = await inviter.post("/api/employer/invitations").send({
      needId: need.body.id,
      candidateId: candId,
      salaryFrom: 150000,
      salaryTo: 200000,
      offerText: "x",
      contactChannel: "email",
    });
    const sessionId = newId();
    const tokenId = newId();
    db.prepare(
      `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes_json, client_where)
       VALUES (?, ?, 'post', 'h', 'hc_x', '["read","write"]', 'Cursor test')`
    ).run(tokenId, candId);
    db.prepare(
      `INSERT INTO mcp_client_sessions (id, user_id, api_token_id, client_name, client_version, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, 'r11-check', '1.0', datetime('now', '+1 day'), datetime('now', '+1 day'))`
    ).run(sessionId, candId, tokenId);
    db.prepare(
      `INSERT INTO mcp_tool_calls (id, session_id, user_id, api_token_id, tool_name, args_masked_json, ok, created_at)
       VALUES (?, ?, ?, ?, 'respond_invitation', ?, 1, datetime('now', '+1 day'))`
    ).run(newId(), sessionId, candId, tokenId, JSON.stringify({ invitationId: inv.body.id }));

    const other = await registerEmployer(app, `r25oth-${Date.now()}@demo.local`);
    await other.post("/api/employer/needs").send({
      title: "Pool",
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const otherId = (await other.get("/api/me")).body.id;
    const summaryOther = summarizeAiUsageForEmployer(otherId, candId);
    if (summaryOther?.headline) {
      assert.ok(!summaryOther.headline.includes("После теста"));
      assert.ok(!summaryOther.headline.includes("Cursor test"));
    }

    const inviterId = (await inviter.get("/api/me")).body.id;
    const summaryInv = summarizeAiUsageForEmployer(inviterId, candId);
    assert.ok(summaryInv.headline.includes("После теста"));
  });

  it("P2-9: get_call_analysis unknown call id", () => {
    const { getCallAnalysis } = require("../app/modules/mcp/services");
    const db = require("../app/db").getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    assert.throws(
      () => getCallAnalysis(cafeId, newId()),
      (e) => e.isMcp && e.message === "Звонок не найден"
    );
  });

  it("P2-9: battery_incomplete REST message", async () => {
    const agent = await registerCandidate(app, `r25bat-${Date.now()}@demo.local`);
    const res = await agent.post("/api/assessment/battery/start").send({
      specialization: "frontend",
      grade: "middle",
      privacyConsent: true,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "battery_incomplete");
    assert.match(res.body.details.message, /Батарея заданий/);
  });

  it("P2-10: duplicate need title 409", async () => {
    const employer = await registerEmployer(app, `r25dup-${Date.now()}@demo.local`);
    await employer.post("/api/employer/needs").send({
      title: "Same Title",
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const dup = await employer.post("/api/employer/needs").send({
      title: "Same Title",
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, "need_duplicate_title");
  });

  it("P2-10: foreign need invalid salary returns 404", async () => {
    const e1 = await registerEmployer(app, `r25a-${Date.now()}@demo.local`);
    const e2 = await registerEmployer(app, `r25b-${Date.now()}@demo.local`);
    const need = await e1.post("/api/employer/needs").send({
      title: "Foreign",
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const cand = await registerCandidate(app, `r25fc-${Date.now()}@demo.local`);
    await passTest(cand);
    const candId = (await cand.get("/api/me")).body.id;
    const res = await e2.post("/api/employer/invitations").send({
      needId: need.body.id,
      candidateId: candId,
      salaryFrom: 1,
      salaryTo: 2,
      offerText: "x",
      contactChannel: "email",
    });
    assert.equal(res.status, 404);
  });

  it("P2-10: phone all zeros rejected", () => {
    const { fields } = validateOptionalPhone("0000000000");
    assert.ok(fields.phone);
  });

  it("statTilesHtml supports clamp class", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/public/app.js"), "utf8");
    assert.match(src, /stat-tile-value-clamp/);
  });
});
