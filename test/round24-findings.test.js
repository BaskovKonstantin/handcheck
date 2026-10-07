"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const request = require("supertest");
const { registerPayload } = require("./register-payload");
const { newId } = require("../app/lib/ids");
const {
  publicCandidateDisplayName,
  sanitizeStoredDisplayName,
} = require("../app/lib/public-candidate-name");
const { validateOptionalPhone, validateBackgroundEpisode } = require("../app/lib/validation");
const { parseSalaryRange } = require("../app/lib/salary-range");
const answers = require("../scripts/fixtures/distinct-quick-answers");
const { postTypedAnswerTelemetry } = require("./helpers/assessment-telemetry");

function bootServer() {
  const tmpDb = path.join(os.tmpdir(), `hc-r24-${process.pid}-${Date.now()}.sqlite`);
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

function loadResolveEmployerNeedId() {
  const src = fs.readFileSync(path.join(__dirname, "../app/public/app.js"), "utf8");
  const fn = src.match(/function resolveEmployerNeedId\(needs, searchParams\) \{[\s\S]*?\n\}/);
  assert.ok(fn);
  // eslint-disable-next-line no-new-func
  return new Function(`${fn[0]}; return resolveEmployerNeedId;`)();
}

async function registerEmployer(app, email) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send(registerPayload({ email, role: "employer" }));
  await agent.post("/api/auth/confirm").send({ email, code: "000000" });
  await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
  await agent.put("/api/employer/profile").send({ companyName: "Тест R24", contactEmail: email });
  return agent;
}

async function registerCandidate(app, email) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send(registerPayload({ email, role: "candidate" }));
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
  let quickIdx = 0;
  for (const a of cur.body.battery.attempts) {
    const task = await agent.get(`/api/assessment/tasks/${a.id}`);
    const text =
      task.body.type === "work" ? answers.workAnswer : answers.quickAnswerForIndex(quickIdx++);
    await agent.post(`/api/assessment/tasks/${a.id}/open`);
    await postTypedAnswerTelemetry(agent, a.id, text);
    await agent.post(`/api/assessment/tasks/${a.id}/submit`).send({ answerText: text });
  }
}

