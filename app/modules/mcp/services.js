"use strict";

const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { httpError } = require("../../middleware/errors");
const { employerCandidateView } = require("../../lib/privacy");
const { loadCandidatesForNeed, applyFilters, publicMatchShape } = require("../matching/pool");
const {
  getPublishedBatteryTasks,
  assertBatteryComplete,
  lastSpecializationAttempt,
  cooldownActive,
  finalizeBattery,
  WORK_DEADLINE_MS,
} = require("../assessment/service");
const { scoreQuick, scoreWork } = require("../../lib/rubric-score");

function mcpError(message, code = "invalid_request") {
  const err = new Error(message);
  err.isMcp = true;
  err.mcpCode = code;
  return err;
}

function getCandidateProfile(userId) {
  const p = getDb().prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(userId);
  if (!p) throw mcpError("Профиль кандидата не найден", "not_found");
  return {
    displayName: p.display_name,
    stack: JSON.parse(p.stack_json || "[]"),
    phone: p.phone,
    contactEmail: p.contact_email,
    availability: p.availability,
  };
}

function updateCandidateProfile(userId, body) {
  const displayName = String(body.displayName ?? body.display_name ?? "").trim();
  const stack = Array.isArray(body.stack) ? body.stack : [];
  const phone = String(body.phone ?? "").trim();
  const contactEmail = String(body.contactEmail ?? body.contact_email ?? "").trim();
  const availability = body.availability;
  getDb()
    .prepare(
      `UPDATE candidate_profiles SET display_name = ?, stack_json = ?, phone = ?, contact_email = ?
       WHERE user_id = ?`
    )
    .run(displayName, JSON.stringify(stack), phone, contactEmail, userId);
  if (availability && ["open", "paused"].includes(availability)) {
    getDb()
      .prepare("UPDATE candidate_profiles SET availability = ? WHERE user_id = ?")
      .run(availability, userId);
  }
  return getCandidateProfile(userId);
}

function getCandidateCategory(userId) {
  const db = getDb();
  const cat = db
    .prepare(
      `SELECT cc.*, c.label FROM candidate_categories cc
       JOIN categories c ON c.id = cc.category_id WHERE cc.candidate_user_id = ?`
    )
    .get(userId);
  if (!cat) return { label: null, retakeAt: null };
  const last = db
    .prepare(
      `SELECT MAX(b.completed_at) AS t FROM batteries b
       WHERE b.candidate_user_id = ? AND b.specialization = ?`
    )
    .get(userId, cat.specialization);
  let retakeAt = null;
  if (last?.t) {
    const d = new Date(last.t);
    d.setDate(d.getDate() + Number(process.env.GRADE_COOLDOWN_DAYS || 90));
    retakeAt = d.toISOString();
  }
  return { label: cat.label, specialization: cat.specialization, grade: cat.grade, retakeAt };
}

function listAssessmentTasks(userId) {
  const db = getDb();
  const battery = db
    .prepare(
      `SELECT * FROM batteries WHERE candidate_user_id = ? AND completed_at IS NULL ORDER BY started_at DESC LIMIT 1`
    )
    .get(userId);
  if (!battery) return { battery: null, tasks: [] };
  const attempts = db
    .prepare(
      `SELECT a.id, a.submitted_at, t.type, t.prompt FROM attempts a
       JOIN tasks t ON t.id = a.task_id WHERE a.battery_id = ? ORDER BY a.opened_at`
    )
    .all(battery.id);
  return {
    battery: {
      id: battery.id,
      specialization: battery.specialization,
      claimedGrade: battery.claimed_grade,
      formKey: battery.form_key,
    },
    tasks: attempts.map((a) => ({
      attemptId: a.id,
      type: a.type,
      prompt: a.prompt,
      submitted: Boolean(a.submitted_at),
    })),
  };
}

function getAssessmentTask(userId, attemptId) {
  const row = getDb()
    .prepare(
      `SELECT a.id, a.battery_id, t.prompt, t.type FROM attempts a JOIN tasks t ON t.id = a.task_id
       WHERE a.id = ? AND a.candidate_user_id = ?`
    )
    .get(attemptId, userId);
  if (!row) throw mcpError("Задание не найдено", "not_found");
  return { id: row.id, prompt: row.prompt, type: row.type, batteryId: row.battery_id };
}

