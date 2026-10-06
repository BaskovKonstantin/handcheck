"use strict";

const { getDb } = require("../db");

function employerMayViewCandidate(employerUserId, candidateUserId) {
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

function summarizeAiUsageForEmployer(employerUserId, candidateUserId) {
  if (!employerMayViewCandidate(employerUserId, candidateUserId)) {
    return null;
  }
  const db = getDb();
  const sessions = db
    .prepare(
      `SELECT DISTINCT s.client_name, s.client_version, s.first_seen_at, s.last_seen_at
       FROM mcp_client_sessions s
       WHERE s.user_id = ?
       ORDER BY s.last_seen_at DESC LIMIT 5`
    )
    .all(candidateUserId);
  const calls = db
    .prepare(
      `SELECT tool_name, intent_text, created_at FROM mcp_tool_calls
       WHERE user_id = ? AND tool_name IN ('start_assessment', 'submit_answer', 'submit_work_task', 'get_task', 'list_tasks')
       ORDER BY created_at DESC LIMIT 8`
    )
    .all(candidateUserId);
  if (!sessions.length && !calls.length) {
    return {
      headline: "Пока нет записей об использовании ИИ-клиентов для теста.",
      clients: [],
      activityLines: [],
    };
  }
  const clients = sessions
    .filter((s) => {
      const n = String(s.client_name || "").toLowerCase();
      return n && n !== "http" && n !== "unknown";
    })
    .map((s) => {
      const ver = s.client_version ? ` ${s.client_version}` : "";
      return `${s.client_name}${ver}`;
    });
  const activityLines = [];
  const toolLabels = {
    start_assessment: "Запускал тест через ИИ-клиент",
    submit_answer: "Отправлял короткие ответы через ИИ-клиент",
    submit_work_task: "Сдавал рабочее задание через ИИ-клиент",
    get_task: "Открывал текст задания в ИИ-клиенте",
    list_tasks: "Смотрел список заданий в ИИ-клиенте",
  };
  for (const c of calls) {
    const label = toolLabels[c.tool_name] || c.tool_name;
    const intent = c.intent_text ? `: ${c.intent_text}` : "";
    activityLines.push(`${label}${intent}`);
  }
  return {
    headline: clients.length
      ? `Подключались клиенты: ${clients.join(", ")}.`
      : "Есть действия через ИИ-клиент, но без сохранённого имени клиента.",
    clients,
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
  employerMayViewCandidate,
  summarizeAiUsageForEmployer,
  listHumanAuditForUser,
};
