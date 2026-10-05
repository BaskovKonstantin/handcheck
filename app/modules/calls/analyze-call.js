"use strict";

const { getDb } = require("../../db");
const config = require("../../config");
const { tokenize } = require("../../lib/domain-boost");

function analyzeCall(callId) {
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(callId);
  if (!call) return;
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  const need = db.prepare("SELECT domain_text FROM employer_needs WHERE id = ?").get(inv.need_id);
  const transcript = call.transcript_text || "";
  const needTokens = tokenize(need.domain_text);
  const transcriptTokens = tokenize(transcript);
  const hits = [];
  for (const t of needTokens) {
    if (transcriptTokens.has(t)) hits.push(t);
  }
  let summary_text;
  let consistency_note = "";
  if (!transcript.trim()) {
    summary_text =
      "Созвон завершён без распознанных реплик. Домен по разговору не подтверждён. Рекомендуем повторный контакт при необходимости.";
    consistency_note = "нет реплик";
  } else if (hits.length) {
    summary_text =
      "Кандидат обсуждал темы, связанные с доменом потребности. Формулировки совпали с ожидаемым контекстом задачи. Итог созвона можно учитывать при следующем подборе.";
    consistency_note = "domain_match";
  } else {
    summary_text =
      "Разговор состоялся, явных совпадений с доменом потребности в тексте нет. Стоит сверить ожидания по роли отдельно. Запись сохранена для внутреннего просмотра.";
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

module.exports = { analyzeCall, queueAnalyzeCall };
