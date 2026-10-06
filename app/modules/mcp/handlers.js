"use strict";

const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { httpError } = require("../../middleware/errors");
const { startBattery, submitAttempt } = require("../assessment/actions");
const {
  getEmployerNeed,
  getNextDeckCard,
  decideCandidate,
} = require("../deck/actions");
const { loadCandidatesForNeed, applyFilters } = require("../matching/pool");
const { employerCandidateView } = require("../../lib/privacy");

const ERROR_RU = {
  unauthorized: "Нужен действующий токен Authorization: Bearer hc_…",
  forbidden: "Нет доступа к этой операции",
  email_not_confirmed: "Подтвердите email в кабинете",
  invalid_body: "Проверьте аргументы инструмента",
  not_found: "Объект не найден",
  cooldown: "Пересдача по этой специализации пока недоступна (cooldown)",
  deadline_passed: "Дедлайн рабочей задачи истёк",
  battery_incomplete: "Батарея заданий не настроена на сервере",
  candidate_paused: "Кандидат на паузе — новые приглашения недоступны",
  candidate_rejected: "Кандидат уже отклонён по этой потребности",
  candidate_deferred: "Кандидат в отложенных — сначала верните в колоду",
  scope_write_required: "Для записи нужен scope write в токене",
  wrong_role: "Инструмент недоступен для вашей роли",
  rate_limited: "Слишком много запросов MCP — подождите минуту",
};

function formatToolError(err) {
  const code = err.code || err.message || "internal_error";
  const text = ERROR_RU[code] || `Ошибка: ${code}`;
  return { isError: true, text };
}

function assertRole(ctx, role) {
  if (ctx.user.role !== role) {
    const e = httpError(403, "wrong_role");
    throw e;
  }
}

function assertWrite(ctx) {
  if (!ctx.scopes.includes("write")) {
    throw httpError(403, "scope_write_required");
  }
}

function textResult(obj) {
  return {
    content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
  };
}

function whoami(ctx) {
  return textResult({
    email: ctx.user.email,
    role: ctx.user.role,
    userId: ctx.user.id,
    scopes: ctx.scopes,
  });
}

function getMyProfile(ctx) {
  assertRole(ctx, "candidate");
  const p = getDb().prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(ctx.user.id);
  return textResult({
    displayName: p.display_name,
    stack: JSON.parse(p.stack_json || "[]"),
    phone: p.phone,
    contactEmail: p.contact_email,
    availability: p.availability,
  });
}

function updateMyProfile(ctx, input) {
  assertRole(ctx, "candidate");
  assertWrite(ctx);
  const displayName = String(input.displayName ?? "").trim();
  const stack = Array.isArray(input.stack) ? input.stack : undefined;
  const phone = input.phone !== undefined ? String(input.phone).trim() : undefined;
  const contactEmail =
    input.contactEmail !== undefined ? String(input.contactEmail).trim() : undefined;
  const db = getDb();
  const p = db.prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(ctx.user.id);
  db.prepare(
    `UPDATE candidate_profiles SET display_name = ?, stack_json = ?, phone = ?, contact_email = ?
     WHERE user_id = ?`
  ).run(
    displayName || p.display_name,
    stack ? JSON.stringify(stack) : p.stack_json,
    phone ?? p.phone,
    contactEmail ?? p.contact_email,
    ctx.user.id
  );
  return textResult({ ok: true });
}

function getMyCategory(ctx) {
  assertRole(ctx, "candidate");
  const db = getDb();
  const cat = db
    .prepare(
      `SELECT cc.*, c.label FROM candidate_categories cc
       JOIN categories c ON c.id = cc.category_id WHERE cc.candidate_user_id = ?`
    )
    .get(ctx.user.id);
  if (!cat) return textResult({ label: null, retakeAt: null });
  const last = db
    .prepare(
      `SELECT MAX(b.completed_at) AS t FROM batteries b
       WHERE b.candidate_user_id = ? AND b.specialization = ?`
    )
    .get(ctx.user.id, cat.specialization);
  let retakeAt = null;
  if (last?.t) {
    const d = new Date(last.t);
    d.setDate(d.getDate() + Number(process.env.GRADE_COOLDOWN_DAYS || 90));
    retakeAt = d.toISOString();
  }
  return textResult({ label: cat.label, retakeAt });
}

function listTasks(ctx) {
  assertRole(ctx, "candidate");
  const db = getDb();
  const battery = db
    .prepare(
      `SELECT * FROM batteries WHERE candidate_user_id = ? AND completed_at IS NULL ORDER BY started_at DESC LIMIT 1`
    )
    .get(ctx.user.id);
  if (!battery) return textResult({ battery: null, tasks: [] });
  const rows = db
    .prepare(
      `SELECT a.id, a.submitted_at, t.type, t.prompt FROM attempts a
       JOIN tasks t ON t.id = a.task_id WHERE a.battery_id = ? ORDER BY a.opened_at`
    )
    .all(battery.id);
  return textResult({
    batteryId: battery.id,
    specialization: battery.specialization,
    claimedGrade: battery.claimed_grade,
    tasks: rows.map((r) => ({
      attemptId: r.id,
      type: r.type,
      submitted: Boolean(r.submitted_at),
      promptPreview: r.prompt.slice(0, 120),
    })),
  });
}

