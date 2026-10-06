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
const { formatCooldownUserMessage } = require("../app/lib/cooldown-message");
const {
  joinableCallsCount,
  isInvitationJoinable,
  callStatusByInvitationId,
} = require("../app/lib/candidate-today");
const { buildCallAnalysisSummary } = require("../app/lib/call-analysis-summary");

function bootServer() {
  const tmpDb = path.join(os.tmpdir(), `hc-r18-${process.pid}-${Date.now()}.sqlite`);
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
    `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes_json)
     VALUES (?, ?, 'r18', ?, ?, ?)`
  ).run(id, userId, hash, displayPrefix, JSON.stringify(scopes));
  return raw;
}

async function connectMcp(baseUrl, token) {
  const client = new Client({ name: "hc-r18", version: "0.5.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, transport };
}

describe("round 18 findings", () => {
  let server;
  let tmpDb;
  let baseUrl;
  let app;

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

  it("1: joinable call count ignores ended calls", () => {
    const items = [
      { invitationId: "a", callStatus: "ended" },
      { invitationId: "b", callStatus: "ready" },
      { invitationId: "c", callStatus: "live" },
    ];
    assert.equal(joinableCallsCount(items), 2);
    const byInv = callStatusByInvitationId(items);
    assert.equal(isInvitationJoinable("a", byInv), false);
    assert.equal(isInvitationJoinable("b", byInv), true);
  });

  it("2: cooldown message includes Moscow retake date", () => {
    const msg = formatCooldownUserMessage("2027-01-04T12:00:00.000Z");
    assert.match(msg, /Повторная попытка с/);
    assert.match(msg, /2027/);
    assert.match(msg, /январ/i);
  });

  it("4: short call analysis uses three phrases without domain boilerplate", () => {
    const call = {
      started_at: "2026-10-06 14:20:00",
      ended_at: "2026-10-06 14:20:05",
    };
    const transcript = "Кандидат: привет. Работодатель: здравствуйте.";
    const { summary_text } = buildCallAnalysisSummary({
      needDomainText: "автоматизация официанта",
      transcript,
      call,
      hasRecordingFile: false,
    });
    assert.ok(!/Формулировки совпали/.test(summary_text));
    assert.match(summary_text, /меньше минуты/i);
    assert.match(summary_text, /Обе стороны оставили реплики/);
    assert.ok(!/Запись сохранена/.test(summary_text));
  });

  it("5: battery start on cooldown returns retakeAt for UI", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "boris@demo.local",
      password: "demo-demo-demo",
    });
    const db = require("../app/db").getDb();
    const userId = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;
    db.prepare(
      `INSERT INTO batteries (id, candidate_user_id, specialization, claimed_grade, form_key, started_at, completed_at)
       VALUES (?, ?, 'backend', 'middle', 'A', datetime('now', '-1 day'), datetime('now'))`
    ).run(newId(), userId);
    const res = await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "cooldown");
    assert.ok(res.body.details?.retakeAt);
    const msg = formatCooldownUserMessage(res.body.details.retakeAt);
    assert.match(msg, /Повторная попытка с/);
  });

  it("6: MCP truncates overlong intent instead of validation error", async () => {
    const db = require("../app/db").getDb();
    const borisId = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;
    const token = insertToken(db, borisId, ["read"]);
    const { client, transport } = await connectMcp(baseUrl, token);
    const longIntent = "x".repeat(500);
    const res = await client.callTool({
      name: "whoami",
      arguments: { intent: longIntent },
    });
    assert.ok(!res.isError);
    const row = db
      .prepare(
        `SELECT intent_text FROM mcp_tool_calls WHERE user_id = ? AND tool_name = 'whoami' ORDER BY created_at DESC LIMIT 1`
      )
      .get(borisId);
    assert.equal(row.intent_text.length, 200);
    await transport.close();
  });

  it("7: background API returns camelCase roleTitle", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "boris@demo.local",
      password: "demo-demo-demo",
    });
    await agent.post("/api/candidate/background").send({
      roleTitle: "Разработчик",
      domain: "платежи",
      industry: "финтех",
      note: "",
    });
    const res = await agent.get("/api/candidate/background");
    assert.equal(res.status, 200);
    assert.ok(res.body.items?.length);
    assert.equal(res.body.items[0].roleTitle, "Разработчик");
    assert.equal(res.body.items[0].role_title, undefined);
  });
});
