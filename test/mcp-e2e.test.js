"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const request = require("supertest");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { generateTokenMaterial } = require("../app/lib/api-token");
const { newId } = require("../app/lib/ids");

const answers = require("../scripts/fixtures/canonical-answer-ab.json");

function bootServer() {
  const tmpDb = path.join(os.tmpdir(), `hc-mcp-${process.pid}-${Date.now()}.sqlite`);
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
     VALUES (?, ?, 'e2e', ?, ?, ?)`
  ).run(id, userId, hash, displayPrefix, JSON.stringify(scopes));
  return raw;
}

async function connectMcp(baseUrl, token) {
  const client = new Client({ name: "hc-test", version: "0.5.0" });
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

describe("MCP e2e", () => {
  let server;
  let tmpDb;
  let baseUrl;

  before(async () => {
    const boot = bootServer();
    server = boot.server;
    tmpDb = boot.tmpDb;
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("candidate flow: whoami → assessment → invitation accept", async () => {
    const db = require("../app/db").getDb();
    const borisId = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;
    db.prepare("DELETE FROM candidate_categories WHERE candidate_user_id = ?").run(borisId);
    db.prepare("DELETE FROM batteries WHERE candidate_user_id = ?").run(borisId);
    const token = insertToken(db, borisId, ["read", "write"]);
    const { client, transport } = await connectMcp(baseUrl, token);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "whoami"));
    const who = parseToolJson(await client.callTool({ name: "whoami", arguments: {} }));
    assert.equal(who.role, "candidate");

    await client.callTool({
      name: "start_assessment",
      arguments: { specialization: "backend", grade: "middle" },
    });
    const listed = parseToolJson(await client.callTool({ name: "list_tasks", arguments: {} }));
    assert.ok(listed.tasks.length >= 5);
    for (const t of listed.tasks) {
      const text = t.type === "work" ? answers.workAnswer : answers.quickAnswer;
      const tool = t.type === "work" ? "submit_work_task" : "submit_answer";
      await client.callTool({
        name: tool,
        arguments: { attemptId: t.attemptId, answerText: text },
      });
    }
    const cat = parseToolJson(await client.callTool({ name: "get_my_category", arguments: {} }));
    assert.ok(cat.label);

    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const need = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?")
      .get(cafe);
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status, action_source)
       VALUES (?, ?, ?, ?, 120000, 180000, 'MCP test', 'email', 'sent', 'web')`
    ).run(invId, cafe, need.id, borisId);
    const invs = parseToolJson(await client.callTool({ name: "list_invitations", arguments: {} }));
    assert.ok(invs.some((i) => i.id === invId));
    await client.callTool({
      name: "respond_invitation",
      arguments: { invitationId: invId, decision: "accept" },
    });
    await transport.close();
  });

  it("employer flow: need → deck invite → call analysis", async () => {
    const db = require("../app/db").getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const token = insertToken(db, cafeId, ["read", "write"]);
    const { client, transport } = await connectMcp(baseUrl, token);

    const created = parseToolJson(
      await client.callTool({
        name: "create_need",
        arguments: {
          title: "MCP QA need",
          specialization: "backend",
          grade: "middle",
          domainText: "HoReCa",
        },
      })
    );
    const needId = created.id;
    const deck = parseToolJson(
      await client.callTool({ name: "get_next_candidate", arguments: { needId } })
    );
    assert.ok(deck.candidateId);
    const invited = parseToolJson(
      await client.callTool({
        name: "decide_candidate",
        arguments: {
          needId,
          candidateId: deck.candidateId,
          decision: "invite",
          salaryFrom: 100000,
          salaryTo: 150000,
          offerText: "Присоединяйтесь",
          contactChannel: "telegram",
        },
      })
    );
    assert.ok(invited.invitationId);
    const invRow = db.prepare("SELECT action_source FROM invitations WHERE id = ?").get(invited.invitationId);
    assert.equal(invRow.action_source, "mcp");

    db.prepare("UPDATE invitations SET status = 'accepted' WHERE id = ?").run(invited.invitationId);
    const callId = newId();
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, ended_at) VALUES (?, ?, 'ended', datetime('now'))`
    ).run(callId, invited.invitationId);
    db.prepare(
      `INSERT INTO call_analyses (call_id, summary_text) VALUES (?, 'Кандидат уверенно описал REST и домен HoReCa.')`
    ).run(callId);
    const analysis = parseToolJson(
      await client.callTool({ name: "get_call_analysis", arguments: { callId } })
    );
    assert.match(analysis.summaryText, /REST/);
    await transport.close();
  });

  it("logs MCP tool calls with masked args and blocks work on submit_answer", async () => {
    const db = require("../app/db").getDb();
    const userId = db.prepare("SELECT id FROM users WHERE email = 'demo4@demo.local'").get().id;
    db.prepare("DELETE FROM batteries WHERE candidate_user_id = ?").run(userId);
    const token = insertToken(db, userId, ["read", "write"]);
    const { client, transport } = await connectMcp(baseUrl, token);
    await client.callTool({
      name: "start_assessment",
      arguments: { specialization: "backend", grade: "middle" },
    });
    const listed = parseToolJson(await client.callTool({ name: "list_tasks", arguments: {} }));
    const work = listed.tasks.find((t) => t.type === "work");
    const quick = listed.tasks.find((t) => t.type === "quick");
    const bad = await client.callTool({
      name: "submit_answer",
      arguments: { attemptId: work.attemptId, answerText: "x", intent: "тест" },
    });
    assert.ok(bad.isError);
    await client.callTool({
      name: "submit_answer",
      arguments: {
        attemptId: quick.attemptId,
        answerText: answers.quickAnswer,
        intent: "помоги с REST",
      },
    });
    const row = db
      .prepare(
        `SELECT args_masked_json, intent_text FROM mcp_tool_calls
         WHERE user_id = ? AND tool_name = 'submit_answer' AND ok = 1 ORDER BY created_at DESC LIMIT 1`
      )
      .get(userId);
    assert.ok(row);
    assert.match(row.args_masked_json, /attemptId/);
    assert.equal(row.intent_text, "помоги с REST");
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const {
      summarizeAiUsageForEmployer,
      employerMayViewCandidateAiUsage,
    } = require("../app/lib/ai-usage-summary");
    const demo5Id = db.prepare("SELECT id FROM users WHERE email = 'demo5@demo.local'").get().id;
    assert.ok(
      db.prepare("SELECT COUNT(*) AS c FROM mcp_tool_calls WHERE user_id = ?").get(userId).c > 0
    );
    assert.ok(employerMayViewCandidateAiUsage(cafeId, demo5Id));
    const poolSummary = summarizeAiUsageForEmployer(cafeId, demo5Id);
    assert.ok(poolSummary);
    assert.match(poolSummary.headline, /Пока нет записей/i);
    const needId = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafeId).id;
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 100000, 120000, 'MCP log test', 'email', 'sent')`
    ).run(newId(), cafeId, needId, userId);
    const summary = summarizeAiUsageForEmployer(cafeId, userId);
    assert.ok(summary);
    assert.ok(!summary.clients.some((c) => c.startsWith("http")));
    const sessions = db
      .prepare("SELECT client_name FROM mcp_client_sessions WHERE user_id = ?")
      .all(userId);
    assert.ok(!sessions.some((s) => s.client_name === "http"));
    const linked = db
      .prepare(
        `SELECT session_id FROM mcp_tool_calls WHERE user_id = ? AND tool_name = 'submit_answer' AND ok = 1
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(userId);
    assert.ok(linked?.session_id);
    await transport.close();
  });

  it("GET /mcp returns 405 JSON", async () => {
    const res = await request(`http://127.0.0.1:${server.address().port}`).get("/mcp");
    assert.equal(res.status, 405);
  });
});
