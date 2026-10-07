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
} = require("../assessment/service");
const { submitAttemptAnswer: coreSubmitAttemptAnswer } = require("../../lib/assessment-submit");
const {
  openAttemptTimer,
  deadlineAtIso,
  getCurrentAttemptId,
  remainingMsUntilDeadline,
} = require("../../lib/assessment-timing");
const { createInvitation, respondToInvitation } = require("../invitations/actions");
const { summarizeAiUsageForEmployer } = require("../../lib/ai-usage-summary");
const { loadAttemptForSubmit, assertAttemptMutable } = require("../../lib/assessment-guards");
const {
  validateDisplayName,
  validateOptionalEmail,
  validateOptionalPhone,
} = require("../../lib/validation");
const { validateNeedBody, employerNeedTitleTaken } = require("../../lib/need-validation");
const { validateAnswerText } = require("../../lib/assessment-answer");
const { dbDateToIso } = require("../../lib/db-datetime");
const { publicCandidateDisplayName, sanitizeStoredDisplayName } = require("../../lib/public-candidate-name");
const { listPlayableRecordingSides } = require("../../lib/call-recording");

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
    candidate_deferred: "Кандидат в отложенных — верните его в подбор",
    candidate_not_in_pool: "Кандидат не подходит под эту потребность",
    need_inactive: "Потребность неактивна — новые приглашения отправить нельзя",
  };
  throw mcpError(map[err.code] || err.message || "Ошибка запроса", err.code || "invalid_request");
}

function getCandidateProfile(userId) {
  const db = getDb();
  const p = db.prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(userId);
  if (!p) throw mcpError("Профиль кандидата не найден", "not_found");
  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(userId);
  return {
    displayName: sanitizeStoredDisplayName(p.display_name, user?.email),
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
    d.setDate(d.getDate() + Number(process.env.GRADE_COOLDOWN_DAYS || 30));
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
      `SELECT a.id, a.submitted_at, a.opened_at, t.type, t.prompt FROM attempts a
       JOIN tasks t ON t.id = a.task_id WHERE a.battery_id = ? ORDER BY a.rowid`
    )
    .all(battery.id);
  const currentId = getCurrentAttemptId(db, battery.id);
  return {
    battery: {
      id: battery.id,
      specialization: battery.specialization,
      claimedGrade: battery.claimed_grade,
      formKey: battery.form_key,
      quickLimitSeconds: 60,
      workDeadlineDays: 7,
    },
    tasks: attempts.map((a) => {
      const isCurrent = a.id === currentId;
      const revealPrompt = Boolean(a.submitted_at) || Boolean(a.opened_at);
      return {
        attemptId: a.id,
        type: a.type,
        prompt: revealPrompt ? a.prompt : isCurrent ? null : undefined,
        needsOpen: isCurrent && !a.submitted_at && !a.opened_at,
        submitted: Boolean(a.submitted_at),
        openedAt: a.opened_at || null,
      };
    }),
  };
}

function getAssessmentTask(userId, attemptId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT a.id, a.battery_id, a.answer_text, a.submitted_at, a.opened_at, t.prompt, t.type FROM attempts a JOIN tasks t ON t.id = a.task_id
       WHERE a.id = ? AND a.candidate_user_id = ?`
    )
    .get(attemptId, userId);
  if (!row) throw mcpError("Задание не найдено", "not_found");
  let openedAt = row.opened_at;
  if (!row.submitted_at) {
    try {
      const started = openAttemptTimer(db, userId, row.id);
      openedAt = started.opened_at || started.started_at;
    } catch (e) {
      if (e.code === "not_current_task") {
        throw mcpError("Сначала завершите предыдущий шаг теста", "not_current_task");
      }
      throw e;
    }
  }
  const deadlineAt = openedAt ? deadlineAtIso(openedAt, row.type) : null;
  const serverNow = new Date().toISOString();
  const out = {
    id: row.id,
    prompt: row.prompt,
    type: row.type,
    batteryId: row.battery_id,
    openedAt,
    deadlineAt,
    serverNow: openedAt ? serverNow : undefined,
    remainingMs: deadlineAt ? remainingMsUntilDeadline(deadlineAt) : undefined,
    quickLimitSeconds: row.type === "quick" ? 60 : undefined,
  };
  if (!row.submitted_at) {
    out.draftText = String(row.answer_text || "");
  }
  return out;
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
     VALUES (?, ?, ?, ?, ?, NULL, ?)`
  );
  for (const t of [...quick, work]) {
    const attemptId = newId();
    ins.run(attemptId, userId, t.id, batteryId, formKey, actionSource);
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
  try {
    const result = coreSubmitAttemptAnswer(db, userId, a, answerText, { actionSource });
    if (result.batteryComplete) {
      return {
        batteryComplete: true,
        category: getCandidateCategory(userId),
        pass: result.passed,
        timedOut: false,
      };
    }
    return { batteryComplete: false, timedOut: false };
  } catch (e) {
    if (e.code === "quick_time_expired") {
      throw mcpError(
        e.details?.message || "Время на короткий ответ истекло (лимит — одна минута)",
        "quick_time_expired"
      );
    }
    if (e.code === "deadline_passed") {
      throw mcpError(e.details?.message || "Срок на мини-проект истёк", "deadline_passed");
    }
    if (e.code === "invalid_body") throw mcpError(e.details?.fields?.answerText || "Некорректный ответ", "invalid_body");
    if (e.code === "not_current_task") {
      throw mcpError("Сначала завершите предыдущий шаг теста", "not_current_task");
    }
    if (e.code === "task_not_opened") {
      throw mcpError("Сначала откройте вопрос (get_task)", "task_not_opened");
    }
    throw e;
  }
}

