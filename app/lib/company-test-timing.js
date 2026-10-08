"use strict";

/** Grace after per-question deadline (network latency), same spirit as platform quick tasks. */
const COMPANY_ITEM_GRACE_MS = 2000;

function itemDeadlineMs(item, openedAt) {
  if (!openedAt || !item.time_limit_sec) return null;
  return new Date(openedAt).getTime() + item.time_limit_sec * 1000;
}

function isItemExpired(item, answerRow, nowMs = Date.now()) {
  if (!answerRow?.opened_at || answerRow.submitted_at) return false;
  const deadline = itemDeadlineMs(item, answerRow.opened_at);
  if (!deadline) return false;
  return nowMs > deadline + COMPANY_ITEM_GRACE_MS;
}

module.exports = {
  COMPANY_ITEM_GRACE_MS,
  itemDeadlineMs,
  isItemExpired,
};