describe("round 24 findings", () => {
  let server;
  let tmpDb;
  let app;

  before(async () => {
    const boot = bootServer();
    server = boot.server;
    tmpDb = boot.tmpDb;
    app = boot.app;
    await new Promise((r) => server.listen(0, r));
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("P1-1: registration does not expose email prefix to employers", async () => {
    const email = `r24name-${Date.now()}@demo.local`;
    const prefix = email.split("@")[0];
    const agent = await registerCandidate(app, email);
    const prof = await agent.get("/api/candidate/profile");
    assert.equal(prof.body.displayName, "");
    await passTest(agent);
    const employer = await registerEmployer(app, `r24e-${Date.now()}@demo.local`);
    const need = await employer.post("/api/employer/needs").send({
      title: "Need",
      specialization: "backend",
      grade: "middle",
    });
    const me = await agent.get("/api/me");
    const matches = await employer.get(`/api/employer/needs/${need.body.id}/matches`);
    const row = matches.body.items.find((c) => c.id === me.body.id);
    assert.ok(row);
    assert.notEqual(row.displayName, prefix);
    assert.equal(row.displayName, "Кандидат без имени");
    assert.equal(publicCandidateDisplayName(prefix, email), "Кандидат без имени");
    assert.equal(sanitizeStoredDisplayName(prefix, email), "");
  });

  it("P1-2: resolveEmployerNeedId honours ?need= including inactive", () => {
    const resolve = loadResolveEmployerNeedId();
    const needs = [
      { id: "a", active: true, title: "A" },
      { id: "b", active: false, title: "B" },
    ];
    assert.equal(resolve(needs, new URLSearchParams("need=b")), "b");
  });

  it("P1-3: inactive need on create and blocks new invitations", async () => {
    const employer = await registerEmployer(app, `r24n-${Date.now()}@demo.local`);
    const created = await employer.post("/api/employer/needs").send({
      title: "Off",
      specialization: "backend",
      grade: "middle",
      active: false,
    });
    const list = await employer.get("/api/employer/needs");
    const row = list.body.items.find((n) => n.id === created.body.id);
    assert.equal(row.active, false);

    const candEmail = `r24pool-${Date.now()}@demo.local`;
    const cand = await registerCandidate(app, candEmail);
    await passTest(cand);
    const me = await cand.get("/api/me");
    const invite = await employer.post("/api/employer/invitations").send({
      needId: created.body.id,
      candidateId: me.body.id,
      salaryFrom: 150000,
      salaryTo: 200000,
      offerText: "Присоединяйтесь",
      contactChannel: "email",
    });
    assert.equal(invite.status, 409);
    assert.equal(invite.body.error, "need_inactive");
  });

  it("P1-4: ai usage with SQLite datetime tool calls and client attribution", () => {
    const db = require("../app/db").getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const borisId = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;
    db.prepare("DELETE FROM mcp_tool_calls WHERE user_id = ?").run(borisId);
    db.prepare("DELETE FROM attempts WHERE candidate_user_id = ?").run(borisId);
    db.prepare("DELETE FROM batteries WHERE candidate_user_id = ?").run(borisId);
    const sessionId = newId();
    const tokenId = newId();
    db.prepare(
      `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes_json, client_where, logging_consent_at)
       VALUES (?, ?, 'r24', 'hash', 'hc_test', '["read","write"]', 'Claude Code', datetime('now'))`
    ).run(tokenId, borisId);
    const nowSql = "2026-10-06 14:28:00";
    db.prepare(
      `INSERT INTO mcp_client_sessions (id, user_id, api_token_id, client_name, client_version, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, 'Claude Code', '1.0', ?, ?)`
    ).run(sessionId, borisId, tokenId, nowSql, nowSql);
    const bat = db
      .prepare(
        `SELECT id, started_at FROM batteries WHERE candidate_user_id = ? ORDER BY started_at DESC LIMIT 1`
      )
      .get(borisId);
    const batId = bat?.id || newId();
    if (!bat) {
      db.prepare(
        `INSERT INTO batteries (id, candidate_user_id, specialization, claimed_grade, form_key, started_at, completed_at)
         VALUES (?, ?, 'backend', 'middle', 'A', ?, ?)`
      ).run(batId, borisId, nowSql, nowSql);
    }
    db.prepare(
      `UPDATE batteries SET started_at = ?, completed_at = ? WHERE id = ?`
    ).run(nowSql, nowSql, batId);
    const taskId = db.prepare("SELECT id FROM tasks WHERE type = 'quick' LIMIT 1").get().id;
    db.prepare(
      `INSERT INTO attempts (id, candidate_user_id, task_id, battery_id, form_key, answer_text, submitted_at, action_source)
       VALUES (?, ?, ?, ?, 'A', 'ok', ?, 'mcp')`
    ).run(newId(), borisId, taskId, batId, nowSql);
    db.prepare(
      `INSERT INTO mcp_tool_calls (id, session_id, user_id, api_token_id, tool_name, args_masked_json, intent_text, ok, created_at)
       VALUES (?, ?, ?, ?, 'start_assessment', '{}', 'начну тест', 1, ?)`
    ).run(newId(), sessionId, borisId, tokenId, nowSql);
    db.prepare(
      `INSERT INTO mcp_tool_calls (id, session_id, user_id, api_token_id, tool_name, args_masked_json, intent_text, ok, created_at)
       VALUES (?, ?, ?, ?, 'submit_answer', '{}', 'проверяю REST', 1, ?)`
    ).run(newId(), sessionId, borisId, tokenId, nowSql);

    const { summarizeAiUsageForEmployer } = require("../app/lib/ai-usage-summary");
    const summary = summarizeAiUsageForEmployer(cafeId, borisId);
    assert.ok(summary);
    assert.ok(summary.activityLines.some((l) => /Начал тест через ИИ-клиент/.test(l)));
    assert.ok(summary.activityLines.some((l) => /REST|«/.test(l)));
    assert.ok(summary.clients.some((c) => /Claude Code/i.test(c)));
  });

  it("P1-5: phone, episode, scopes, battery spec, consent, transcript, salary", async () => {
    const agent = await registerCandidate(app, `r24v-${Date.now()}@demo.local`);
    const badPhone = await agent.put("/api/candidate/profile").send({
      displayName: "V",
      stack: ["node"],
      phone: "abc",
      contactEmail: "v@test.local",
    });
    assert.equal(badPhone.status, 400);
    assert.match(badPhone.body.details.fields.phone, /корректный телефон/i);

    const v = validateOptionalPhone("abc");
    assert.match(v.fields.phone, /корректный телефон/i);

    try {
      validateBackgroundEpisode({ roleTitle: "x".repeat(5000), domain: "d" });
      assert.fail("expected throw");
    } catch (e) {
      assert.match(e.details.fields.roleTitle, /120/);
    }

    const emp = await registerEmployer(app, `r24tok-${Date.now()}@demo.local`);
    const tok = await emp.post("/api/integrations/tokens").send({
      name: "bad",
      scopes: ["admin"],
      clientWhere: "Cursor",
      loggingConsent: true,
    });
    assert.equal(tok.status, 400);
    assert.match(tok.body.details.fields.scopes, /чтение/i);

    const bat = await agent.post("/api/assessment/battery/start").send({
      specialization: "cobol",
      grade: "god",
      privacyConsent: true,
    });
    assert.equal(bat.status, 400);
    assert.match(bat.body.details.fields.category, /специализацию/i);

    const salary = parseSalaryRange(1, 2);
    assert.match(salary.fields.salaryRange, /10/);

    const cand2 = await registerCandidate(app, `r24call-${Date.now()}@demo.local`);
    await passTest(cand2);
    const me = await cand2.get("/api/me");
    const need = await emp.post("/api/employer/needs").send({
      title: "C",
      specialization: "backend",
      grade: "middle",
    });
    const inv = await emp.post("/api/employer/invitations").send({
      needId: need.body.id,
      candidateId: me.body.id,
      salaryFrom: 150000,
      salaryTo: 200000,
      offerText: "Присоединяйтесь к команде",
      contactChannel: "email",
    });
    assert.equal(inv.status, 201);
    await cand2.post(`/api/candidate/invitations/${inv.body.id}/accept`);
    const callInfo = await cand2.get(`/api/calls/for-invitation/${inv.body.id}`);
    const callId = callInfo.body.callId;
    const badConsent = await cand2
      .post(`/api/calls/${callId}/consent`)
      .send({ accepted: false });
    assert.equal(badConsent.status, 400);
    const consentField =
      badConsent.body.details?.fields?.accepted || badConsent.body.details?.message;
    assert.match(String(consentField || ""), /согласие/i);

    await cand2.post(`/api/calls/${callId}/consent`).send({ accepted: true });
    await emp.post(`/api/calls/${callId}/consent`).send({ accepted: true });
    await cand2.post(`/api/calls/${callId}/start`);
    await emp.post(`/api/calls/${callId}/start`);

    const blankChunk = await cand2
      .post(`/api/calls/${callId}/transcript-chunk`)
      .send({ text: "   " });
    assert.equal(blankChunk.status, 400);

    const huge = await cand2
      .post(`/api/calls/${callId}/transcript-chunk`)
      .send({ text: "Кандидат: " + "z".repeat(25000) });
    assert.equal(huge.status, 400);
  });

  it("P1-7: escapeHtml preserves zero", () => {
    const escapeHtml = loadEscapeHtml();
    assert.equal(escapeHtml(0), "0");
    assert.equal(escapeHtml(null), "");
  });

  it("P1-8: server draft returned on GET task", async () => {
    const agent = await registerCandidate(app, `r24draft-${Date.now()}@demo.local`);
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const cur = await agent.get("/api/assessment/battery/current");
    const attemptId = cur.body.battery.attempts[0].id;
    await agent.post(`/api/assessment/tasks/${attemptId}/open`);
    await agent.patch(`/api/assessment/tasks/${attemptId}/draft`).send({
      answerText: "черновик с сервера",
    });
    const task = await agent.get(`/api/assessment/tasks/${attemptId}`);
    assert.equal(task.body.draftText, "черновик с сервера");
  });

  it("P1-9: deferred invite returns candidate_deferred not pool", async () => {
    const employer = await registerEmployer(app, `r24def-${Date.now()}@demo.local`);
    const need = await employer.post("/api/employer/needs").send({
      title: "D",
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    const cand = await registerCandidate(app, `r24defc-${Date.now()}@demo.local`);
    await passTest(cand);
    const me = await cand.get("/api/me");
    await employer.post(`/api/employer/needs/${need.body.id}/reviews`).send({
      decision: "later",
      candidateId: me.body.id,
    });
    const inv = await employer.post("/api/employer/invitations").send({
      needId: need.body.id,
      candidateId: me.body.id,
      salaryFrom: 150000,
      salaryTo: 200000,
      offerText: "x",
      contactChannel: "email",
    });
    assert.equal(inv.status, 409);
    assert.equal(inv.body.error, "candidate_deferred");
  });

  it("P1-4 MCP get_call_analysis includes aiUsage", async () => {
    const db = require("../app/db").getDb();
    const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const inv = db
      .prepare(
        `SELECT c.id AS call_id FROM calls c
         JOIN invitations i ON i.id = c.invitation_id
         WHERE i.employer_user_id = ? AND c.status = 'ended' LIMIT 1`
      )
      .get(cafeId);
    if (!inv) return;
    const { getCallAnalysis } = require("../app/modules/mcp/services");
    const out = getCallAnalysis(cafeId, inv.call_id);
    assert.ok("aiUsage" in out);
  });
});
