"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Load browser helpers from app.js export pattern — duplicate minimal logic for unit test
const { formatSpecGradeLabel } = require("../app/lib/category-labels");

function classifyEmployerMatchGroup(item, need) {
  const status = item.categoryStatus || "confirmed";
  if (status === "unconfirmed") return "unconfirmed";
  if (status === "other_grade" || status === "off_grade" || status === "grade_mismatch") {
    return "other_grade";
  }
  if (need && status === "confirmed") {
    const needLabel = formatSpecGradeLabel(need.specialization, need.grade);
    const raw = String(item.categoryLabel || "").replace(/\s*—\s*неподтверждён\s*$/i, "").trim();
    if (needLabel && raw && raw !== needLabel) return "other_grade";
  }
  return "exact";
}

function deckStatsFromMatches(items) {
  const skip = new Set(["rejected", "later", "invited", "declined"]);
  let deckLeft = 0;
  let invited = 0;
  let deferred = 0;
  for (const item of items || []) {
    const st = item.reviewStatus;
    if (st === "invited") invited += 1;
    else if (st === "later") deferred += 1;
    if (!skip.has(st)) deckLeft += 1;
  }
  return { deckLeft, invited, deferred };
}

describe("round-66 design helpers", () => {
  const need = { specialization: "backend", grade: "middle" };

  it("classifies unconfirmed and exact groups", () => {
    assert.equal(classifyEmployerMatchGroup({ categoryStatus: "unconfirmed" }, need), "unconfirmed");
    assert.equal(
      classifyEmployerMatchGroup(
        { categoryStatus: "confirmed", categoryLabel: "Backend × Middle" },
        need
      ),
      "exact"
    );
    assert.equal(
      classifyEmployerMatchGroup(
        { categoryStatus: "confirmed", categoryLabel: "Backend × Senior" },
        need
      ),
      "other_grade"
    );
    assert.equal(classifyEmployerMatchGroup({ categoryStatus: "other_grade" }, need), "other_grade");
  });

  it("deckStatsFromMatches counts deck left and review buckets", () => {
    const stats = deckStatsFromMatches([
      { reviewStatus: undefined },
      { reviewStatus: "later" },
      { reviewStatus: "invited" },
      { reviewStatus: "rejected" },
    ]);
    assert.equal(stats.deckLeft, 1);
    assert.equal(stats.deferred, 1);
    assert.equal(stats.invited, 1);
  });
});
