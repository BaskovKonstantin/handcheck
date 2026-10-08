"use strict";

const SPEC_LABELS = {
  backend: "Backend",
  frontend: "Frontend",
  fullstack: "Fullstack",
  qa: "QA",
  data: "Data",
  devops: "DevOps",
};

const GRADE_LABELS = {
  junior: "Junior",
  middle: "Middle",
  senior: "Senior",
};

function formatSpecGradeLabel(specialization, grade) {
  const spec = SPEC_LABELS[specialization] || specialization || "";
  const gr = GRADE_LABELS[grade] || grade || "";
  if (!spec && !gr) return "";
  if (!gr) return spec;
  if (!spec) return gr;
  return `${spec} × ${gr}`;
}

module.exports = {
  SPEC_LABELS,
  GRADE_LABELS,
  formatSpecGradeLabel,
};
