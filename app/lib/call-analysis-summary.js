"use strict";

const { domainKeywordHits } = require("./call-domain-match");

function parseSqliteDate(value) {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:/.test(raw)) return new Date(`${raw.replace(" ", "T")}Z`);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function callDurationSeconds(call) {
  const start = parseSqliteDate(call.started_at);
  const end = parseSqliteDate(call.ended_at);
  if (!start || !end) return null;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
}

function formatMinutesAboutRu(mins) {
  const n = Math.max(1, Math.round(mins));
  if (n === 1) return "минуты";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} минуты`;
  return `${n} минут`;
}

function durationPhrase(seconds) {
  if (seconds == null) return "Длительность звонка не зафиксирована.";
  if (seconds < 60) return "Короткий звонок, меньше минуты.";
  const mins = Math.max(1, Math.round(seconds / 60));
  return `Около ${formatMinutesAboutRu(mins)} разговора.`;
}

function bothSidesSpokeInTranscript(transcript) {
  const t = String(transcript || "");
  if (!t.trim()) return false;
  const cand = /(?:^|[\s.])кандидат\s*:/im.test(t);
  const emp = /(?:^|[\s.])работодатель\s*:/im.test(t);
  return cand && emp;
}

function participationPhrase(transcript) {
  if (!String(transcript || "").trim()) {
    return "Реплик в расшифровке нет.";
  }
  if (bothSidesSpokeInTranscript(transcript)) {
    return "Обе стороны оставили реплики в расшифровке.";
  }
  return "В расшифровке слышна только одна сторона.";
}

function domainPhrase(needDomainText, transcript) {
  const text = String(transcript || "");
  if (!text.trim()) {
    return "Домен потребности по расшифровке не проверяли.";
  }
  const hits = domainKeywordHits(needDomainText || "", text);
  if (hits.length) {
    return "В разговоре прозвучали темы, связанные с доменом потребности.";
  }
  return "Явных совпадений с доменом потребности в репликах нет.";
}

function recordingSummaryPhrase(recordingSides) {
  const sides = recordingSides || [];
  if (sides.length >= 2) {
    return " Запись обеих сторон сохранена для внутреннего просмотра.";
  }
  if (sides.length === 1) {
    const who = sides[0] === "candidate" ? "кандидата" : "работодателя";
    return ` Запись сохранена только со стороны ${who}.`;
  }
  return "";
}

function buildCallAnalysisSummary({ needDomainText, transcript, call, hasRecordingFile, recordingSides }) {
  const seconds = callDurationSeconds(call);
  const parts = [
    domainPhrase(needDomainText, transcript),
    durationPhrase(seconds),
    participationPhrase(transcript),
  ];
  let summary = parts.join(" ");
  if (hasRecordingFile) {
    summary += recordingSummaryPhrase(recordingSides);
  }
  const hits = domainKeywordHits(needDomainText || "", transcript || "");
  let consistency_note = "";
  if (!String(transcript || "").trim()) consistency_note = "нет реплик";
  else if (hits.length) consistency_note = "domain_match";
  else consistency_note = "no_domain_hits";
  return { summary_text: summary, consistency_note, domain_hits: hits };
}

module.exports = {
  callDurationSeconds,
  formatMinutesAboutRu,
  durationPhrase,
  bothSidesSpokeInTranscript,
  buildCallAnalysisSummary,
  parseSqliteDate,
};
