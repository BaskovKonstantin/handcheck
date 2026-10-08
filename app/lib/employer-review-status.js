"use strict";

function reviewStatusKey(decision) {
  if (!decision) return "new";
  if (decision === "invited") return "invited";
  if (decision === "later") return "later";
  if (decision === "declined") return "declined";
  if (decision === "rejected") return "rejected";
  return "new";
}

function employerReviewStatusLabel(reviewStatus) {
  const st = reviewStatus;
  if (st === "invited") return "Приглашён";
  if (st === "later") return "Отложен";
  if (st === "declined") return "Отказался";
  if (st === "rejected") return "Отказ";
  return "Новый";
}

function matchesEmployerReviewStatusFilter(item, statusFilter) {
  if (!statusFilter) return true;
  const key = reviewStatusKey(item.reviewDecision);
  if (statusFilter === "new") return key === "new";
  if (statusFilter === "later") return key === "later";
  if (statusFilter === "invited") return key === "invited";
  if (statusFilter === "declined") return key === "declined";
  if (statusFilter === "rejected") return key === "rejected";
  return true;
}

module.exports = {
  reviewStatusKey,
  employerReviewStatusLabel,
  matchesEmployerReviewStatusFilter,
};
