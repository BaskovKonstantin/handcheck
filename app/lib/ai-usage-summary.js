"use strict";

const { getDb } = require("../db");

const ASSESSMENT_TOOLS = new Set([
  "start_assessment",
  "submit_answer",
  "submit_work_task",
  "get_task",
  "list_tasks",
]);

function employerHasInvitation(employerUserId, candidateUserId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT 1 FROM invitations
       WHERE employer_user_id = ? AND candidate_user_id = ?
         AND status IN ('sent', 'accepted', 'viewed', 'declined')
       LIMIT 1`
    )
    .get(employerUserId, candidateUserId);
  return Boolean(row);
}

function employerSeesCandidateInPool(employerUserId, candidateUserId) {
  const db = getDb();
  const employerIsTest = Boolean(
    db.prepare("SELECT is_test FROM users WHERE id = ?").get(employerUserId)?.is_test
  );
  const candidate = db
    .prepare(
      `SELECT u.is_test, cp.availability, priv.trust_ok, cc.specialization, cc.grade
       FROM users u
       JOIN candidate_profiles cp ON cp.user_id = u.id
       JOIN candidate_private priv ON priv.candidate_user_id = u.id
       JOIN candidate_categories cc ON cc.candidate_user_id = u.id
       WHERE u.id = ?`
    )
    .get(candidateUserId);
  if (!candidate || candidate.availability !== "open" || !candidate.trust_ok) return false;
  if (!employerIsTest && candidate.is_test) return false;
  const row = db
    .prepare(
      `SELECT 1 FROM employer_needs n
       WHERE n.employer_user_id = ? AND n.specialization = ? AND n.grade = ?
       LIMIT 1`
    )
    .get(employerUserId, candidate.specialization, candidate.grade);
  return Boolean(row);
}

function employerMayViewCandidateAiUsage(employerUserId, candidateUserId) {
  return (
    employerHasInvitation(employerUserId, candidateUserId) ||
    employerSeesCandidateInPool(employerUserId, candidateUserId)
  );
}

function clientLabelFromSession(row) {
  const name = String(row.client_name || "").trim();
  const where = String(row.client_where || "").trim();
  if (name && !["http", "unknown"].includes(name.toLowerCase())) {
    const ver = row.client_version ? ` ${row.client_version}` : "";
    const base = `${name}${ver}`;
    return where ? `${base} (${where})` : base;
  }
  if (where) return where;
  return null;
}

function summarizeAiUsageForEmployer(employerUserId, candidateUserId) {
  if (!employerMayViewCandidateAiUsage(employerUserId, candidateUserId)) {
    return null;
  }
  const db = getDb();
  const sessions = db
    .prepare(
      `SELECT s.client_name, s.client_version, s.last_seen_at, t.client_where
       FROM mcp_client_sessions s
       LEFT JOIN api_tokens t ON t.id = s.api_token_id
       WHERE s.user_id = ?
       ORDER BY s.last_seen_at DESC LIMIT 5`
    )
    .all(candidateUserId);
  const calls = db
    .prepare(
      `SELECT tool_name, intent_text, created_at FROM mcp_tool_calls
       WHERE user_id = ? AND tool_name IN ('start_assessment', 'submit_answer', 'submit_work_task', 'get_task', 'list_tasks')
       ORDER BY created_at DESC LIMIT 12`
    )
    .all(candidateUserId);
  if (!sessions.length && !calls.length) {
    return {
      headline: "Пока нет записей об использовании ИИ-клиентов для теста.",
      clients: [],
      activityLines: [],
    };
  }
  const clients = sessions.map(clientLabelFromSession).filter(Boolean);
  const uniqueClients = [...new Set(clients)];

  const submitCount = calls.filter((c) => c.tool_name === "submit_answer").length;
  const workCount = calls.filter((c) => c.tool_name === "submit_work_task").length;
  const started = calls.some((c) => c.tool_name === "start_assessment");
  let activityHeadline = "";
  if (started && submitCount >= 4 && workCount >= 1) {
    activityHeadline = "Весь тест проходил через ИИ-клиент.";
  } else if (submitCount > 0 || workCount > 0) {
    activityHeadline = "Часть ответов в тесте отправлялась через ИИ-клиент.";
  }

  const activityLines = [];
  const toolLabels = {
    start_assessment: "Запускал тест через ИИ-клиент",
    submit_answer: "Отправлял короткие ответы через ИИ-клиент",
    submit_work_task: "Сдавал рабочее задание через ИИ-клиент",
    get_task: "Открывал текст задания в ИИ-клиенте",
    list_tasks: "Смотрел список заданий в ИИ-клиенте",
  };
  for (const c of calls) {
    if (!ASSESSMENT_TOOLS.has(c.tool_name)) continue;
    const label = toolLabels[c.tool_name] || c.tool_name;
    const intent = c.intent_text ? `: ${c.intent_text}` : "";
    activityLines.push(`${label}${intent}`);
  }

  const clientPart = uniqueClients.length
    ? `Подключались клиенты: ${uniqueClients.join(", ")}.`
    : "Есть действия через ИИ-клиент, но без сохранённого имени клиента.";
  const headline = [clientPart, activityHeadline].filter(Boolean).join(" ");

  return {
    headline,
    clients: uniqueClients,
    activityLines: activityLines.slice(0, 5),
  };
}

function listHumanAuditForUser(userId, limit = 50) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT tool_name, ok, result_summary, created_at FROM mcp_audit_log
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, limit);
  return rows.map((r) => ({
    at: r.created_at,
    text: r.result_summary,
    ok: Boolean(r.ok),
  }));
}

module.exports = {
  employerHasInvitation,
  employerSeesCandidateInPool,
  employerMayViewCandidateAiUsage,
  summarizeAiUsageForEmployer,
  listHumanAuditForUser,
};