function startAssessment(userId, specialization, grade, actionSource = "web") {
  const db = getDb();
  const last = lastSpecializationAttempt(userId, specialization);
  if (cooldownActive(last?.completed_at)) {
    throw mcpError("Повторная попытка по этой специализации пока недоступна", "cooldown");
  }
  const formKey = Math.random() < 0.5 ? "A" : "B";
  const { quick, work } = getPublishedBatteryTasks(specialization, grade, formKey);
  try {
    assertBatteryComplete(quick, work);
  } catch {
    throw mcpError("Батарея заданий для выбранной категории не готова", "battery_incomplete");
  }
  const batteryId = newId();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO batteries (id, candidate_user_id, specialization, claimed_grade, form_key, started_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(batteryId, userId, specialization, grade, formKey, now);
  const ins = db.prepare(
    `INSERT INTO attempts (id, candidate_user_id, task_id, battery_id, form_key, opened_at, action_source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of [...quick, work]) {
    const attemptId = newId();
    ins.run(attemptId, userId, t.id, batteryId, formKey, now, actionSource);
    db.prepare(
      `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'opened_at', NULL)`
    ).run(attemptId);
  }
  return listAssessmentTasks(userId);
}

function submitAttemptAnswer(userId, attemptId, answerText, actionSource = "web") {
  const db = getDb();
  const a = db
    .prepare(
      `SELECT a.*, t.type, t.rubric_json, b.claimed_grade, b.id AS battery_id
       FROM attempts a JOIN tasks t ON t.id = a.task_id JOIN batteries b ON b.id = a.battery_id
       WHERE a.id = ? AND a.candidate_user_id = ?`
    )
    .get(attemptId, userId);
  if (!a) throw mcpError("Задание не найдено", "not_found");
  if (a.submitted_at) throw mcpError("Ответ уже отправлен", "already_submitted");
  if (a.type === "work") {
    const opened = new Date(a.opened_at).getTime();
    if (Date.now() > opened + WORK_DEADLINE_MS) {
      throw mcpError("Время на рабочее задание истекло", "deadline_passed");
    }
  }
  const text = String(answerText || "");
  const rubric = JSON.parse(a.rubric_json);
  const scores = a.type === "quick" ? scoreQuick(text, rubric) : scoreWork(text, rubric);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE attempts SET answer_text = ?, knowledge = ?, breadth = ?, submitted_at = ?, action_source = ? WHERE id = ?`
  ).run(text, scores.knowledge, scores.breadth, now, actionSource, a.id);
  db.prepare(
    `INSERT INTO attempt_events (attempt_id, event_type, payload_json) VALUES (?, 'submit', ?)`
  ).run(a.id, JSON.stringify({ length: text.length, source: actionSource }));

  const pending = db
    .prepare(`SELECT COUNT(*) AS c FROM attempts WHERE battery_id = ? AND submitted_at IS NULL`)
    .get(a.battery_id).c;
  if (pending === 0) {
    const result = finalizeBattery(a.battery_id, userId, a.claimed_grade);
    return { batteryComplete: true, category: getCandidateCategory(userId), pass: result.passed };
  }
  return { batteryComplete: false };
}

