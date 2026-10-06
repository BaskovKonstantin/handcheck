"use strict";

const { candidateCallStats, splitCandidateCalls } = require("./candidate-calls-list");

function isJoinableCallStatus(status) {
  return status === "ready" || status === "live";
}

function joinableCallsCount(items) {
  const { active } = splitCandidateCalls(items);
  return active.filter((r) => isJoinableCallStatus(r.callStatus)).length;
}

function callStatusByInvitationId(callItems) {
  const map = new Map();
  for (const row of callItems || []) {
    if (row.invitationId) map.set(row.invitationId, row.callStatus || "ready");
  }
  return map;
}

function isInvitationJoinable(invitationId, statusByInvitation) {
  const status = statusByInvitation.get(invitationId);
  if (!status) return true;
  return isJoinableCallStatus(status);
}

function callsTileHint(joinableCount) {
  if (joinableCount > 0) return "принято — можно в комнату";
  return "нет активных комнат";
}

module.exports = {
  isJoinableCallStatus,
  joinableCallsCount,
  callStatusByInvitationId,
  isInvitationJoinable,
  callsTileHint,
  candidateCallStats,
};