function getTask(ctx, attemptId) {
  assertRole(ctx, "candidate");
  const row = getDb()
    .prepare(
      `SELECT a.id, t.prompt, t.type FROM attempts a JOIN tasks t ON t.id = a.task_id
       WHERE a.id = ? AND a.candidate_user_id = ?`
    )
    .get(attemptId, ctx.user.id);
  if (!row) throw httpError(404, "not_found");
  return textResult({ id: row.id, type: row.type, prompt: row.prompt });
}

function startAssessment(ctx, input) {
  assertRole(ctx, "candidate");
  assertWrite(ctx);
  const result = startBattery(ctx.user.id, input.specialization, input.grade);
  return textResult(result);
}

function submitAnswer(ctx, attemptId, answerText) {
  assertRole(ctx, "candidate");
  assertWrite(ctx);
  const row = getDb()
    .prepare(
      `SELECT t.type FROM attempts a JOIN tasks t ON t.id = a.task_id WHERE a.id = ? AND a.candidate_user_id = ?`
    )
    .get(attemptId, ctx.user.id);
  if (!row) throw httpError(404, "not_found");
  if (row.type !== "quick") throw httpError(400, "invalid_body");
  const result = submitAttempt(ctx.user.id, attemptId, answerText, { source: "mcp" });
  return textResult(result);
}

function submitWorkTask(ctx, attemptId, answerText) {
  assertRole(ctx, "candidate");
  assertWrite(ctx);
  const row = getDb()
    .prepare(
      `SELECT t.type FROM attempts a JOIN tasks t ON t.id = a.task_id WHERE a.id = ? AND a.candidate_user_id = ?`
    )
    .get(attemptId, ctx.user.id);
  if (!row) throw httpError(404, "not_found");
  if (row.type !== "work") throw httpError(400, "invalid_body");
  const result = submitAttempt(ctx.user.id, attemptId, answerText, { source: "mcp" });
  return textResult(result);
}

function listInvitationsCandidate(ctx) {
  assertRole(ctx, "candidate");
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.salary_from, i.salary_to, i.offer_text, i.status, i.created_at, e.company_name
       FROM invitations i JOIN employer_profiles e ON e.user_id = i.employer_user_id
       WHERE i.candidate_user_id = ? ORDER BY i.created_at DESC`
    )
    .all(ctx.user.id);
  return textResult({ items: rows });
}

function respondInvitation(ctx, invitationId, action) {
  assertRole(ctx, "candidate");
  assertWrite(ctx);
  const db = getDb();
  const inv = db
    .prepare("SELECT * FROM invitations WHERE id = ? AND candidate_user_id = ?")
    .get(invitationId, ctx.user.id);
  if (!inv) throw httpError(404, "not_found");
  if (action === "accept") {
    db.prepare("UPDATE invitations SET status = 'accepted' WHERE id = ?").run(inv.id);
  } else if (action === "decline") {
    db.prepare("UPDATE invitations SET status = 'declined' WHERE id = ?").run(inv.id);
  } else {
    throw httpError(400, "invalid_body");
  }
  return textResult({ ok: true, status: action === "accept" ? "accepted" : "declined" });
}

function listCallsCandidate(ctx) {
  assertRole(ctx, "candidate");
  const rows = getDb()
    .prepare(
      `SELECT i.id AS invitation_id, c.id AS call_id, c.status AS call_status, e.company_name
       FROM invitations i
       JOIN employer_profiles e ON e.user_id = i.employer_user_id
       LEFT JOIN calls c ON c.invitation_id = i.id
       WHERE i.candidate_user_id = ? AND i.status = 'accepted'`
    )
    .all(ctx.user.id);
  return textResult({ items: rows });
}

function listNeeds(ctx) {
  assertRole(ctx, "employer");
  const rows = getDb()
    .prepare("SELECT * FROM employer_needs WHERE employer_user_id = ? ORDER BY title")
    .all(ctx.user.id);
  return textResult({
    items: rows.map((n) => ({
      id: n.id,
      title: n.title,
      specialization: n.specialization,
      grade: n.grade,
      active: Boolean(n.active),
    })),
  });
}

function createNeed(ctx, body) {
  assertRole(ctx, "employer");
  assertWrite(ctx);
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
    .run(id, ctx.user.id, title, specialization, grade, JSON.stringify(stack), domainText, notes);
  return textResult({ id });
}

function updateNeed(ctx, needId, body) {
  assertRole(ctx, "employer");
  assertWrite(ctx);
  const db = getDb();
  const n = getEmployerNeed(ctx.user.id, needId);
  if (!n) throw httpError(404, "not_found");
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
  return textResult({ ok: true });
}

function getNextCandidate(ctx, needId) {
  assertRole(ctx, "employer");
  return textResult(getNextDeckCard(ctx.user.id, needId, {}));
}

function decideCandidateTool(ctx, input) {
  assertRole(ctx, "employer");
  assertWrite(ctx);
  const decision = input.decision;
  const map = { reject: "reject", later: "later", invite: "invite" };
  if (!map[decision]) throw httpError(400, "invalid_body");
  const payload =
    decision === "invite"
      ? {
          salaryFrom: input.salaryFrom,
          salaryTo: input.salaryTo,
          offerText: input.offerText,
          contactChannel: input.contactChannel,
        }
      : null;
  const result = decideCandidate(
    ctx.user.id,
    input.needId,
    input.candidateId,
    decision,
    payload,
    "mcp"
  );
  return textResult(result);
}

function listShortlist(ctx, needId) {
  assertRole(ctx, "employer");
  const need = getEmployerNeed(ctx.user.id, needId);
  if (!need) throw httpError(404, "not_found");
  let items = loadCandidatesForNeed(need, ctx.user.id, { forDeck: false });
  items = applyFilters(items, {});
  return textResult({
    items: items.map((c) =>
      employerCandidateView(
        ctx.user.id,
        {
          id: c.id,
          displayName: c.displayName,
          categoryLabel: c.categoryLabel,
          stack: c.stack,
          backgroundDomains: c.backgroundDomains,
          explanation: c.explanation,
          taskPhrases: c.taskPhrases,
          integrationNote: c.integrationNote,
          phone: c.phone,
          contact_email: c.contact_email,
        },
        null
      )
    ),
  });
}

function listInvitationsEmployer(ctx) {
  assertRole(ctx, "employer");
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.status, i.salary_from, i.salary_to, cp.display_name, i.created_at
       FROM invitations i JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       WHERE i.employer_user_id = ? ORDER BY i.created_at DESC`
    )
    .all(ctx.user.id);
  return textResult({ items: rows });
}