function listCandidateInvitations(userId) {
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.salary_from, i.salary_to, i.offer_text, i.status, i.created_at, e.company_name
       FROM invitations i JOIN employer_profiles e ON e.user_id = i.employer_user_id
       WHERE i.candidate_user_id = ? ORDER BY i.created_at DESC`
    )
    .all(userId);
  return rows.map((r) => ({
    id: r.id,
    salaryFrom: r.salary_from,
    salaryTo: r.salary_to,
    offerText: r.offer_text,
    status: r.status,
    companyName: r.company_name,
    createdAt: r.created_at,
  }));
}

function respondInvitation(userId, invitationId, decision) {
  const db = getDb();
  const inv = db
    .prepare("SELECT * FROM invitations WHERE id = ? AND candidate_user_id = ?")
    .get(invitationId, userId);
  if (!inv) throw mcpError("Приглашение не найдено", "not_found");
  if (!["accept", "decline"].includes(decision)) {
    throw mcpError("Укажите decision: accept или decline");
  }
  const status = decision === "accept" ? "accepted" : "declined";
  db.prepare("UPDATE invitations SET status = ? WHERE id = ?").run(status, inv.id);
  return { ok: true, status };
}

function listCandidateCalls(userId) {
  const rows = getDb()
    .prepare(
      `SELECT i.id AS invitation_id, i.salary_from, i.salary_to, c.status AS call_status,
              c.started_at, c.ended_at, e.company_name, n.title AS need_title
       FROM invitations i
       JOIN employer_profiles e ON e.user_id = i.employer_user_id
       JOIN employer_needs n ON n.id = i.need_id
       LEFT JOIN calls c ON c.invitation_id = i.id
       WHERE i.candidate_user_id = ? AND i.status = 'accepted'
       ORDER BY COALESCE(c.ended_at, c.started_at, i.created_at) DESC`
    )
    .all(userId);
  return rows.map((r) => ({
    invitationId: r.invitation_id,
    callStatus: r.call_status || "ready",
    salaryFrom: r.salary_from,
    salaryTo: r.salary_to,
    companyName: r.company_name,
    needTitle: r.need_title,
    roomUrl: `/call/${r.invitation_id}`,
  }));
}

function listEmployerNeeds(userId) {
  const rows = getDb()
    .prepare("SELECT * FROM employer_needs WHERE employer_user_id = ? ORDER BY title")
    .all(userId);
  return rows.map((n) => ({
    id: n.id,
    title: n.title,
    specialization: n.specialization,
    grade: n.grade,
    stack: JSON.parse(n.stack_json || "[]"),
    domainText: n.domain_text,
    notes: n.notes,
    active: Boolean(n.active),
  }));
}

function createEmployerNeed(userId, body) {
  const id = newId();
  const {
    title = "",
    specialization = "backend",
    grade = "middle",
    stack = [],
    domainText = "",
    notes = "",
  } = body || {};
  getDb()
    .prepare(
      `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, userId, title, specialization, grade, JSON.stringify(stack), domainText, notes);
  return { id };
}

function updateEmployerNeed(userId, needId, body) {
  const db = getDb();
  const n = db
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(needId, userId);
  if (!n) throw mcpError("Потребность не найдена", "not_found");
  db.prepare(
    `UPDATE employer_needs SET title = ?, specialization = ?, grade = ?, stack_json = ?, domain_text = ?, notes = ?, active = ?
     WHERE id = ?`
  ).run(
    body.title ?? n.title,
    body.specialization ?? n.specialization,
    body.grade ?? n.grade,
    JSON.stringify(body.stack ?? JSON.parse(n.stack_json)),
    body.domainText ?? n.domain_text,
    body.notes ?? n.notes,
    body.active === undefined ? n.active : body.active ? 1 : 0,
    n.id
  );
  return { ok: true };
}

function getDeckNext(userId, needId, filters = {}) {
  const need = getDb()
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(needId, userId);
  if (!need) throw mcpError("Потребность не найдена", "not_found");
  let items = loadCandidatesForNeed(need, userId, { forDeck: true });
  items = applyFilters(items, filters);
  if (!items.length) return { card: null, candidateId: null };
  const c = items[0];
  const card = employerCandidateView(
    userId,
    {
      id: c.id,
      displayName: c.displayName,
      categoryLabel: c.categoryLabel,
      stack: c.stack,
      backgroundDomains: c.backgroundDomains,
      explanation: c.explanation.slice(0, 2),
      taskPhrases: c.taskPhrases,
      phone: c.phone,
      contact_email: c.contact_email,
    },
    null
  );
  return { card, candidateId: c.id };
}

