"use strict";

/**
 * Split candidate call rows for UI: active (ready/live) vs ended archive.
 * @param {Array<{ callStatus?: string }>} items
 */
function splitCandidateCalls(items) {
  const active = [];
  const ended = [];
  for (const row of items || []) {
    if (row.callStatus === "ended") ended.push(row);
    else active.push(row);
  }
  return { active, ended };
}

function candidateCallStats(items) {
  const { active, ended } = splitCandidateCalls(items);
  const ready = active.filter((r) => r.callStatus !== "live").length;
  const live = active.filter((r) => r.callStatus === "live").length;
  return {
    total: (items || []).length,
    ready,
    live,
    ended: ended.length,
  };
}

module.exports = { splitCandidateCalls, candidateCallStats };