function listCandidateInvitations(userId) {
  const { formatSpecGradeLabel } = require("../../lib/category-labels");
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.salary_from, i.salary_to, i.offer_text, i.contact_channel, i.status, i.created_at,
              e.company_name, n.title AS need_title, n.specialization, n.grade, c.status AS call_status
       FROM invitations i
       JOIN employer_profiles e ON e.user_id = i.employer_user_id
       JOIN employer_needs n ON n.id = i.need_id
       LEFT JOIN calls c ON c.invitation_id = i.id
       WHERE i.candidate_user_id = ? ORDER BY i.created_at DESC`
    )
    .all(userId);
  return rows.map((r) => ({
    id: r.id,
    salaryFrom: r.salary_from,
    salaryTo: r.salary_to,
    offerText: r.offer_text,
    contactChannel: r.contact_channel,
    status: r.status,
    companyName: r.company_name,
    needTitle: r.need_title,
    needCategory: formatSpecGradeLabel(r.specialization, r.grade),
    callStatus: r.call_status || null,
    createdAt: dbDateToIso(r.created_at),
  }));
}

function respondInvitation(userId, invitationId, decision) {
  const d = String(decision || "").trim().toLowerCase();
  if (!["accept", "decline"].includes(d)) {
    throw mcpError(
      "Решение: accept (принять) или decline (отклонить)",
      "invalid_body"
    );
  }
  try {
    return respondToInvitation(userId, invitationId, d === "accept" ? "accept" : "decline", "mcp");
  } catch (e) {
    httpErrToMcp(e);
  }
}

function callRecordingSidesFromPath(recordingPath) {
  return listPlayableRecordingSides(recordingPath);
}

function listCandidateCalls(userId) {
  const rows = getDb()
    .prepare(
      `SELECT i.id AS invitation_id, i.created_at AS invitation_at, i.salary_from, i.salary_to,
              c.id AS call_id, c.status AS call_status, c.started_at, c.ended_at, c.recording_path,
              e.company_name, n.title AS need_title
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
    callId: r.call_id,
    invitationAt: dbDateToIso(r.invitation_at),
    callStatus: r.call_status || "ready",
    startedAt: dbDateToIso(r.started_at),
    endedAt: dbDateToIso(r.ended_at),
    salaryFrom: r.salary_from,
    salaryTo: r.salary_to,
    companyName: r.company_name,
    needTitle: r.need_title,
    recordingSides: callRecordingSidesFromPath(r.recording_path),
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
  const db = getDb();
  const v = parsed.value;
  if (employerNeedTitleTaken(db, userId, v.title)) {
    throw mcpError("Потребность с таким названием уже есть", "need_duplicate_title");
  }
  const id = newId();
  const activeFlag = v.active === undefined ? 1 : v.active ? 1 : 0;
  db
    .prepare(
      `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, notes, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      userId,
      v.title,
      v.specialization || "backend",
      v.grade || "middle",
      JSON.stringify(v.stack || []),
      v.domainText || "",
      v.notes || "",
      activeFlag
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
  if (employerNeedTitleTaken(db, userId, v.title, n.id)) {
    throw mcpError("Потребность с таким названием уже есть", "need_duplicate_title");
  }
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
      categoryStatus: c.categoryStatus,
      gradeRelation: c.gradeRelation,
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
    throw mcpError(
      "Решение: reject (отклонить), later (отложить) или invite (пригласить)",
      "invalid_body"
    );
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
  throw mcpError(
    "Решение: reject (отклонить), later (отложить) или invite (пригласить)",
    "invalid_body"
  );
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
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT i.*, cp.display_name, cp.phone, cp.contact_email, n.title AS need_title, u.email AS candidate_email,
              c.status AS call_status
       FROM invitations i
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       JOIN users u ON u.id = i.candidate_user_id
       JOIN employer_needs n ON n.id = i.need_id
       LEFT JOIN calls c ON c.invitation_id = i.id
       WHERE i.employer_user_id = ? ORDER BY i.created_at DESC`
    )
    .all(userId);
  return rows.map((r) => {
    const item = {
      id: r.id,
      candidateId: r.candidate_user_id,
      candidateName: publicCandidateDisplayName(r.display_name, r.candidate_email),
      needTitle: r.need_title,
      callStatus: r.call_status || null,
      salaryFrom: r.salary_from,
      salaryTo: r.salary_to,
      status: r.status,
      offerText: r.offer_text,
      contactChannel: r.contact_channel,
      viaAiClient: r.action_source === "mcp",
      createdAt: dbDateToIso(r.created_at),
    };
    if (r.status === "accepted") {
      item.candidatePhone = r.phone;
      item.candidateContactEmail = r.contact_email;
    }
    const hadPriorDecline = Boolean(
      db
        .prepare(
          `SELECT 1 FROM invitations i2
             WHERE i2.employer_user_id = ? AND i2.need_id = ? AND i2.candidate_user_id = ?
               AND i2.status = 'declined' AND i2.created_at < ? LIMIT 1`
        )
        .get(userId, r.need_id, r.candidate_user_id, r.created_at)
    );
    item.hadPriorDecline = hadPriorDecline;
    return item;
  });
}

