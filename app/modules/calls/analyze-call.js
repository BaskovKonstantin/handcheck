"use strict";

const fs = require("fs");
const path = require("path");
const { getDb } = require("../../db");
const { domainKeywordHits } = require("../../lib/call-domain-match");

function parseSqliteDate(value) {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:/.test(raw)) return new Date(`${raw.replace(" ", "T")}Z`);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function callDurationMinutes(call) {
  const start = parseSqliteDate(call.started_at);
  const end = parseSqliteDate(call.ended_at);
  if (!start || !end) return null;
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  return mins > 0 ? mins : null;
}

function hasRecordingFile(call) {
  const dir = call.recording_path;
  if (!dir) return false;
  return (
    fs.existsSync(path.join(dir, "employer.webm")) ||
    fs.existsSync(path.join(dir, "candidate.webm"))
  );
}

function participationPhrase(call) {
  const both = Boolean(call.consent_at_candidate && call.consent_at_employer);
  const mins = callDurationMinutes(call);
  if (mins && both) {
    return `Созвон длился около ${mins} мин., обе стороны участвовали в разговоре.`;
  }
  if (mins) {
    return `Созвон длился около ${mins} мин.`;
  }
  if (both) {
    return "Обе стороны подтвердили участие в разговоре.";
  }
  return "Созвон завершён.";
}

function analyzeCall(callId) {
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(callId);
  if (!call) return;
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  const need = db.prepare("SELECT domain_text FROM employer_needs WHERE id = ?").get(inv.need_id);
  const transcript = call.transcript_text || "";
  const hits = domainKeywordHits(need?.domain_text || "", transcript);
  let summary_text;
  let consistency_note = "";
  const recordingNote = hasRecordingFile(call)
    ? "Запись сохранена для внутреннего просмотра."
    : "Запись в файле не найдена — ориентируйтесь на заметки и переписку.";
  const part = participationPhrase(call);

  if (!transcript.trim()) {
    summary_text =
      `Созвон завершён без распознанных реплик. Домен по разговору не подтверждён. ${part} ${recordingNote}`;
    consistency_note = "нет реплик";
  } else if (hits.length) {
    summary_text =
      `Кандидат обсуждал темы, связанные с доменом потребности. Формулировки совпали с ожидаемым контекстом задачи. ${part} ${recordingNote}`;
    consistency_note = "domain_match";
  } else {
    summary_text =
      `Разговор состоялся, явных совпадений с доменом потребности в тексте нет. Стоит сверить ожидания по роли отдельно. ${part} ${recordingNote}`;
    consistency_note = "no_domain_hits";
  }
  db.prepare(
    `INSERT INTO call_analyses (call_id, summary_text, domain_hits_json, consistency_note)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(call_id) DO UPDATE SET summary_text = excluded.summary_text,
       domain_hits_json = excluded.domain_hits_json, consistency_note = excluded.consistency_note`
  ).run(callId, summary_text, JSON.stringify(hits), consistency_note);
}

function queueAnalyzeCall(callId) {
  setImmediate(() => {
    try {
      analyzeCall(callId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("analyzeCall failed", e);
    }
  });
}

module.exports = { analyzeCall, queueAnalyzeCall, callDurationMinutes, hasRecordingFile };
