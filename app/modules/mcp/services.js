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
const { createInvitation, respondToInvitation } = require("../invitations/actions");
const { summarizeAiUsageForEmployer } = require("../../lib/ai-usage-summary");
const { loadAttemptForSubmit, assertAttemptMutable } = require("../../lib/assessment-guards");
const {
  validateDisplayName,
  validateOptionalEmail,
  validateOptionalPhone,
} = require("../../lib/validation");
const { validateNeedBody } = require("../../lib/need-validation");
const { validateAnswerText } = require("../../lib/assessment-answer");
const { dbDateToIso } = require("../../lib/db-datetime");

function mcpError(message, code = "invalid_request") {
  const err = new Error(message);
  err.isMcp = true;
  err.mcpCode = code;
  return err;
}

function httpErrToMcp(err) {
  if (!err || !err.status) throw err;
  const fields = err.details?.fields;
  if (fields?.salaryRange) throw mcpError(fields.salaryRange, err.code || "invalid_body");
  const map = {
    not_found: "Не найдено",
    invitation_duplicate: "Приглашение уже отправлено — дождитесь ответа кандидата",
    invitation_final: "Ответ на приглашение уже зафиксирован",
    candidate_paused: "Кандидат на паузе — новые приглашения не отправляются",
    candidate_rejected: "Кандидат отклонён по этой потребности",
    candidate_deferred: "Кандидат в отложенных",
    candidate_not_in_pool: "Кандидат не подходит под эту потребность",
  };
  throw mcpError(map[err.code] || err.message || "Ошибка запроса", err.code || "invalid_request");
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
  const db = getDb();
  const existing = db.prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(userId);
  if (!existing) throw mcpError("Профиль кандидата не найден", "not_found");
  const fields = {};
  let displayName = existing.display_name;
  if (body.displayName !== undefined || body.display_name !== undefined) {
    const v = validateDisplayName(body.displayName ?? body.display_name);
    Object.assign(fields, v.fields);
    if (!v.fields.displayName) displayName = v.displayName;
  }
  const stack = Array.isArray(body.stack) ? body.stack : JSON.parse(existing.stack_json || "[]");
  let phone = existing.phone || "";
  if (body.phone !== undefined) {
    const v = validateOptionalPhone(body.phone);
    Object.assign(fields, v.fields);
    if (!v.fields.phone) phone = v.phone;
  }
  let contactEmail = existing.contact_email || "";
  if (body.contactEmail !== undefined || body.contact_email !== undefined) {
    const v = validateOptionalEmail(body.contactEmail ?? body.contact_email);
    Object.assign(fields, v.fields);
    if (!v.fields.contactEmail) contactEmail = v.value;
  }
  if (Object.keys(fields).length) {
    throw mcpError(Object.values(fields)[0], "invalid_body");
  }
  const availability = body.availability;
  db.prepare(
    `UPDATE candidate_profiles SET display_name = ?, stack_json = ?, phone = ?, contact_email = ?
     WHERE user_id = ?`
  ).run(displayName, JSON.stringify(stack), phone, contactEmail, userId);
  if (availability && ["open", "paused"].includes(availability)) {
    db.prepare("UPDATE candidate_profiles SET availability = ? WHERE user_id = ?").run(availability, userId);
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

function submitAttemptAnswer(userId, attemptId, answerText, actionSource = "web", options = {}) {
  const db = getDb();
  let a;
  try {
    a = loadAttemptForSubmit(attemptId, userId);
    assertAttemptMutable(a);
  } catch (e) {
    if (e.status === 409) throw mcpError("Ответ уже отправлен", "already_submitted");
    if (e.status === 404) throw mcpError("Задание не найдено", "not_found");
    throw e;
  }
  if (options.requireQuick && a.type !== "quick") {
    throw mcpError("Для рабочего задания используйте submit_work_task", "invalid_body");
  }
  if (options.requireWork && a.type !== "work") {
    throw mcpError("Для короткого задания используйте submit_answer", "invalid_body");
  }
  if (a.type === "work") {
    const opened = new Date(a.opened_at).getTime();
    if (Date.now() > opened + WORK_DEADLINE_MS) {
      throw mcpError("Время на рабочее задание истекло", "deadline_passed");
    }
  }
  const parsed = validateAnswerText(answerText, a.type);
  if (!parsed.ok) throw mcpError(parsed.fields.answerText, "invalid_body");
  const text = parsed.value;
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
    createdAt: dbDateToIso(r.created_at),
  }));
}

function respondInvitation(userId, invitationId, decision) {
  const d = String(decision || "").trim().toLowerCase();
  if (!["accept", "decline"].includes(d)) {
    throw mcpError("Решение должно быть accept или decline", "invalid_body");
  }
  try {
    return respondToInvitation(userId, invitationId, d === "accept" ? "accept" : "decline", "mcp");
  } catch (e) {
    httpErrToMcp(e);
  }
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
  const parsed = validateNeedBody(body || {}, { requireTitle: true });
  if (!parsed.ok) {
    const msg = Object.values(parsed.fields)[0] || "Некорректные данные потребности";
    throw mcpError(msg, "invalid_body");
  }
  const id = newId();
  const v = parsed.value;
  getDb()
    .prepare(
      `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, notes, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      id,
      userId,
      v.title,
      v.specialization || "backend",
      v.grade || "middle",
      JSON.stringify(v.stack || []),
      v.domainText || "",
      v.notes || ""
    );
  return { id };
}

function updateEmployerNeed(userId, needId, body) {
  const db = getDb();
  const n = db
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(needId, userId);
  if (!n) throw mcpError("Потребность не найдена", "not_found");
  const merged = {
    title: body?.title ?? n.title,
    specialization: body?.specialization ?? n.specialization,
    grade: body?.grade ?? n.grade,
    stack: body?.stack !== undefined ? body.stack : JSON.parse(n.stack_json || "[]"),
    domainText: body?.domainText ?? n.domain_text,
    notes: body?.notes ?? n.notes,
    active: body?.active,
  };
  const parsed = validateNeedBody(merged, { requireTitle: true });
  if (!parsed.ok) {
    const msg = Object.values(parsed.fields)[0] || "Некорректные данные потребности";
    throw mcpError(msg, "invalid_body");
  }
  const v = parsed.value;
  db.prepare(
    `UPDATE employer_needs SET title = ?, specialization = ?, grade = ?, stack_json = ?, domain_text = ?, notes = ?, active = ?
     WHERE id = ?`
  ).run(
    v.title,
    v.specialization,
    v.grade,
    JSON.stringify(v.stack || []),
    v.domainText || "",
    v.notes || "",
    v.active === undefined ? n.active : v.active ? 1 : 0,
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
      integrationNote: c.integrationNote,
      aiUsage: summarizeAiUsageForEmployer(userId, c.id),
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
  const decision = String(payload.decision || "").trim().toLowerCase();
  const candidateId = payload.candidateId;
  if (!candidateId) throw mcpError("Укажите candidateId");
  if (!["reject", "later", "invite"].includes(decision)) {
    throw mcpError("Решение должно быть reject, later или invite", "invalid_body");
  }

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
    try {
      const result = createInvitation(
        userId,
        {
          needId,
          candidateId,
          salaryFrom: payload.salaryFrom,
          salaryTo: payload.salaryTo,
          offerText: payload.offerText,
          contactChannel: payload.contactChannel || "email",
        },
        actionSource
      );
      return { ok: true, invitationId: result.id };
    } catch (e) {
      httpErrToMcp(e);
    }
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
    createdAt: dbDateToIso(r.created_at),
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
