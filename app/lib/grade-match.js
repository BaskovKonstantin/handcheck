"use strict";

const { GRADE_LABELS, formatSpecGradeLabel } = require("./category-labels");

const GRADE_ORDER = { junior: 0, middle: 1, senior: 2 };

const GRADE_RELATION_EXACT = "exact";
const GRADE_RELATION_LOWER = "lower";
const GRADE_RELATION_HIGHER = "higher";
const GRADE_RELATION_UNCONFIRMED = "unconfirmed";

function gradeRelationForNeed(candidateGrade, needGrade, categoryStatus) {
  if (categoryStatus !== "confirmed" || !candidateGrade) {
    return GRADE_RELATION_UNCONFIRMED;
  }
  if (candidateGrade === needGrade) return GRADE_RELATION_EXACT;
  const c = GRADE_ORDER[candidateGrade];
  const n = GRADE_ORDER[needGrade];
  if (c === undefined || n === undefined) return GRADE_RELATION_EXACT;
  if (c < n) return GRADE_RELATION_LOWER;
  if (c > n) return GRADE_RELATION_HIGHER;
  return GRADE_RELATION_EXACT;
}

/** Sort tier: 0 exact confirmed, 1 off-grade confirmed, 2 unconfirmed. */
function gradeMatchSortTier(gradeRelation) {
  if (gradeRelation === GRADE_RELATION_EXACT) return 0;
  if (gradeRelation === GRADE_RELATION_LOWER || gradeRelation === GRADE_RELATION_HIGHER) {
    return 1;
  }
  return 2;
}

function buildGradeMatchExplanationLine(gradeRelation, candidateGrade, need) {
  const needGr = GRADE_LABELS[need.grade] || need.grade;
  const candGr = GRADE_LABELS[candidateGrade] || candidateGrade;
  if (gradeRelation === GRADE_RELATION_EXACT) {
    return `Категория совпадает с потребностью: ${formatSpecGradeLabel(need.specialization, need.grade)}`;
  }
  if (gradeRelation === GRADE_RELATION_LOWER) {
    return `Грейд ниже потребности: ${candGr} vs ${needGr}`;
  }
  if (gradeRelation === GRADE_RELATION_HIGHER) {
    return `Грейд выше потребности: ${candGr} vs ${needGr}`;
  }
  return `Категория ${formatSpecGradeLabel(need.specialization, need.grade)} не подтверждена тестом`;
}

module.exports = {
  GRADE_ORDER,
  GRADE_RELATION_EXACT,
  GRADE_RELATION_LOWER,
  GRADE_RELATION_HIGHER,
  GRADE_RELATION_UNCONFIRMED,
  gradeRelationForNeed,
  gradeMatchSortTier,
  buildGradeMatchExplanationLine,
};
