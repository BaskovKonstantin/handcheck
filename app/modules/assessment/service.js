"use strict";

const { getDb } = require("../../db");
const {
  scoreQuick,
  scoreWork,
  aggregateBattery,
  cutoffForGrade,
  applyBatteryScoreGuards,
} = require("../../lib/rubric-score");
const { computeMotivation } = require("../../lib/motivation");
const { computeAttemptIntegrity } = require("../../lib/integrity");
const config = require("../../config");
const {
  BATTERY_QUICK_COUNT,
  WORK_DEADLINE_MS,
} = require("../../lib/assessment-timing");

function getPublishedBatteryTasks(specialization, grade, formKey) {
  const db = getDb();
  const quick = db
    .prepare(
      `SELECT * FROM tasks WHERE type = 'quick' AND specialization = ? AND grade = ? AND form_key = ? AND status = 'published'`
    )
    .all(specialization, grade, formKey);
  const work = db
    .prepare(
      `SELECT * FROM tasks WHERE type = 'work' AND specialization = ? AND grade = ? AND form_key = ? AND status = 'published'`
    )
    .get(specialization, grade, formKey);
  return { quick, work };
}

function assertBatteryComplete(quick, work) {
  if (quick.length < BATTERY_QUICK_COUNT || !work) {
    const err = new Error("battery_incomplete");
    err.status = 409;
    err.code = "battery_incomplete";
    throw err;
  }
}

function lastSpecializationAttempt(userId, specialization) {
  return getDb()
    .prepare(
      `SELECT MAX(b.completed_at) AS completed_at FROM batteries b
       WHERE b.candidate_user_id = ? AND b.specialization = ? AND b.completed_at IS NOT NULL`
    )
    .get(userId, specialization);
}

function cooldownActive(completedAt) {
  if (!completedAt) return false;
  const days = config.GRADE_COOLDOWN_DAYS;
  const until = new Date(completedAt);
  until.setDate(until.getDate() + days);
  return new Date() < until;
}

function scoreBatteryAttempts(batteryId, claimedGrade) {
  const db = getDb();
  const attempts = db
    .prepare(
      `SELECT a.*, t.type, t.rubric_json FROM attempts a JOIN tasks t ON t.id = a.task_id
       WHERE a.battery_id = ?`
    )
    .all(batteryId);
  const quickScores = [];
  let workScore = { knowledge: 0, breadth: 0 };
  const rubricsByAttemptId = new Map();
  for (const a of attempts) {
    const rubric = JSON.parse(a.rubric_json);
    rubricsByAttemptId.set(a.id, rubric);
    if (a.type === "quick") {
      quickScores.push(scoreQuick(a.answer_text, rubric));
    } else {
      workScore = scoreWork(a.answer_text, rubric);
    }
  }
  let agg = aggregateBattery(quickScores, workScore);
  agg = applyBatteryScoreGuards(agg, attempts, { rubricsByAttemptId });
  const cutoff = cutoffForGrade(claimedGrade);
  const passed = agg.test_score >= cutoff;
  let label = null;
  if (passed) {
    const battery = db.prepare("SELECT specialization FROM batteries WHERE id = ?").get(batteryId);
    const catRow = db
      .prepare("SELECT label FROM categories WHERE specialization = ? AND grade = ?")
      .get(battery.specialization, claimedGrade);
    label = catRow?.label || null;
  }
  return { passed, label, agg, attempts, workScore };
}

