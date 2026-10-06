"use strict";

function formatCallTimestamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Prefer ended → started → invitation created for display ordering. */
function callSortKey(item) {
  return item.endedAt || item.startedAt || item.invitationAt || "";
}

function shortInvitationRef(invitationId) {
  if (!invitationId || typeof invitationId !== "string") return "";
  const tail = invitationId.replace(/-/g, "").slice(-6).toUpperCase();
  return tail ? `#${tail}` : "";
}

function groupEmployerCalls(items) {
  const sorted = [...items].sort((a, b) => {
    const ka = callSortKey(a);
    const kb = callSortKey(b);
    return kb.localeCompare(ka);
  });
  const groups = new Map();
  for (const item of sorted) {
    const key = item.candidateName || "—";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].map(([candidateName, calls]) => ({
    candidateName,
    calls,
  }));
}

module.exports = {
  formatCallTimestamp,
  callSortKey,
  shortInvitationRef,
  groupEmployerCalls,
};
