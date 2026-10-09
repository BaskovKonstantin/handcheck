"use strict";

/**
 * Числа для отчёта о валидации (презентация и документация).
 *
 *   node scripts/assessment-metrics.js            # человекочитаемый вывод
 *   METRICS_JSON=context/metrics.json node scripts/assessment-metrics.js
 *
 * Считает на временной БД сида то же, что проверяет validate-assessment.js,
 * но печатает сами значения: эквивалентность форм A/B, score сильных и слабых
 * ответов против cutoff, распределение заданий и устойчивость к утечкам.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");

const tmpDb = path.join(os.tmpdir(), `hc-metrics-${process.pid}.sqlite`);
if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
process.env.DB_PATH = tmpDb;
process.env.DEMO_MODE = "1";
process.env.DEMO_PASSWORD = "demo-demo-demo";

const { createApp } = require("../app/server");
const { getDb } = require("../app/db");
const { scoreQuick, scoreWork, aggregateBattery, cutoffForGrade } = require("../app/lib/rubric-score");
const canonical = require("./fixtures/canonical-answer-ab.json");
const strong = require("./fixtures/distinct-quick-answers");
const weak = require("./fixtures/backend-middle-weak.json");

const CUTOFFS = { junior: cutoffForGrade("junior"), middle: cutoffForGrade("middle"), senior: cutoffForGrade("senior") };

function scoreForm(db, grade, formKey, answers) {
  const tasks = db
    .prepare(
      `SELECT * FROM tasks WHERE specialization = 'backend' AND grade = ? AND form_key = ? AND status = 'published' ORDER BY rowid`
    )
    .all(grade, formKey);
  const quick = tasks.filter((t) => t.type === "quick");
  const work = tasks.find((t) => t.type === "work");
  const qs = quick.map((t, i) => scoreQuick(answers.quickAnswerForIndex ? answers.quickAnswerForIndex(i) : answers.quickAnswer, JSON.parse(t.rubric_json)));
  const ws = scoreWork(answers.workAnswer, JSON.parse(work.rubric_json));
  const agg = aggregateBattery(qs, ws);
  return { score: agg.test_score, knowledge: agg.knowledge, breadth: agg.breadth, quick: quick.length, work: work ? 1 : 0 };
}

async function leakage(db, app) {
  // Свежие кандидатели на каждую выдачу: у каждого своя батарея без кулдауна.
  // Считаем, сколько разных form_key реально выдаётся в одной ячейке.
  const cells = ["backend", "frontend", "qa"].flatMap((s) =>
    ["junior", "middle", "senior"].map((g) => `${s}×${g}`)
  );
  const seen = {};
  for (const cell of cells) {
    const [specialization, grade] = cell.split("×");
    const keys = new Set();
    for (let i = 0; i < 6; i += 1) {
      const email = `leak-${cell}-${i}-${Date.now()}@metrics.local`;
      const agent = request.agent(app);
      await agent
        .post("/api/auth/register")
        .send({ email, password: "metrics-metrics", role: "candidate", birthDate: "1995-05-05", privacyConsent: true });
      await agent.post("/api/auth/confirm").send({ email, code: "000000" });
      await agent.post("/api/auth/login").send({ email, password: "metrics-metrics" });
      const res = await agent
        .post("/api/assessment/battery/start")
        .send({ specialization, grade, privacyConsent: true });
      if (res.status === 200 || res.status === 201) keys.add(res.body.formKey);
    }
    seen[cell] = { starts: 6, formKeys: [...keys].sort() };
  }
  return seen;
}

async function main() {
  const app = createApp();
  const db = getDb();

  const formA = scoreForm(db, "middle", "A", canonical);
  const formB = scoreForm(db, "middle", "B", canonical);
  const strongScore = scoreForm(db, "middle", "A", strong);
  const weakScore = scoreForm(db, "middle", "A", weak);
  const strongJunior = scoreForm(db, "junior", "A", strong);

  const batteries = db
    .prepare(
      `SELECT specialization, grade, COUNT(*) AS cells,
              SUM(CASE WHEN form_key = 'A' THEN 1 ELSE 0 END) AS form_a,
              SUM(CASE WHEN form_key = 'B' THEN 1 ELSE 0 END) AS form_b,
              SUM(CASE WHEN type = 'quick' THEN 1 ELSE 0 END) AS quick,
              SUM(CASE WHEN type = 'work' THEN 1 ELSE 0 END) AS work
       FROM tasks WHERE status = 'published'
       GROUP BY specialization, grade ORDER BY specialization, grade`
    )
    .all();

  const spread = await leakage(db, app);
  const cellsWithTwoForms = Object.values(spread).filter((v) => v.formKeys.length === 2).length;
  const leakageResistance = {
    startsPerCell: 6,
    cellsChecked: Object.keys(spread).length,
    cellsWithBothForms: cellsWithTwoForms,
    pass: cellsWithTwoForms === Object.keys(spread).length,
  };

  const metrics = {
    generatedAt: new Date().toISOString(),
    cutoffs: CUTOFFS,
    formEquivalence: {
      scoreA: Number(formA.score.toFixed(3)),
      scoreB: Number(formB.score.toFixed(3)),
      delta: Number(Math.abs(formA.score - formB.score).toFixed(3)),
      threshold: 0.15,
      pass: Math.abs(formA.score - formB.score) < 0.15,
    },
    answerQuality: {
      strong: Number(strongScore.score.toFixed(3)),
      weak: Number(weakScore.score.toFixed(3)),
      gap: Number((strongScore.score - weakScore.score).toFixed(3)),
      strongVerdict: strongScore.score >= CUTOFFS.middle ? "подтверждён" : "не подтверждён",
      weakVerdict: weakScore.score >= CUTOFFS.middle ? "подтверждён" : "не подтверждён",
      strongOnJuniorForm: Number(strongJunior.score.toFixed(3)),
    },
    perGrade: ["junior", "middle", "senior"].map((g) => ({
      grade: g,
      cutoff: CUTOFFS[g],
      strong: Number(scoreForm(db, g, "A", strong).score.toFixed(3)),
      weak: Number(scoreForm(db, g, "A", weak).score.toFixed(3)),
    })),
    battery: batteries.map((b) => ({
      cell: `${b.specialization} × ${b.grade}`,
      tasks: b.cells,
      quick: b.quick,
      work: b.work,
      formA: b.form_a,
      formB: b.form_b,
    })),
    batteryCells: batteries.length,
    totalPublishedTasks: batteries.reduce((s, b) => s + b.cells, 0),
    formSpread: spread,
    leakageResistance,
  };

  console.log("HandCheck — метрики валидации");
  console.log(`  cutoff: junior=${CUTOFFS.junior} middle=${CUTOFFS.middle} senior=${CUTOFFS.senior}`);
  console.log(
    `  формы A/B на одинаковых ответах: ${metrics.formEquivalence.scoreA} / ${metrics.formEquivalence.scoreB}, Δ=${metrics.formEquivalence.delta} (порог ${metrics.formEquivalence.threshold}) → ${metrics.formEquivalence.pass ? "OK" : "FAIL"}`
  );
  console.log(
    `  сильные ответы: ${metrics.answerQuality.strong} (${metrics.answerQuality.strongVerdict}), слабые: ${metrics.answerQuality.weak} (${metrics.answerQuality.weakVerdict}), разрыв ${metrics.answerQuality.gap}`
  );
  console.log(`  батарей (специализация × грейд): ${metrics.batteryCells}, опубликованных заданий: ${metrics.totalPublishedTasks}`);
  for (const b of metrics.battery) console.log(`    ${b.cell}: ${b.tasks} (quick ${b.quick} + work ${b.work}), формы A=${b.formA} B=${b.formB}`);
  console.log(
    `  выдача форм: ${metrics.leakageResistance.cellsWithBothForms}/${metrics.leakageResistance.cellsChecked} ячеек показали обе формы за ${metrics.leakageResistance.startsPerCell} выдач → ${metrics.leakageResistance.pass ? "OK" : "FAIL"}`
  );

  if (process.env.METRICS_JSON) {
    fs.mkdirSync(path.dirname(process.env.METRICS_JSON), { recursive: true });
    fs.writeFileSync(process.env.METRICS_JSON, JSON.stringify(metrics, null, 2));
    console.log(`  JSON: ${process.env.METRICS_JSON}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});