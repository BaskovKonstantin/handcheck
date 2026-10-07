"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");

const {
  isQuickPasteHeavyByTotals,
  isQuickPasteHeavyFromMetrics,
  getEmployerPasteInputMark,
  QUICK_PASTE_HEAVY_CHAR_RATIO,
} = require("../app/lib/employer-paste-indicator");
const { newId } = require("../app/lib/ids");

describe("employer paste indicator threshold", () => {
  it("uses strict majority of quick answer characters from paste", () => {
    assert.equal(QUICK_PASTE_HEAVY_CHAR_RATIO, 0.5);
    assert.equal(isQuickPasteHeavyByTotals(60, 100), true);
    assert.equal(isQuickPasteHeavyByTotals(50, 100), false);
    assert.equal(isQuickPasteHeavyByTotals(13, 24), true);
    assert.equal(isQuickPasteHeavyByTotals(12, 24), false);
    assert.equal(isQuickPasteHeavyByTotals(100, 20), false);
  });

  it("aggregates across quick attempts", () => {
    assert.equal(
      isQuickPasteHeavyFromMetrics([
        { pastedChars: 30, answerLength: 50 },
        { pastedChars: 10, answerLength: 50 },
      ]),
      false
    );
    assert.equal(
      isQuickPasteHeavyFromMetrics([
        { pastedChars: 40, answerLength: 50 },
        { pastedChars: 20, answerLength: 50 },
      ]),
      true
    );
  });
});

describe("employer paste indicator API", () => {
  const tmpDb = path.join(os.tmpdir(), `hc-paste-${process.pid}-${Date.now()}.sqlite`);
  let app;
  let db;
  let employerAgent;
  let candidateAgent;
  let needId;
  let candidateId;

  before(async () => {
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    const { createApp } = require("../app/server");
    app = createApp();
    db = require("../app/db").getDb();

    employerAgent = request.agent(app);
    await employerAgent.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });
    candidateId = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get().id;
    candidateAgent = request.agent(app);
    await candidateAgent.post("/api/auth/login").send({
      email: "anna@demo.local",
      password: "demo-demo-demo",
    });

    needId = db
      .prepare(
        "SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')"
      )
      .get().id;
  });

  function seedQuickBattery(metricsList) {
    db.prepare("DELETE FROM attempt_events WHERE attempt_id IN (SELECT id FROM attempts WHERE candidate_user_id = ?)").run(
      candidateId
    );
    db.prepare("DELETE FROM attempts WHERE candidate_user_id = ?").run(candidateId);
    db.prepare("DELETE FROM batteries WHERE candidate_user_id = ?").run(candidateId);
    const batId = newId();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO batteries (id, candidate_user_id, specialization, claimed_grade, form_key, started_at, completed_at)
       VALUES (?, ?, 'backend', 'middle', 'A', ?, ?)`
    ).run(batId, candidateId, now, now);
    const quickTasks = db.prepare("SELECT id FROM tasks WHERE type = 'quick' LIMIT 2").all();
    assert.ok(quickTasks.length >= 1);
    for (let i = 0; i < metricsList.length; i++) {
      const taskId = quickTasks[i % quickTasks.length].id;
      const attemptId = newId();
      const m = metricsList[i];
      db.prepare(
        `INSERT INTO attempts (id, candidate_user_id, task_id, battery_id, form_key, answer_text, submitted_at, action_source, integrity_metrics_json)
         VALUES (?, ?, ?, ?, 'A', ?, ?, 'web', ?)`
      ).run(
        attemptId,
        candidateId,
        taskId,
        batId,
        "x".repeat(m.answerLength),
        now,
        JSON.stringify({ pastedChars: m.pastedChars, answerLength: m.answerLength })
      );
    }
  }

  it("exposes pasteInputMark on employer matches when threshold met", async () => {
    seedQuickBattery([
      { pastedChars: 80, answerLength: 100 },
      { pastedChars: 30, answerLength: 50 },
    ]);
    assert.ok(getEmployerPasteInputMark(db, candidateId));
    const matches = await employerAgent.get(`/api/employer/needs/${needId}/matches`);
    const row = matches.body.items.find((c) => c.id === candidateId);
    assert.ok(row);
    assert.ok(row.pasteInputMark?.label);
    assert.match(row.pasteInputMark.label, /вставлены/i);
  });

  it("omits pasteInputMark when answers are mostly typed", async () => {
    seedQuickBattery([
      { pastedChars: 10, answerLength: 100 },
      { pastedChars: 5, answerLength: 50 },
    ]);
    assert.equal(getEmployerPasteInputMark(db, candidateId), null);
    const deck = await employerAgent.get(`/api/employer/needs/${needId}/deck/next`);
    if (deck.body.candidateId === candidateId) {
      assert.equal(deck.body.card.pasteInputMark, null);
    }
    const matches = await employerAgent.get(`/api/employer/needs/${needId}/matches`);
    const row = matches.body.items.find((c) => c.id === candidateId);
    assert.ok(row);
    assert.equal(row.pasteInputMark, undefined);
  });

  it("does not expose pasteInputMark on candidate APIs", async () => {
    seedQuickBattery([{ pastedChars: 200, answerLength: 200 }]);
    const cat = await candidateAgent.get("/api/candidate/category");
    const body = JSON.stringify(cat.body);
    assert.ok(!body.includes("pasteInputMark"));
    assert.ok(!body.includes("вставлены"));
    const prof = await candidateAgent.get("/api/candidate/profile");
    assert.ok(!JSON.stringify(prof.body).includes("pasteInputMark"));
  });
});
