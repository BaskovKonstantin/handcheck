"use strict";

const crypto = require("crypto");
const { getDb } = require("../db");
const { newId } = require("./ids");
const config = require("../config");

// No `g` flag: `.test()` must be stateless (global regexes keep `lastIndex` across calls).
const SECRET_MASK_TEST_RE = /(hc_[a-zA-Z0-9_-]+|Bearer\s+\S+|password|token|secret)/i;

function hashIp(ip) {
  const salt = config.MCP_IP_SALT || "handcheck-mcp-ip";
  return crypto.createHash("sha256").update(`${salt}:${ip || ""}`).digest("hex").slice(0, 16);
}

const ANSWER_TEXT_MAX = 160;
const GENERIC_TEXT_MAX = 240;

function looksLikeSecretValue(value) {
  if (typeof value !== "string" || !value) return false;
  return SECRET_MASK_TEST_RE.test(value);
}

function maskValue(key, value) {
  const k = String(key || "").toLowerCase();
  if (k.includes("token") || k.includes("password") || k.includes("secret")) return "[скрыто]";
  if (typeof value === "string") {
    if (looksLikeSecretValue(value)) return "[скрыто]";
    const maxLen = k.includes("answer") ? ANSWER_TEXT_MAX : GENERIC_TEXT_MAX;
    if (value.length > maxLen) return `${value.slice(0, maxLen)}…`;
  }
  return value;
}

function maskArgs(args) {
  if (!args || typeof args !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    if (Array.isArray(value)) {
      out[key] = value.map((v) => maskValue(key, v));
    } else if (value && typeof value === "object") {
      out[key] = maskArgs(value);
    } else {
      out[key] = maskValue(key, value);
    }
  }
  const text = JSON.stringify(out);
  if (text.length > 2000) {
    return { _truncated: true, preview: text.slice(0, 2000) };
  }
  return out;
}

function upsertClientSession(ctx, meta = {}) {
  const db = getDb();
  const clientName = String(meta.clientName || "unknown").slice(0, 120);
  const clientVersion = String(meta.clientVersion || "").slice(0, 80);
  const protocolVersion = String(meta.protocolVersion || "").slice(0, 40);
  const userAgent = String(meta.userAgent || "").slice(0, 500);
  const ipHash = hashIp(meta.ip);
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `SELECT id FROM mcp_client_sessions
       WHERE api_token_id = ? AND client_name = ? AND client_version = ? AND ip_hash = ?`
    )
    .get(ctx.tokenId, clientName, clientVersion, ipHash);
  if (existing) {
    db.prepare("UPDATE mcp_client_sessions SET last_seen_at = ?, user_agent = ? WHERE id = ?").run(
      now,
      userAgent,
      existing.id
    );
    return existing.id;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO mcp_client_sessions
     (id, user_id, api_token_id, client_name, client_version, protocol_version, user_agent, ip_hash, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    ctx.user.id,
    ctx.tokenId,
    clientName,
    clientVersion,
    protocolVersion,
    userAgent,
    ipHash,
    now,
    now
  );
  return id;
}

function recordInitialize(ctx, req, params) {
  const clientInfo = params?.clientInfo || {};
  const sessionId = upsertClientSession(ctx, {
    clientName: clientInfo.name,
    clientVersion: clientInfo.version,
    protocolVersion: params?.protocolVersion,
    userAgent: req.headers["user-agent"],
    ip: req.ip || req.socket?.remoteAddress,
  });
  ctx.mcpSessionId = sessionId;
  return sessionId;
}

function headerSessionId(req) {
  const raw = req.headers["mcp-session-id"] || req.headers["mcpsessionid"];
  if (!raw) return null;
  const id = Array.isArray(raw) ? raw[0] : raw;
  return String(id || "").trim() || null;
}

function isPlaceholderClientName(name) {
  const n = String(name || "").toLowerCase();
  return !n || n === "http" || n === "unknown";
}

function resolveMcpSessionId(ctx, req) {
  const db = getDb();
  const fromHeader = headerSessionId(req);
  if (fromHeader) {
    const row = db
      .prepare(
        `SELECT id FROM mcp_client_sessions WHERE id = ? AND api_token_id = ? AND user_id = ?`
      )
      .get(fromHeader, ctx.tokenId, ctx.user.id);
    if (row) return row.id;
  }
  const latest = db
    .prepare(
      `SELECT id, client_name FROM mcp_client_sessions
       WHERE api_token_id = ? AND user_id = ?
       ORDER BY last_seen_at DESC`
    )
    .all(ctx.tokenId, ctx.user.id);
  for (const row of latest) {
    if (!isPlaceholderClientName(row.client_name)) return row.id;
  }
  return null;
}

function humanToolSummary(toolName, ok, args) {
  const map = {
    whoami: "Проверка аккаунта",
    get_my_profile: "Чтение профиля",
    update_my_profile: "Обновление профиля",
    get_my_category: "Проверка категории",
    list_tasks: "Список заданий теста",
    get_task: "Открытие задания",
    start_assessment: "Начало теста",
    submit_answer: "Отправка короткого ответа",
    submit_work_task: "Отправка рабочего задания",
    list_invitations: "Список приглашений",
    respond_invitation: "Ответ на приглашение",
    list_calls: "Список звонков",
    list_needs: "Список потребностей",
    create_need: "Создание потребности",
    update_need: "Обновление потребности",
    get_next_candidate: "Карточка в колоде",
    decide_candidate: "Решение по кандидату",
    list_shortlist: "Список подходящих",
    get_call_analysis: "Разбор звонка",
  };
  const base = map[toolName] || toolName;
  const intent = args?.intent ? ` — «${String(args.intent).slice(0, 80)}»` : "";
  return `${base}${intent}`;
}

function logToolCall(ctx, toolName, args, result) {
  const db = getDb();
  const sessionId = ctx.mcpSessionId || null;
  const masked = maskArgs(args || {});
  const intent = args?.intent ? String(args.intent).slice(0, 200) : null;
  const ok = !result?.isError;
  const errorCode = ok ? null : "tool_error";
  const durationMs = result?.durationMs ?? null;
  const summary = humanToolSummary(toolName, ok, args);
  const now = new Date().toISOString();
  if (sessionId) {
    db.prepare("UPDATE mcp_client_sessions SET last_seen_at = ? WHERE id = ?").run(now, sessionId);
  }
  db.prepare(
    `INSERT INTO mcp_tool_calls
     (id, session_id, user_id, api_token_id, tool_name, args_masked_json, intent_text, ok, error_code, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(),
    sessionId,
    ctx.user.id,
    ctx.tokenId,
    toolName,
    JSON.stringify(masked),
    intent,
    ok ? 1 : 0,
    errorCode,
    durationMs,
    now
  );
  db.prepare(
    `INSERT INTO mcp_audit_log (user_id, api_token_id, tool_name, ok, result_summary)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ctx.user.id, ctx.tokenId, toolName, ok ? 1 : 0, summary.slice(0, 500));
}

module.exports = {
  hashIp,
  maskArgs,
  upsertClientSession,
  recordInitialize,
  resolveMcpSessionId,
  humanToolSummary,
  logToolCall,
};
