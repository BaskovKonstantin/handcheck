"use strict";

const { stackOverlapTokens } = require("../../lib/stack-normalize");
const {
  buildGradeMatchExplanationLine,
  gradeRelationForNeed,
} = require("../../lib/grade-match");

function buildExplanation(candidate, need) {
  const lines = [];
  const gradeRelation =
    candidate.gradeRelation ||
    gradeRelationForNeed(candidate.confirmedGrade, need.grade, candidate.categoryStatus);
  lines.push(
    buildGradeMatchExplanationLine(gradeRelation, candidate.confirmedGrade, need)
  );
  if (candidate.domain_boost > 0) {
    const hint = String(need.domain_text || "").trim();
    lines.push(
      hint
        ? `Опыт в домене потребности: ${hint}`
        : "Опыт в домене совпадает с задачей потребности"
    );
  }
  if (candidate.fsp_boost === 1) {
    lines.push("Есть достижения ФСП в профиле");
  }
  const needStack = JSON.parse(need.stack_json || "[]");
  const overlap = stackOverlapTokens(needStack, candidate.stack);
  if (overlap.length) {
    lines.push(`Совпадает стек: ${overlap.join(", ")}`);
  }
  return lines.slice(0, 3);
}

module.exports = { buildExplanation };
