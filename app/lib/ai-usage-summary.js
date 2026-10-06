"use strict";

const { getDb } = require("../db");

const ASSESSMENT_TOOLS = new Set([
  "start_assessment",
  "submit_answer",
  "submit_work_task",
  "get_task",
  "list_tasks",
]);

const TOOL_ORDER = {
  start_assessment: 0,
  list_tasks: 1,
  get_task: 2,
  submit_answer: 3,
  submit_work_task: 4,
};

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

function formatClientLabel(row) {
  const name = String(row.client_name || "").trim();
  const where = String(row.client_where || "").trim();
  if (name && !["http", "unknown"].includes(name.toLowerCase())) {
    const ver = row.client_version ? ` ${row.client_version}` : "";
    const base = `${name}${ver}`;
    return where ? `${base} · где подключён: ${where}` : base;
  }
  if (where) return where;
  return null;
}

function latestBatteryWindow(db, candidateUserId) {
  const battery = db
    .prepare(
      `SELECT id, started_at, completed_at FROM batteries
       WHERE candidate_user_id = ? ORDER BY started_at DESC LIMIT 1`
    )
    .get(candidateUserId);
  if (!battery) return null;
  const end = battery.completed_at || new Date().toISOString();
  return { batteryId: battery.id, from: battery.started_at, to: end };
}

function batteryMcpSubmitStats(db, batteryId) {
  const attempts = db
    .prepare(
      `SELECT a.submitted_at, a.action_source, t.type FROM attempts a
       JOIN tasks t ON t.id = a.task_id WHERE a.battery_id = ? AND a.submitted_at IS NOT NULL`
    )
    .all(batteryId);
  const quickTotal = attempts.filter((a) => a.type === "quick").length;
  const quickMcp = attempts.filter((a) => a.type === "quick" && a.action_source === "mcp").length;
  const workMcp = attempts.some((a) => a.type === "work" && a.action_source === "mcp");
  const workTotal = attempts.some((a) => a.type === "work");
  return { quickTotal, quickMcp, workMcp, workTotal };
}

function buildIntegrationNoteForBattery(db, batteryId) {
  if (!batteryId) return null;
  const { quickTotal, quickMcp, workMcp, workTotal } = batteryMcpSubmitStats(db, batteryId);
  const mcpAnswers = quickMcp + (workMcp ? 1 : 0);
  const totalAnswers = quickTotal + (workTotal ? 1 : 0);
  if (mcpAnswers === 0) return null;
  if (totalAnswers > 0 && mcpAnswers >= totalAnswers && quickMcp >= quickTotal) {
    return "Весь тест отправлен через ИИ-клиент — нейтральная пометка, не штраф.";
  }
  return "Часть ответов в тесте отправлена через ИИ-клиент — нейтральная пометка, не штраф.";
}

function activityHeadlineFromBattery(stats) {
  const { quickTotal, quickMcp, workMcp, workTotal } = stats;
  const mcpAnswers = quickMcp + (workMcp ? 1 : 0);
  const totalAnswers = quickTotal + (workTotal ? 1 : 0);
  if (totalAnswers > 0 && mcpAnswers >= totalAnswers && quickMcp >= quickTotal) {
    return "Весь тест проходил через ИИ-клиент.";
  }
  if (mcpAnswers > 0) {
    return "Часть ответов в тесте отправлялась через ИИ-клиент.";
  }
  return "";
}

function buildActivityLines(calls, stats) {
  const lines = [];
  const { quickTotal, quickMcp, workMcp } = stats;

  const sorted = [...calls].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (ta !== tb) return ta - tb;
    return (TOOL_ORDER[a.tool_name] ?? 9) - (TOOL_ORDER[b.tool_name] ?? 9);
  });

  const seenIntents = new Set();
  const intentQuotes = [];

  for (const c of sorted) {
    if (!ASSESSMENT_TOOLS.has(c.tool_name)) continue;
    const intent = c.intent_text ? String(c.intent_text).trim() : "";
    if (intent) {
      const key = `${c.tool_name}:${intent.toLowerCase()}`;
      if (!seenIntents.has(key) && intentQuotes.length < 3) {
        seenIntents.add(key);
        intentQuotes.push(intent);
      }
    }
  }

  const startCall = sorted.find((c) => c.tool_name === "start_assessment");
  if (startCall) {
    const tail = startCall.intent_text ? ` — «${String(startCall.intent_text).slice(0, 120)}»` : "";
    lines.push(`Начал тест через ИИ-клиент${tail}`);
  }

  if (quickMcp > 0) {
    const part = quickTotal > 0 ? ` — ${quickMcp} из ${quickTotal}` : "";
    lines.push(`Отправил короткие ответы через ИИ-клиент${part}`);
  }

  if (workMcp) {
    lines.push("Сдал рабочую задачу через ИИ-клиент");
  }

  for (const q of intentQuotes) {
    if (lines.length >= 6) break;
    if (lines.some((l) => l.includes(`«${q}»`))) continue;
    lines.push(`«${q.slice(0, 160)}»`);
  }

  return lines.slice(0, 6);
}

function summarizeAiUsageForEmployer(employerUserId, candidateUserId) {
  if (!employerMayViewCandidateAiUsage(employerUserId, candidateUserId)) {
    return null;
  }
  const db = getDb();
  const window = latestBatteryWindow(db, candidateUserId);
  const stats = window ? batteryMcpSubmitStats(db, window.batteryId) : {
    quickTotal: 0,
    quickMcp: 0,
    workMcp: false,
    workTotal: false,
  };

  let calls = [];
  if (window) {
    calls = db
      .prepare(
        `SELECT tool_name, intent_text, created_at FROM mcp_tool_calls
         WHERE user_id = ? AND ok = 1
           AND tool_name IN ('start_assessment', 'submit_answer', 'submit_work_task', 'get_task', 'list_tasks')
           AND created_at >= ? AND created_at <= ?
         ORDER BY created_at ASC`
      )
      .all(candidateUserId, window.from, window.to);
  }

  const sessions = db
    .prepare(
      `SELECT s.client_name, s.client_version, s.last_seen_at, t.client_where
       FROM mcp_client_sessions s
       LEFT JOIN api_tokens t ON t.id = s.api_token_id
       WHERE s.user_id = ?
       ORDER BY s.last_seen_at DESC LIMIT 5`
    )
    .all(candidateUserId);

  const clients = [...new Set(sessions.map(formatClientLabel).filter(Boolean))];
  const activityLines = buildActivityLines(calls, stats);
  const activityHeadline = activityHeadlineFromBattery(stats);

  if (!clients.length && !activityLines.length && !activityHeadline) {
    return {
      headline: "Пока нет записей об использовании ИИ-клиентов для теста.",
      clients: [],
      activityLines: [],
      empty: true,
    };
  }

  const clientPart = clients.length
    ? `Подключались клиенты: ${clients.join("; ")}.`
    : activityLines.length || activityHeadline
      ? "Есть действия через ИИ-клиент, но без сохранённого имени клиента."
      : "";
  const headline = [clientPart, activityHeadline].filter(Boolean).join(" ");

  return {
    headline,
    clients,
    activityLines,
    empty: false,
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
  buildIntegrationNoteForBattery,
  listHumanAuditForUser,
};