function finalizeBattery(batteryId, userId, claimedGrade) {
  const db = getDb();
  const batteryRow = db.prepare("SELECT completed_at, specialization FROM batteries WHERE id = ?").get(batteryId);
  if (batteryRow?.completed_at) {
    const { passed, label } = scoreBatteryAttempts(batteryId, claimedGrade);
    if (passed) {
      return { passed: true, message: "confirmed", label, alreadyFinalized: true };
    }
    return {
      passed: false,
      message: "not_confirmed",
      retakeAfterDays: config.GRADE_COOLDOWN_DAYS,
      alreadyFinalized: true,
    };
  }
  const { passed, label: scoredLabel, agg, attempts, workScore } = scoreBatteryAttempts(
    batteryId,
    claimedGrade
  );
  let workAttempt = null;
  for (const a of attempts) {
    if (a.type === "work") {
      workAttempt = a;
      break;
    }
  }

  let motivation = 0;
  const integrityParts = [];
  const storeIntegrityMetrics = db.prepare(
    "UPDATE attempts SET integrity_metrics_json = ? WHERE id = ?"
  );
  for (const a of attempts) {
    const events = db
      .prepare("SELECT * FROM attempt_events WHERE attempt_id = ? ORDER BY created_at")
      .all(a.id);
    if (events.length || a.submitted_at) {
      const { integrity: attemptIntegrity, metrics } = computeAttemptIntegrity(events, a);
      integrityParts.push(attemptIntegrity);
      storeIntegrityMetrics.run(JSON.stringify(metrics), a.id);
    }
    if (a.type === "work" && workAttempt) {
      motivation = computeMotivation(
        events,
        workAttempt.opened_at,
        workAttempt.submitted_at,
        WORK_DEADLINE_MS
      );
    }
  }
  const integrity =
    integrityParts.length > 0 ? Math.max(...integrityParts) : 0;

  const now = new Date().toISOString();
  db.prepare("UPDATE batteries SET completed_at = ? WHERE id = ?").run(now, batteryId);

  const priv = db.prepare("SELECT * FROM candidate_private WHERE candidate_user_id = ?").get(userId);
  const newIntegrity = priv
    ? (priv.integrity + integrity) / 2
    : integrity;
  const trust_ok = newIntegrity >= 0.85 ? 0 : 1;
  db.prepare(
    `INSERT INTO candidate_private (candidate_user_id, integrity, trust_ok)
     VALUES (?, ?, ?) ON CONFLICT(candidate_user_id) DO UPDATE SET integrity = excluded.integrity, trust_ok = excluded.trust_ok`
  ).run(userId, newIntegrity, trust_ok);

  if (passed) {
    const battery = db.prepare("SELECT specialization FROM batteries WHERE id = ?").get(batteryId);
    const spec = battery.specialization;
    const catRow = db
      .prepare("SELECT id, label FROM categories WHERE specialization = ? AND grade = ?")
      .get(spec, claimedGrade);
    const existing = db
      .prepare("SELECT * FROM candidate_categories WHERE candidate_user_id = ?")
      .get(userId);
    if (existing) {
      db.prepare(
        `UPDATE candidate_categories SET category_id = ?, specialization = ?, grade = ?, test_score = ?,
         knowledge = ?, breadth = ?, motivation = ?, assigned_at = ?, grade_changed_at = ?
         WHERE candidate_user_id = ?`
      ).run(
        catRow.id,
        spec,
        claimedGrade,
        agg.test_score,
        agg.knowledge,
        agg.breadth,
        motivation,
        now,
        now,
        userId
      );
    } else {
      db.prepare(
        `INSERT INTO candidate_categories
         (candidate_user_id, category_id, specialization, grade, test_score, knowledge, breadth, motivation, assigned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        userId,
        catRow.id,
        spec,
        claimedGrade,
        agg.test_score,
        agg.knowledge,
        agg.breadth,
        motivation,
        now
      );
    }
    return { passed: true, message: "confirmed", label: catRow.label };
  }
  return { passed: false, message: "not_confirmed", retakeAfterDays: config.GRADE_COOLDOWN_DAYS };
}

module.exports = {
  getPublishedBatteryTasks,
  assertBatteryComplete,
  lastSpecializationAttempt,
  cooldownActive,
  scoreBatteryAttempts,
  finalizeBattery,
  WORK_DEADLINE_MS,
  BATTERY_QUICK_COUNT,
};
