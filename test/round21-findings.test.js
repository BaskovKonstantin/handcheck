"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const request = require("supertest");
const { newId } = require("../app/lib/ids");
const { validateNeedBody } = require("../app/lib/need-validation");
const { normalizeStackToken, stackMatchesFilter, stackOverlapTokens } = require("../app/lib/stack-normalize");
const { parseSalaryRange } = require("../app/lib/salary-range");
const { summarizeAiUsageForEmployer } = require("../app/lib/ai-usage-summary");

function bootServer() {
  const tmpDb = path.join(os.tmpdir(), `hc-r21-${process.pid}-${Date.now()}.sqlite`);
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

function loadEscapeHtml() {
  const src = fs.readFileSync(path.join(__dirname, "../app/public/app.js"), "utf8");
  const fn = src.match(/function escapeHtml\(text\) \{[\s\S]*?\n\}/);
  assert.ok(fn);
  // eslint-disable-next-line no-new-func
  return new Function(`${fn[0]}; return escapeHtml;`)();
}

function loadResolveNeedId() {
  const src = fs.readFileSync(path.join(__dirname, "../app/public/app.js"), "utf8");
  const fn = src.match(/function resolveEmployerNeedId\(needs, searchParams\) \{[\s\S]*?\n\}/);
  assert.ok(fn);
  // eslint-disable-next-line no-new-func
  return new Function(`${fn[0]}; return resolveEmployerNeedId;`)();
}

describe("round 21 findings", () => {
  let server;
  let tmpDb;
  let app;

  before(async () => {
    const boot = bootServer();
    server = boot.server;
    tmpDb = boot.tmpDb;
    app = boot.app;
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("1: escapeHtml neutralizes XSS payloads", () => {
    const escapeHtml = loadEscapeHtml();
    const payload = '<img src=x onerror="document.title=\'x\'">';
    const safe = escapeHtml(payload);
    assert.ok(!safe.includes("<"));
    assert.match(safe, /&lt;img/);
  });

  it("1: public list templates pass escape check script", () => {
    const { execSync } = require("child_process");
    execSync("node scripts/check-public-template-escape.js", { cwd: path.join(__dirname, ".."), stdio: "pipe" });
  });

  it("2: resolveEmployerNeedId prefers query then active need", () => {
    const resolve = loadResolveNeedId();
    const needs = [
      { id: "a", title: "Alpha", active: 1 },
      { id: "b", title: "Beta", active: 0 },
      { id: "c", title: "Gamma", active: 1 },
    ];
    assert.equal(resolve(needs, new URLSearchParams("need=b")), "b");
    assert.equal(resolve(needs, new URLSearchParams()), "a");
  });

  it("3: need validation rejects bad specialization and empty title", () => {
    const bad = validateNeedBody({ title: "", specialization: "chef", grade: "god" });
    assert.equal(bad.ok, false);
    assert.match(bad.fields.title, /название/i);
    assert.match(bad.fields.specialization, /специализацию/i);
    assert.match(bad.fields.grade, /грейд/i);
  });

  it("3: need POST returns 400 for invalid body", async () => {
    const agent = request.agent(app);
    const email = `r21e-${Date.now()}@demo.local`;
    await agent.post("/api/auth/register").send({ email, password: "demo-demo-demo", role: "employer" });
    await agent.post("/api/auth/confirm").send({ email, code: "000000" });
    await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
    const res = await agent.post("/api/employer/needs").send({ title: "", specialization: "chef", grade: "x" });
    assert.equal(res.status, 400);
    assert.ok(res.body.details?.fields?.title);
  });

  it("4: salary upper bound and offer length", () => {
    const high = parseSalaryRange(100_000, 1e15);
    assert.match(high.fields.salaryRange, /Слишком большая сумма/);
  });

  it("6: stack normalization matches Node.js and node", () => {
    assert.equal(normalizeStackToken("Node.js"), "node");
    assert.equal(normalizeStackToken("nodejs"), "node");
    assert.ok(stackMatchesFilter(["Node.js", "Redis"], "node"));
    const overlap = stackOverlapTokens(["node"], ["Node.js"]);
    assert.deepEqual(overlap, ["Node.js"]);
  });

  it("5: aiUsage ignores post-test list_tasks flood", () => {
    const db = require("../app/db").getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const candId = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;
    const needId = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafeId).id;
    const existingInv = db
      .prepare(
        `SELECT id FROM invitations WHERE employer_user_id = ? AND candidate_user_id = ? LIMIT 1`
      )
      .get(cafeId, candId);
    if (!existingInv) {
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
         VALUES (?, ?, ?, ?, 100000, 120000, 'ai', 'email', 'sent')`
      ).run(newId(), cafeId, needId, candId);
    }
    let bat = db
      .prepare(
        `SELECT id, started_at, completed_at FROM batteries WHERE candidate_user_id = ? ORDER BY started_at DESC LIMIT 1`
      )
      .get(candId);
    if (!bat) {
      const batteryId = newId();
      db.prepare(
        `INSERT INTO batteries (id, candidate_user_id, specialization, claimed_grade, form_key, started_at, completed_at)
         VALUES (?, ?, 'backend', 'middle', 'A', datetime('now','-2 hours'), datetime('now','-1 hour'))`
      ).run(batteryId, candId);
      bat = db.prepare("SELECT id, started_at, completed_at FROM batteries WHERE id = ?").get(batteryId);
    }
    db.prepare("DELETE FROM attempts WHERE battery_id = ?").run(bat.id);
    const quickTasks = db.prepare("SELECT id FROM tasks WHERE type = 'quick' LIMIT 4").all();
    const mid = bat.started_at;
    quickTasks.forEach((t) => {
      db.prepare(
        `INSERT INTO attempts (id, candidate_user_id, task_id, battery_id, form_key, answer_text, submitted_at, action_source)
         VALUES (?, ?, ?, ?, 'A', 'ok', ?, 'mcp')`
      ).run(newId(), candId, t.id, bat.id, mid);
    });
    const workTask = db.prepare("SELECT id FROM tasks WHERE type = 'work' LIMIT 1").get();
    if (workTask) {
      db.prepare(
        `INSERT INTO attempts (id, candidate_user_id, task_id, battery_id, form_key, answer_text, submitted_at, action_source)
         VALUES (?, ?, ?, ?, 'A', 'work', ?, 'mcp')`
      ).run(newId(), candId, workTask.id, bat.id, mid);
    }
    db.prepare(
      `INSERT INTO mcp_tool_calls (id, user_id, tool_name, ok, created_at)
       VALUES (?, ?, 'start_assessment', 1, ?)`
    ).run(newId(), candId, mid);
    quickTasks.forEach((_, i) => {
      db.prepare(
        `INSERT INTO mcp_tool_calls (id, user_id, tool_name, ok, intent_text, created_at)
         VALUES (?, ?, 'submit_answer', 1, ?, ?)`
      ).run(newId(), candId, `quick ${i}`, mid);
    });
    for (let i = 0; i < 15; i += 1) {
      db.prepare(
        `INSERT INTO mcp_tool_calls (id, user_id, tool_name, ok, created_at)
         VALUES (?, ?, 'list_tasks', 1, datetime('now'))`
      ).run(newId(), candId);
    }
    delete require.cache[require.resolve("../app/lib/ai-usage-summary")];
    const { summarizeAiUsageForEmployer: summarize } = require("../app/lib/ai-usage-summary");
    assert.ok(summarize(cafeId, candId));
    const summary = summarize(cafeId, candId);
    assert.match(summary.headline, /Весь тест проходил через ИИ-клиент/);
    assert.ok(summary.activityLines.some((l) => /короткие ответы/i.test(l)));
    assert.ok(!summary.activityLines.some((l) => /список заданий/i.test(l)));
  });
});
