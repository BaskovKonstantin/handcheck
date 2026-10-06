"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const request = require("supertest");
const { newId } = require("../app/lib/ids");
const { validateAnswerText } = require("../app/lib/assessment-answer");
const { publicCandidateDisplayName } = require("../app/lib/public-candidate-name");
const { validateNeedBody, normalizeStackInput } = require("../app/lib/need-validation");

function bootServer() {
  const tmpDb = path.join(os.tmpdir(), `hc-r22-${process.pid}-${Date.now()}.sqlite`);
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

function loadStatTilesHtml() {
  const src = fs.readFileSync(path.join(__dirname, "../app/public/app.js"), "utf8");
  const fn = src.match(/function statTilesHtml\(tiles[^)]*\) \{[\s\S]*?\n\}/);
  assert.ok(fn);
  const escFn = src.match(/function escapeHtml\(text\) \{[\s\S]*?\n\}/);
  // eslint-disable-next-line no-new-func
  return new Function(`${escFn[0]}; ${fn[0]}; return statTilesHtml;`)();
}

function loadFormatApiError() {
  const src = fs.readFileSync(path.join(__dirname, "../app/public/app.js"), "utf8");
  const errBlock = src.match(/const ERROR_MESSAGES = \{[\s\S]*?\};/);
  const fn = src.match(/function formatApiError\(err\) \{[\s\S]*?\n\}/);
  const retake = src.match(/function formatRetakeDateMoscow\(iso\) \{[\s\S]*?\n\}/);
  assert.ok(fn && errBlock);
  // eslint-disable-next-line no-new-func
  return new Function(`${errBlock[0]}; ${retake ? retake[0] : ""} ${fn[0]}; return formatApiError;`)();
}

async function registerEmployer(app, email) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ email, password: "demo-demo-demo", role: "employer" });
  await agent.post("/api/auth/confirm").send({ email, code: "000000" });
  await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
  return agent;
}

async function registerCandidate(app, email, displayName) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ email, password: "demo-demo-demo", role: "candidate" });
  await agent.post("/api/auth/confirm").send({ email, code: "000000" });
  await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
  if (displayName !== undefined) {
    await agent.put("/api/candidate/profile").send({
      displayName,
      stack: ["node"],
      phone: "+79001112233",
      contactEmail: email,
    });
  }
  return agent;
}

describe("round 22 findings", () => {
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

  it("P0-1: statTilesHtml escapes stack XSS payload", () => {
    const statTilesHtml = loadStatTilesHtml();
    const payload = '<img src=x onerror="document.title=1">';
    const html = statTilesHtml([{ label: "Стек", value: payload }]);
    assert.ok(!html.includes("<img"));
    assert.match(html, /&lt;img/);
  });

  it("P0-1: public template escape check passes", () => {
    const { execSync } = require("child_process");
    execSync("node scripts/check-public-template-escape.js", {
      cwd: path.join(__dirname, ".."),
      stdio: "pipe",
    });
  });

  it("P0-2: invitation rejects candidate outside pool", async () => {
    const employer = await registerEmployer(app, `r22e-${Date.now()}@demo.local`);
    await employer.put("/api/employer/profile").send({
      companyName: "R22 Co",
      contactEmail: "hr@r22.test",
    });
    const need = await employer.post("/api/employer/needs").send({
      title: "Backend middle",
      specialization: "backend",
      grade: "middle",
      stack: ["node"],
    });
    const candEmail = `r22k-${Date.now()}@demo.local`;
    await registerCandidate(app, candEmail, "");
    const db = require("../app/db").getDb();
    const candId = db.prepare("SELECT id FROM users WHERE email = ?").get(candEmail).id;
    const bad = await employer.post("/api/employer/invitations").send({
      needId: need.body.id,
      candidateId: candId,
      salaryFrom: 100000,
      salaryTo: 150000,
      offerText: "Приглашение",
      contactChannel: "email",
    });
    assert.equal(bad.status, 409);
    assert.equal(bad.body.error, "candidate_not_in_pool");
  });

  it("P1-3: empty answer rejected on submit", async () => {
    const agent = await registerCandidate(app, `r22d-${Date.now()}@demo.local`, "Tester");
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
    });
    const battery = await agent.get("/api/assessment/battery/current");
    const attemptId = battery.body.battery.attempts[0].id;
    const empty = await agent
      .post(`/api/assessment/tasks/${attemptId}/submit`)
      .send({ answerText: "   " });
    assert.equal(empty.status, 400);
    assert.match(empty.body.details.fields.answerText, /Напишите ответ/i);
    const parsed = validateAnswerText("   ", "quick");
    assert.equal(parsed.ok, false);
  });

  it("P1-4: public candidate name fallback", () => {
    assert.equal(publicCandidateDisplayName(""), "Кандидат без имени");
    assert.equal(publicCandidateDisplayName("  Анна  "), "Анна");
    assert.equal(publicCandidateDisplayName("r24h-1", "r24h-1@demo.local"), "Кандидат без имени");
  });

  it("P1-5: empty company name rejected", async () => {
    const agent = await registerEmployer(app, `r22x-${Date.now()}@demo.local`);
    const res = await agent.put("/api/employer/profile").send({ companyName: "" });
    assert.equal(res.status, 400);
    assert.match(res.body.details.fields.companyName, /компани/i);
  });

  it("P1-9: candidate stack dedupe and need notes limit", () => {
    const stack = normalizeStackInput(["Node.js", "node.js", "NODE.JS"]);
    assert.equal(stack.stack.length, 1);
    const notes = validateNeedBody({ title: "t", notes: "x".repeat(5001) });
    assert.match(notes.fields.notes, /Заметки/);
    const active = validateNeedBody({ title: "t", active: "no" });
    assert.match(active.fields.active, /активна/i);
  });

  it("P1-8: formatApiError surfaces password field error", () => {
    const formatApiError = loadFormatApiError();
    const msg = formatApiError({
      data: { error: "invalid_body", details: { fields: { password: "Пароль — минимум 8 символов" } } },
    });
    assert.match(msg, /8 символов/);
    const taken = formatApiError({ data: { error: "email_taken" } });
    assert.match(taken, /уже зарегистрирован/i);
  });
});
