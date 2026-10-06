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
const {
  normalizeNeedTitle,
  employerNeedTitleTaken,
} = require("../app/lib/need-validation");
const {
  validateAnswerText,
  QUICK_ANSWER_MAX,
  WORK_ANSWER_MAX,
} = require("../app/lib/assessment-answer");
const { formatClientDescriptor } = require("../app/lib/ai-usage-summary");
function bootServer() {
  const tmpDb = path.join(os.tmpdir(), `hc-r26-${process.pid}-${Date.now()}.sqlite`);
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
     VALUES (?, ?, 'r26', ?, ?, ?, 'test')`
  ).run(id, userId, hash, displayPrefix, JSON.stringify(scopes));
  return raw;
}

async function connectMcp(baseUrl, token) {
  const client = new Client({ name: "hc-r26", version: "0.5.0" });
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

function toolErrorText(result) {
  return result.content?.[0]?.text || "";
}

async function expectToolError(client, call, pattern) {
  const result = await client.callTool(call);
  assert.equal(result.isError, true, `expected tool error, got: ${toolErrorText(result)}`);
  assert.match(toolErrorText(result), pattern);
}

async function registerEmployer(app, email) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ email, password: "demo-demo-demo", role: "employer" });
  await agent.post("/api/auth/confirm").send({ email, code: "000000" });
  await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
  await agent.put("/api/employer/profile").send({ companyName: "R26 Co", contactEmail: email });
  return agent;
}

async function registerCandidate(app, email) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ email, password: "demo-demo-demo", role: "candidate" });
  await agent.post("/api/auth/confirm").send({ email, code: "000000" });
  await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
  return agent;
}

describe("round 26 findings", () => {
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

  it("P1-1: Cyrillic duplicate need title on create (REST)", async () => {
    const employer = await registerEmployer(app, `r26dup-${Date.now()}@demo.local`);
    await employer.post("/api/employer/needs").send({
      title: "Тест Р26: третья",
      specialization: "backend",
      grade: "middle",
    });
    const dup = await employer.post("/api/employer/needs").send({
      title: "тест р26: третья",
      specialization: "backend",
      grade: "middle",
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, "need_duplicate_title");
  });

  it("P1-1: rename to taken title blocked (REST + MCP)", async () => {
    const db = require("../app/db").getDb();
    const employer = await registerEmployer(app, `r26ren-${Date.now()}@demo.local`);
    const me = await employer.get("/api/me");
    const a = await employer.post("/api/employer/needs").send({
      title: "Первая потребность",
      specialization: "backend",
      grade: "middle",
    });
    const b = await employer.post("/api/employer/needs").send({
      title: "Вторая потребность",
      specialization: "backend",
      grade: "middle",
    });
    const put = await employer.put(`/api/employer/needs/${b.body.id}`).send({
      title: "первая потребность",
      specialization: "backend",
      grade: "middle",
    });
    assert.equal(put.status, 409);

    const token = insertToken(db, me.body.id, ["read", "write"]);
    const { client, transport } = await connectMcp(baseUrl, token);
    await expectToolError(
      client,
      {
        name: "update_need",
        arguments: {
          needId: b.body.id,
          title: "Первая потребность",
        },
      },
      /уже есть/i
    );
    await transport.close();

    const other = await registerEmployer(app, `r26oth-${Date.now()}@demo.local`);
    const foreign = await other.post("/api/employer/needs").send({
      title: "Первая потребность",
      specialization: "backend",
      grade: "middle",
    });
    assert.equal(foreign.status, 201);
  });

  it("P1-1: normalizeNeedTitle folds Cyrillic case", () => {
    assert.equal(normalizeNeedTitle("Тест"), normalizeNeedTitle("тест"));
    const db = require("../app/db").getDb();
    const employerId = newId();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, email_confirmed_at) VALUES (?, ?, 'x', 'employer', datetime('now'))`
    ).run(employerId, `x-${Date.now()}@demo.local`);
    const needId = newId();
    db.prepare(
      `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, active)
       VALUES (?, ?, 'Тест Р26', 'backend', 'middle', '[]', 1)`
    ).run(needId, employerId);
    assert.ok(employerNeedTitleTaken(db, employerId, "тест р26"));
    assert.ok(!employerNeedTitleTaken(db, employerId, "тест р26", needId));
  });

  it("P1-2: answer max length REST and MCP", async () => {
    const db = require("../app/db").getDb();
    const cand = await registerCandidate(app, `r26ans-${Date.now()}@demo.local`);
    await cand.put("/api/candidate/profile").send({
      stack: ["node"],
      phone: "+79001234567",
      contactEmail: "c@test.local",
    });
    await cand.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
    });
    const cur = await cand.get("/api/assessment/battery/current");
    const attemptId = cur.body.battery.attempts.find((a) => !a.submitted).id;
    const long = "а".repeat(QUICK_ANSWER_MAX + 1);
    const bad = await cand.post(`/api/assessment/tasks/${attemptId}/submit`).send({ answerText: long });
    assert.equal(bad.status, 400);
    assert.match(bad.body.details.fields.answerText, /длинный/i);

    const candId = (await cand.get("/api/me")).body.id;
    const token = insertToken(db, candId, ["read", "write"]);
    const { client, transport } = await connectMcp(baseUrl, token);
    await expectToolError(
      client,
      {
        name: "submit_answer",
        arguments: { attemptId, answerText: long },
      },
      /длинный/i
    );
    await transport.close();

    const workLong = "б".repeat(WORK_ANSWER_MAX + 1);
    const workCheck = validateAnswerText(workLong, "work");
    assert.ok(workCheck.fields.answerText);
  });

  it("P1-2: JSON payload 413 returns Russian message", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send(`${"x".repeat(300_000)}`);
    assert.equal(res.status, 413);
    assert.equal(res.body.error, "payload_too_large");
    assert.match(res.body.details.message, /слишком большой/i);
  });

  it("P2-3: client descriptor uses dash when where has parentheses", () => {
    const label = formatClientDescriptor({
      client_name: "r11-check",
      client_version: "1.0",
      client_where: "Claude Code (r26 test)",
    });
    assert.equal(label, "r11-check 1.0 — Claude Code (r26 test)");
    assert.doesNotMatch(label, /\([^)]*\([^)]*\)/);
  });

  it("P2-6: REST call analysis exposes summaryText", async () => {
    const cafe = request.agent(app);
    await cafe.post("/api/auth/login").send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    const db = require("../app/db").getDb();
    const ended = db
      .prepare(
        `SELECT c.id FROM calls c
         JOIN invitations i ON i.id = c.invitation_id
         WHERE c.status = 'ended' AND i.employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')
         LIMIT 1`
      )
      .get();
    if (!ended) return;
    const analysis = await cafe.get(`/api/calls/${ended.id}/analysis`);
    assert.equal(analysis.status, 200);
    assert.ok(analysis.body.summaryText);
    assert.equal(analysis.body.summaryText, analysis.body.summary_text);
  });

  it("P1-2: tasks UI exposes maxlength and length counter", () => {
    const html = fs.readFileSync(path.join(__dirname, "../app/public/candidate/tasks.html"), "utf8");
    assert.match(html, /maxlength="\$\{answerMax\}"/);
    assert.match(html, /answer-len/);
    const appJs = fs.readFileSync(path.join(__dirname, "../app/public/app.js"), "utf8");
    assert.match(appJs, /payload_too_large/);
  });

  it("P2-5: stat tile clamp CSS has ellipsis and anywhere wrap", () => {
    const css = fs.readFileSync(path.join(__dirname, "../app/public/styles.css"), "utf8");
    assert.match(css, /stat-tile-value-clamp[\s\S]*text-overflow:\s*ellipsis/);
    assert.match(css, /stat-tile-value-clamp[\s\S]*overflow-wrap:\s*anywhere/);
  });

  it("P2-5: MCP enum errors are Russian with value hints", async () => {
    const db = require("../app/db").getDb();
    const candId = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;
    const token = insertToken(db, candId, ["read", "write"]);
    const { client, transport } = await connectMcp(baseUrl, token);
    await expectToolError(
      client,
      { name: "respond_invitation", arguments: { invitationId: newId(), decision: "nope" } },
      /accept.*принять/i
    );
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const empToken = insertToken(db, cafeId, ["read", "write"]);
    const emp = await connectMcp(baseUrl, empToken);
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ? LIMIT 1").get(cafeId);
    await expectToolError(
      emp.client,
      {
        name: "decide_candidate",
        arguments: { needId: need.id, candidateId: candId, decision: "maybe" },
      },
      /reject.*отклонить/i
    );
    await transport.close();
    await emp.transport.close();
  });
});
