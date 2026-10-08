"use strict";

const { getDb } = require("../../db");
const { buildCallAnalysisSummary } = require("../../lib/call-analysis-summary");

const { hasAnyPlayableRecording, listPlayableRecordingSides } = require("../../lib/call-recording");

function hasRecordingFile(call) {
  return hasAnyPlayableRecording(call.recording_path);
}

function analyzeCall(callId) {
  const db = getDb();
  const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(callId);
  if (!call) return;
  const inv = db.prepare("SELECT * FROM invitations WHERE id = ?").get(call.invitation_id);
  const need = db.prepare("SELECT domain_text FROM employer_needs WHERE id = ?").get(inv.need_id);
  const transcript = call.transcript_text || "";
  const recordingSides = listPlayableRecordingSides(call.recording_path);
  const { summary_text, consistency_note, domain_hits } = buildCallAnalysisSummary({
    needDomainText: need?.domain_text || "",
    transcript,
    call,
    hasRecordingFile: hasRecordingFile(call),
    recordingSides,
  });
  db.prepare(
    `INSERT INTO call_analyses (call_id, summary_text, domain_hits_json, consistency_note)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(call_id) DO UPDATE SET summary_text = excluded.summary_text,
       domain_hits_json = excluded.domain_hits_json, consistency_note = excluded.consistency_note`
  ).run(callId, summary_text, JSON.stringify(domain_hits), consistency_note);
}

const analyzeDebounceMs = 150;
const pendingAnalyze = new Map();

function queueAnalyzeCall(callId) {
  const existing = pendingAnalyze.get(callId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingAnalyze.delete(callId);
    setImmediate(() => {
      try {
        analyzeCall(callId);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("analyzeCall failed", e);
      }
    });
  }, analyzeDebounceMs);
  pendingAnalyze.set(callId, timer);
}

module.exports = { analyzeCall, queueAnalyzeCall, hasRecordingFile };
