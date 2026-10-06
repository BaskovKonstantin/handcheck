"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const answers = require("../scripts/fixtures/canonical-answer-ab.json");

function loadEscapeHtml() {
  const src = fs.readFileSync(path.join(__dirname, "../app/public/app.js"), "utf8");
  const fn = src.match(/function escapeHtml\(text\) \{[\s\S]*?\n\}/);
  assert.ok(fn, "escapeHtml in app.js");
  // eslint-disable-next-line no-new-func
  return new Function(`${fn[0]}; return escapeHtml;`)();
}

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-bugbot-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  return { app: createApp(), tmpDb };
}

async function registerCandidate(app, email) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({
    email,
    password: "demo-demo-demo",
    role: "candidate",
  });
  await agent.post("/api/auth/confirm").send({ email, code: "000000" });
  await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
  await agent.put("/api/candidate/profile").send({
    displayName: "Test",
    stack: ["node"],
    phone: "+79001112233",
    contactEmail: email,
  });
  return agent;
}

async function completeBattery(agent, specialization, grade, mode) {
  const start = await agent.post("/api/assessment/battery/start").send({ specialization, grade });
  assert.equal(start.status, 201, `battery start ${specialization}/${grade}: ${start.body?.error || start.text}`);
  const battery = await agent.get("/api/assessment/battery/current");
  assert.ok(battery.body.battery, "expected active battery");
  for (const a of battery.body.battery.attempts) {
    let answerText = "не знаю";
    if (mode === "pass") {
      const task = await agent.get(`/api/assessment/tasks/${a.id}`);
      answerText = task.body.type === "work" ? answers.workAnswer : answers.quickAnswer;
    }
    await agent.post(`/api/assessment/tasks/${a.id}/submit`).send({ answerText });
  }
}

describe("PR14 bugbot fixes", () => {
  let app;
  let tmpDb;

  before(() => {
    ({ app, tmpDb } = freshApp());
  });

  after(() => {
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("escapes MCP intent HTML for safe innerHTML rendering", () => {
    const escapeHtml = loadEscapeHtml();
    const malicious = '<img src=x onerror=alert(1)>';
    const safe = escapeHtml(malicious);
    assert.ok(safe.startsWith("&lt;img"));
    assert.ok(!safe.includes("<"));
  });

  it("past API uses per-battery outcome, not current category", async () => {
    const email = `past-${Date.now()}@demo.local`;
    const agent = await registerCandidate(app, email);
    await completeBattery(agent, "backend", "middle", "fail");
    const db = require("../app/db").getDb();
    const userId = db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
    const catRow = db
      .prepare("SELECT id, label FROM categories WHERE specialization = 'backend' AND grade = 'middle'")
      .get();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO candidate_categories
       (candidate_user_id, category_id, specialization, grade, test_score, knowledge, breadth, motivation, assigned_at)
       VALUES (?, ?, 'backend', 'middle', 0.9, 0.9, 0.9, 0.9, ?)`
    ).run(userId, catRow.id, now);
    const listed = await agent.get("/api/candidate/past");
    assert.equal(listed.body.batteries.length, 1);
    assert.match(listed.body.batteries[0].outcome, /не подтверждена/);
    assert.ok(listed.body.batteries[0].retakeAt);
  });

  it("finalizeBattery idempotent return reflects stored battery result", async () => {
    const email = `fin-${Date.now()}@demo.local`;
    const agent = await registerCandidate(app, email);
    await completeBattery(agent, "backend", "middle", "fail");
    const { finalizeBattery } = require("../app/modules/assessment/service");
    const db = require("../app/db").getDb();
    const userId = db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
    const bat = db
      .prepare(
        `SELECT id, claimed_grade FROM batteries WHERE candidate_user_id = ? ORDER BY completed_at DESC LIMIT 1`
      )
      .get(userId);
    const again = finalizeBattery(bat.id, userId, bat.claimed_grade);
    assert.equal(again.alreadyFinalized, true);
    assert.equal(again.passed, false);
    assert.equal(again.message, "not_confirmed");
  });

  it("maskArgs hides secret-like values and truncates long answer text", () => {
    const { maskArgs } = require("../app/lib/mcp-telemetry");
    const masked = maskArgs({
      token: "hc_live_abcdefghijklmnop",
      answerText: "a".repeat(400),
      note: "Bearer xyz",
    });
    assert.equal(masked.token, "[скрыто]");
    assert.equal(masked.note, "[скрыто]");
    assert.ok(masked.answerText.length < 400);
    assert.ok(masked.answerText.endsWith("…"));
  });

  it("maskArgs masks every secret-like value across fields and repeated calls", () => {
    const { maskArgs } = require("../app/lib/mcp-telemetry");

    function expectMasked(masked, path, expected = "[скрыто]") {
      const parts = path.split(".");
      let cur = masked;
      for (const p of parts) cur = cur[p];
      assert.equal(cur, expected, path);
    }

    const payloads = [
      {
        args: {
          first: "hc_live_aaaaaaaaaaaa",
          second: "hc_live_bbbbbbbbbbbb",
          third: "hc_test_cccccccccccc",
        },
        masked: ["first", "second", "third"],
      },
      {
        args: {
          auth: "Bearer eyJhbGciOiJIUzI1NiJ9",
          backup: "Bearer another-token-value",
        },
        masked: ["auth", "backup"],
      },
      {
        args: {
          memo: "use password qwerty here",
          hint: "api token leaked",
        },
        masked: ["memo", "hint"],
      },
      {
        args: {
          nested: { deep: "hc_nested_dddddddddddd" },
          plain: "safe text only",
        },
        masked: ["nested.deep"],
        plain: ["plain"],
      },
    ];

    for (let round = 0; round < 8; round += 1) {
      for (const { args, masked: maskedPaths, plain: plainPaths } of payloads) {
        const masked = maskArgs(args);
        for (const p of maskedPaths) expectMasked(masked, p);
        if (plainPaths) {
          for (const p of plainPaths) expectMasked(masked, p, args[p]);
        }
      }
    }
  });
});
