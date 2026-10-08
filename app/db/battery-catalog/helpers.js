"use strict";

const SPECS = ["backend", "frontend", "qa"];
const GRADES = ["junior", "middle", "senior"];

const SPEC_LABEL = { backend: "Backend", frontend: "Frontend", qa: "QA" };
const GRADE_LABEL = { junior: "Junior", middle: "Middle", senior: "Senior" };

function categoryKey(specialization, grade) {
  return `${specialization}_${grade}`;
}

function categoryLabel(specialization, grade) {
  return `${SPEC_LABEL[specialization]} × ${GRADE_LABEL[grade]}`;
}

function minLengthForGrade(grade) {
  if (grade === "junior") return 70;
  if (grade === "senior") return 90;
  return 80;
}

/** @param {{ keys: string[][], breadthKeys?: string[][] }} item */
function quickRubricFromItem(item, grade, index) {
  const groups = item.keys || [];
  const keys =
    groups.length === 1 && Array.isArray(groups[0]) ? groups[0] : groups.flat();
  return {
    keys,
    breadthKeys: item.breadthKeys || [],
    minLength: minLengthForGrade(grade),
    questionIndex: index,
  };
}

function ensureCategories(db) {
  const ins = db.prepare(
    "INSERT OR IGNORE INTO categories (id, specialization, grade, label) VALUES (?, ?, ?, ?)"
  );
  for (const specialization of SPECS) {
    for (const grade of GRADES) {
      ins.run(categoryKey(specialization, grade), specialization, grade, categoryLabel(specialization, grade));
    }
  }
}

module.exports = {
  SPECS,
  GRADES,
  categoryKey,
  categoryLabel,
  minLengthForGrade,
  quickRubricFromItem,
  ensureCategories,
};