function decideCandidate(userId, needId, payload, actionSource = "web") {
  const db = getDb();
  const need = db
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(needId, userId);
  if (!need) throw mcpError("Потребность не найдена", "not_found");
  const decision = payload.decision;
  const candidateId = payload.candidateId;
  if (!candidateId) throw mcpError("Укажите candidateId");

  if (decision === "reject" || decision === "later") {
    const mapped = decision === "reject" ? "rejected" : "later";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO need_reviews (id, employer_user_id, need_id, candidate_user_id, decision, updated_at, action_source)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(employer_user_id, need_id, candidate_user_id)
       DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at, action_source = excluded.action_source`
    ).run(newId(), userId, need.id, candidateId, mapped, now, actionSource);
    return { ok: true, decision: mapped };
  }

  if (decision === "invite") {
    const from = Number(payload.salaryFrom);
    const to = Number(payload.salaryTo);
    const offer = String(payload.offerText || "").trim();
    const channel = String(payload.contactChannel || "email").trim();
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to || !offer) {
      throw mcpError("Для приглашения нужны salaryFrom, salaryTo и offerText");
    }
    const avail = db.prepare("SELECT availability FROM candidate_profiles WHERE user_id = ?").get(candidateId);
    if (avail?.availability === "paused") throw mcpError("Кандидат на паузе", "candidate_paused");
    const id = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status, action_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?)`
    ).run(id, userId, needId, candidateId, from, to, offer, channel, actionSource);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO need_reviews (id, employer_user_id, need_id, candidate_user_id, decision, updated_at, action_source)
       VALUES (?, ?, ?, ?, 'invited', ?, ?)
       ON CONFLICT(employer_user_id, need_id, candidate_user_id)
       DO UPDATE SET decision = 'invited', updated_at = excluded.updated_at, action_source = excluded.action_source`
    ).run(newId(), userId, needId, candidateId, now, actionSource);
    return { ok: true, invitationId: id };
  }
  throw mcpError("decision должен быть reject, later или invite");
}

function listShortlist(userId, needId, filters = {}) {
  const need = getDb()
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(needId, userId);
  if (!need) throw mcpError("Потребность не найдена", "not_found");
  let items = loadCandidatesForNeed(need, userId);
  items = applyFilters(items, filters);
  return items.map(publicMatchShape);
}

function listEmployerInvitations(userId) {
  const rows = getDb()
    .prepare(
      `SELECT i.*, cp.display_name FROM invitations i
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       WHERE i.employer_user_id = ? ORDER BY i.created_at DESC`
    )
    .all(userId);
  return rows.map((r) => ({
    id: r.id,
    candidateId: r.candidate_user_id,
    candidateName: r.display_name,
    salaryFrom: r.salary_from,
    salaryTo: r.salary_to,
    status: r.status,
    viaAiClient: r.action_source === "mcp",
    createdAt: r.created_at,
  }));
}

function listEmployerCalls(userId) {
  const rows = getDb()
    .prepare(
      `SELECT i.id AS invitation_id, i.created_at AS invitation_at, cp.display_name,
              c.id AS call_id, c.status AS call_status, c.ended_at, n.title AS need_title
       FROM invitations i
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       JOIN employer_needs n ON n.id = i.need_id
       LEFT JOIN calls c ON c.invitation_id = i.id
       WHERE i.employer_user_id = ? AND i.status = 'accepted'
       ORDER BY COALESCE(c.ended_at, i.created_at) DESC`
    )
    .all(userId);
  return rows.map((r) => ({
    invitationId: r.invitation_id,
    callId: r.call_id,
    callStatus: r.call_status || "ready",
    candidateName: r.display_name,
    needTitle: r.need_title,
  }));
}

function getCallAnalysis(userId, callId) {
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(callId);
  if (!call || call.status !== "ended") throw mcpError("Разбор звонка ещё не готов", "not_ready");
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  if (inv.employer_user_id !== userId) throw mcpError("Нет доступа", "forbidden");
  const a = db.prepare("SELECT summary_text FROM call_analyses WHERE call_id = ?").get(call.id);
  if (!a) throw mcpError("Разбор звонка ещё не готов", "not_ready");
  return { summaryText: a.summary_text };
}

function getNeedResource(userId, role, needId) {
  const row = getDb()
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(needId, userId);
  if (!row) throw mcpError("Потребность не найдена", "not_found");
  return {
    id: row.id,
    title: row.title,
    specialization: row.specialization,
    grade: row.grade,
    domainText: row.domain_text,
    active: Boolean(row.active),
  };
}

module.exports = {
  mcpError,
  getCandidateProfile,
  updateCandidateProfile,
  getCandidateCategory,
  listAssessmentTasks,
  getAssessmentTask,
  startAssessment,
  submitAttemptAnswer,
  listCandidateInvitations,
  respondInvitation,
  listCandidateCalls,
  listEmployerNeeds,
  createEmployerNeed,
  updateEmployerNeed,
  getDeckNext,
  decideCandidate,
  listShortlist,
  listEmployerInvitations,
  listEmployerCalls,
  getCallAnalysis,
  getNeedResource,
};