function listEmployerCalls(userId) {
  const rows = getDb()
    .prepare(
      `SELECT i.id AS invitation_id, i.created_at AS invitation_at, i.candidate_user_id, cp.display_name, u.email AS candidate_email,
              i.salary_from, i.salary_to,
              c.id AS call_id, c.status AS call_status, c.started_at, c.ended_at, n.title AS need_title,
              c.recording_path
       FROM invitations i
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       JOIN users u ON u.id = i.candidate_user_id
       JOIN employer_needs n ON n.id = i.need_id
       LEFT JOIN calls c ON c.invitation_id = i.id
       WHERE i.employer_user_id = ? AND i.status = 'accepted'
       ORDER BY COALESCE(c.ended_at, c.started_at, i.created_at) DESC`
    )
    .all(userId);
  return rows.map((r) => {
    const sides = callRecordingSidesFromPath(r.recording_path);
    return {
      invitationId: r.invitation_id,
      candidateId: r.candidate_user_id,
      invitationAt: dbDateToIso(r.invitation_at),
      callId: r.call_id,
      callStatus: r.call_status || "ready",
      startedAt: dbDateToIso(r.started_at),
      endedAt: dbDateToIso(r.ended_at),
      candidateName: publicCandidateDisplayName(r.display_name, r.candidate_email),
      needTitle: r.need_title,
      salaryFrom: r.salary_from,
      salaryTo: r.salary_to,
      hasRecording: sides.length > 0,
      recordingSides: sides,
      recordingUrl:
        r.call_id && sides.includes("employer")
          ? `/api/calls/${r.call_id}/recording?side=employer`
          : null,
      roomUrl: `/call/${r.invitation_id}`,
      analysisUrl: r.call_id ? `/api/calls/${r.call_id}/analysis` : null,
    };
  });
}

function getCallAnalysis(userId, callId) {
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(callId);
  if (!call) throw mcpError("Звонок не найден", "not_found");
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  if (!inv || inv.employer_user_id !== userId) throw mcpError("Звонок не найден", "not_found");
  if (call.status !== "ended") throw mcpError("Разбор звонка ещё не готов", "not_ready");
  const a = db.prepare("SELECT summary_text FROM call_analyses WHERE call_id = ?").get(call.id);
  if (!a) throw mcpError("Разбор звонка ещё не готов", "not_ready");
  const aiUsage = summarizeAiUsageForEmployer(userId, inv.candidate_user_id);
  const sides = callRecordingSidesFromPath(call.recording_path);
  return {
    summaryText: a.summary_text,
    aiUsage,
    recordingSides: sides,
    recordingUrls: sides.reduce((acc, side) => {
      acc[side] = `/api/calls/${call.id}/recording?side=${side}`;
      return acc;
    }, {}),
  };
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
