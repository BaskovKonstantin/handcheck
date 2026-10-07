"use strict";

const { formatSpecGradeLabel } = require("./category-labels");

const CATEGORY_STATUS_CONFIRMED = "confirmed";
const CATEGORY_STATUS_UNCONFIRMED = "unconfirmed";

const UNCONFIRMED_LABEL_SUFFIX = " — неподтверждён";

/** Multiplier applied to computed rank so unconfirmed profiles sort below confirmed at equal skill signals. */
const UNCONFIRMED_RANK_FACTOR = 0.42;

function unconfirmedLabelForNeed(need) {
  return `${formatSpecGradeLabel(need.specialization, need.grade)}${UNCONFIRMED_LABEL_SUFFIX}`;
}

function candidateCategoryStatus(hasMatchingCategory) {
  return hasMatchingCategory ? CATEGORY_STATUS_CONFIRMED : CATEGORY_STATUS_UNCONFIRMED;
}

function applyUnconfirmedRankPenalty(rank, categoryStatus) {
  if (categoryStatus === CATEGORY_STATUS_CONFIRMED) return rank;
  return rank * UNCONFIRMED_RANK_FACTOR;
}

module.exports = {
  CATEGORY_STATUS_CONFIRMED,
  CATEGORY_STATUS_UNCONFIRMED,
  UNCONFIRMED_RANK_FACTOR,
  UNCONFIRMED_LABEL_SUFFIX,
  unconfirmedLabelForNeed,
  candidateCategoryStatus,
  applyUnconfirmedRankPenalty,
};
