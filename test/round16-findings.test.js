"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { generateTokenMaterial } = require("../app/lib/api-token");
const { newId } = require("../app/lib/ids");
const { domainKeywordHits } = require("../app/lib/call-domain-match");
const { SCOPE_ERR_WRITE } = require("../app/modules/mcp/tool-meta");

function bootServer() {
  const tmpDb = path.join(os.tmpdir(), `hc-r16-${process.pid}-${Date.now()}.sqlite`);
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
     VALUES (?, ?, 'r16', ?, ?, ?)`
  ).run(id, userId, hash, displayPrefix, JSON.stringify(scopes));
  return raw;
}

async function connectMcp(baseUrl, token) {
  const client = new Client({ name: "hc-r16", version: "0.5.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, transport };
}

describe("round 16 findings", () => {
  let server;
  let tmpDb;
  let baseUrl;

  before(async () => {
    const boot = bootServer();
    server = boot.server;
    tmpDb = boot.tmpDb;
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("domain keyword match handles Russian inflection (финтех / финтехе)", () => {
    const hits = domainKeywordHits("финтех", "обсуждали платежи в финтехе и платёжные ручки");
    assert.ok(hits.length >= 1);
  });

  it("analyzeCall marks domain match for inflected transcript", () => {
    const db = require("../app/db").getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const needId = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe).id;
    db.prepare("UPDATE employer_needs SET domain_text = ? WHERE id = ?").run("финтех", needId);
    const invId = newId();
    const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;
    const invInsert = db
      .prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 't', 'email', 'accepted')`
      )
      .run(invId, cafe, needId, boris);
    assert.equal(invInsert.changes, 1);
    const callId = newId();
    db.prepare("DELETE FROM calls WHERE invitation_id = ?").run(invId);
    const callInsert = db
      .prepare(
        `INSERT INTO calls (id, invitation_id, status, transcript_text, started_at, ended_at, consent_at_candidate, consent_at_employer)
       VALUES (?, ?, 'ended', ?, datetime('now', '-10 minutes'), datetime('now'), datetime('now'), datetime('now'))`
      )
      .run(callId, invId, "Мы говорили о платежами в финтехе и API");
    assert.equal(callInsert.changes, 1);
    const { analyzeCall } = require("../app/modules/calls/analyze-call");
    analyzeCall(callId);
    const row = db
      .prepare("SELECT summary_text, consistency_note FROM call_analyses WHERE call_id = ?")
      .get(callId);
    assert.ok(row, "expected call_analyses row");
    assert.equal(row.consistency_note, "domain_match");
    assert.match(row.summary_text, /доменом потребности/);
    assert.ok(!/Формулировки совпали/.test(row.summary_text));
  });

  it("stores intent for read tools and exposes MCP annotations", async () => {
    const db = require("../app/db").getDb();
    const borisId = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;
    const token = insertToken(db, borisId, ["read"]);
    const { client, transport } = await connectMcp(baseUrl, token);
    const tools = await client.listTools();
    const who = tools.tools.find((t) => t.name === "whoami");
    assert.ok(who?.annotations?.readOnlyHint);
    const profile = tools.tools.find((t) => t.name === "get_my_profile");
    assert.ok(profile?.annotations?.readOnlyHint);
    const submit = tools.tools.find((t) => t.name === "submit_answer");
    assert.ok(submit?.annotations?.destructiveHint);
    await client.callTool({
      name: "whoami",
      arguments: { intent: "Покажи мой профиль" },
    });
    const row = db
      .prepare(
        `SELECT intent_text FROM mcp_tool_calls WHERE user_id = ? AND tool_name = 'whoami' ORDER BY created_at DESC LIMIT 1`
      )
      .get(borisId);
    assert.equal(row.intent_text, "Покажи мой профиль");
    const resources = await client.listResources();
    assert.ok(!resources.resources.some((r) => String(r.uri).includes("handcheck://needs/")));
    await transport.close();
  });

  it("candidate MCP does not list employer-only need resource template", async () => {
    const db = require("../app/db").getDb();
    const borisId = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;
    const candToken = insertToken(db, borisId, ["read"]);
    const cand = await connectMcp(baseUrl, candToken);
    const candRes = await cand.client.listResources();
    assert.ok(!candRes.resources.some((r) => String(r.uri).includes("handcheck://needs/")));
    const reg = fs.readFileSync(path.join(__dirname, "../app/modules/mcp/register-server.js"), "utf8");
    assert.match(reg, /if \(role === "employer"\)[\s\S]*handcheck-need-template/);
    await cand.transport.close();
  });

  it("scope write error is Russian without English scope word", async () => {
    const db = require("../app/db").getDb();
    const borisId = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;
    const token = insertToken(db, borisId, ["read"]);
    const { client, transport } = await connectMcp(baseUrl, token);
    const res = await client.callTool({
      name: "start_assessment",
      arguments: { specialization: "backend", grade: "middle", intent: "тест" },
    });
    const text = res.content?.[0]?.text || "";
    assert.ok(res.isError);
    assert.match(text, /Запись/);
    assert.ok(!/scope/i.test(text));
    assert.equal(SCOPE_ERR_WRITE.includes("scope"), false);
    await transport.close();
  });

  it("call room lede helper targets call-room hero", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/public/call.js"), "utf8");
    assert.match(src, /call-room-hero \.lede/);
    assert.match(src, /Комната закрыта/);
  });

  it("integrations layout uses step badges and flex consent labels", () => {
    const js = fs.readFileSync(path.join(__dirname, "../app/public/integrations.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../app/public/styles.css"), "utf8");
    assert.match(js, /integrations-steps/);
    assert.match(js, /описания запроса/);
    assert.match(css, /label\.consent-option/);
  });

  it("contacts API returns contactEmail camelCase", async () => {
    const request = require("supertest");
    const db = require("../app/db").getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const borisId = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;
    const needId = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafeId).id;
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 't', 'email', 'accepted')`
    ).run(invId, cafeId, needId, borisId);
    const agent = request.agent(server);
    await agent.post("/api/auth/login").send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    const res = await agent.get(`/api/employer/candidates/${borisId}/contacts`);
    assert.equal(res.status, 200);
    assert.ok(res.body.contactEmail);
    assert.equal(res.body.contact_email, undefined);
  });
});
