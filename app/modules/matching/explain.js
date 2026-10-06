"use strict";

function buildExplanation(candidate, need) {
  const lines = [];
  const gradeLabel = need.grade.charAt(0).toUpperCase() + need.grade.slice(1);
  const specLabel = need.specialization.charAt(0).toUpperCase() + need.specialization.slice(1);
  lines.push(`Категория совпадает с потребностью: ${specLabel} × ${gradeLabel}`);
  if (candidate.domain_boost > 0) {
    lines.push("Прошлый опыт пересекается с доменом задачи");
  }
  if (candidate.fsp_boost === 1) {
    lines.push("Есть достижения ФСП в профиле");
  }
  const needStack = JSON.parse(need.stack_json || "[]");
  const overlap = needStack.filter((s) =>
    candidate.stack.some((c) => String(c).toLowerCase() === String(s).toLowerCase())
  );
  if (overlap.length) {
    lines.push(`Совпадает стек: ${overlap[0]}`);
  }
  return lines.slice(0, 3);
}

module.exports = { buildExplanation };
