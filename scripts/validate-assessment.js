"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");
const request = require("supertest");

const tmpDb = path.join(os.tmpdir(), `hc-assess-${process.pid}.sqlite`);
if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
process.env.DB_PATH = tmpDb;
process.env.DEMO_MODE = "1";
process.env.DEMO_PASSWORD = "demo-demo-demo";

const { createApp } = require("../app/server");
const { getDb } = require("../app/db");
const { scoreQuick, scoreWork, aggregateBattery } = require("../app/lib/rubric-score");
const canonical = require("./fixtures/canonical-answer-ab.json");
const strong = require("./fixtures/distinct-quick-answers");
const weak = require("./fixtures/backend-middle-weak.json");

function scoreForm(db, formKey, answers) {
  const tasks = db
    .prepare(
      `SELECT * FROM tasks WHERE specialization = 'backend' AND grade = 'middle' AND form_key = ? AND status = 'published'`
    )
    .all(formKey);
  const quick = tasks.filter((t) => t.type === "quick");
  const work = tasks.find((t) => t.type === "work");
  const quickScores = quick.map((t) =>
    scoreQuick(answers.quickAnswer, JSON.parse(t.rubric_json))
  );
  const workScore = scoreWork(answers.workAnswer, JSON.parse(work.rubric_json));
  const agg = aggregateBattery(quickScores, workScore);
  return agg.knowledge + agg.breadth;
}

async function main() {
  const app = createApp();
  const db = getDb();

  const a = scoreForm(db, "A", canonical);
  const b = scoreForm(db, "B", canonical);
  assert.ok(Math.abs(a - b) < 0.15, `A1 failed: |${a}-${b}|`);
  console.log("A1 pass");

  const strongScore = (() => {
    const tasks = db
      .prepare(
        `SELECT * FROM tasks WHERE specialization = 'backend' AND grade = 'middle' AND form_key = 'A' AND status = 'published'`
      )
      .all();
    const quick = tasks.filter((t) => t.type === "quick");
    const work = tasks.find((t) => t.type === "work");
    const qs = quick.map((t) => scoreQuick(strong.quickAnswer, JSON.parse(t.rubric_json)));
    const ws = scoreWork(strong.workAnswer, JSON.parse(work.rubric_json));
    return aggregateBattery(qs, ws).test_score;
  })();
  assert.ok(strongScore >= 0.68, `A3 failed: ${strongScore}`);
  console.log("A3 pass");

  const weakScore = (() => {
    const tasks = db
      .prepare(
        `SELECT * FROM tasks WHERE specialization = 'backend' AND grade = 'middle' AND form_key = 'A' AND status = 'published'`
      )
      .all();
    const quick = tasks.filter((t) => t.type === "quick");
    const work = tasks.find((t) => t.type === "work");
    const qs = quick.map((t) => scoreQuick(weak.quickAnswer, JSON.parse(t.rubric_json)));
    const ws = scoreWork(weak.workAnswer, JSON.parse(work.rubric_json));
    return aggregateBattery(qs, ws).test_score;
  })();
  assert.ok(weakScore < 0.68, `A2 failed: ${weakScore}`);
  console.log("A2 pass");

  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .send({ email: "anna@demo.local", password: "demo-demo-demo" });
  const start = await agent
    .post("/api/assessment/battery/start")
    .send({ specialization: "backend", grade: "middle" });
  const batteryId = start.body.batteryId;
  const attempts = db
    .prepare("SELECT id, task_id FROM attempts WHERE battery_id = ?")
    .all(batteryId);
  let quickIdx = 0;
  while (true) {
    const cur = await agent.get("/api/assessment/battery/current");
    const next = cur.body.battery?.attempts?.find((a) => !a.submitted);
    if (!next) break;
    await agent.get(`/api/assessment/tasks/${next.id}`);
    const t = db.prepare("SELECT type FROM tasks WHERE id = ?").get(
      db.prepare("SELECT task_id FROM attempts WHERE id = ?").get(next.id).task_id
    );
    const ans =
      t.type === "quick" ? strong.quickAnswerForIndex(quickIdx++) : strong.workAnswer;
    const sub = await agent
      .post(`/api/assessment/tasks/${next.id}/submit`)
      .send({ answerText: ans });
    const body = JSON.stringify(sub.body);
    assert.ok(!body.includes("test_score"), "A4 failed: leaked score");
    assert.ok(!body.includes("integrity"), "A4 failed: leaked integrity");
  }
  console.log("A4 pass");
  console.log("validate-assessment: all pass");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