function listCallsEmployer(ctx) {
  assertRole(ctx, "employer");
  const rows = getDb()
    .prepare(
      `SELECT i.id AS invitation_id, c.id AS call_id, c.status AS call_status, cp.display_name
       FROM invitations i
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       LEFT JOIN calls c ON c.invitation_id = i.id
       WHERE i.employer_user_id = ? AND i.status = 'accepted'`
    )
    .all(ctx.user.id);
  return textResult({ items: rows });
}

function getCallAnalysis(ctx, callId) {
  assertRole(ctx, "employer");
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(callId);
  if (!call || call.status !== "ended") throw httpError(404, "not_found");
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  if (!inv || inv.employer_user_id !== ctx.user.id) throw httpError(403, "forbidden");
  const analysis = db.prepare("SELECT summary_text FROM call_analyses WHERE call_id = ?").get(callId);
  if (!analysis) throw httpError(404, "not_found");
  return textResult({ summaryText: analysis.summary_text });
}

function readProfileResource(ctx) {
  if (ctx.user.role === "candidate") return getMyProfile(ctx);
  const p = getDb().prepare("SELECT * FROM employer_profiles WHERE user_id = ?").get(ctx.user.id);
  return textResult({
    companyName: p.company_name,
    description: p.description,
    industry: p.industry,
    contactEmail: p.contact_email,
  });
}

function readNeedResource(ctx, needId) {
  assertRole(ctx, "employer");
  const need = getEmployerNeed(ctx.user.id, needId);
  if (!need) throw httpError(404, "not_found");
  return textResult({
    id: need.id,
    title: need.title,
    specialization: need.specialization,
    grade: need.grade,
    stack: JSON.parse(need.stack_json || "[]"),
    domainText: need.domain_text,
    notes: need.notes,
    active: Boolean(need.active),
  });
}

function readTaskResource(ctx, attemptId) {
  return getTask(ctx, attemptId);
}

module.exports = {
  ERROR_RU,
  formatToolError,
  whoami,
  getMyProfile,
  updateMyProfile,
  getMyCategory,
  listTasks,
  getTask,
  startAssessment,
  submitAnswer,
  submitWorkTask,
  listInvitationsCandidate,
  respondInvitation,
  listCallsCandidate,
  listNeeds,
  createNeed,
  updateNeed,
  getNextCandidate,
  decideCandidateTool,
  listShortlist,
  listInvitationsEmployer,
  listCallsEmployer,
  getCallAnalysis,
  readProfileResource,
  readNeedResource,
  readTaskResource,
};
