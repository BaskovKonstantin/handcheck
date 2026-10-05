"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { normalizeText, scoreQuick, aggregateBattery } = require("../app/lib/rubric-score");

describe("rubric-score", () => {
  it("normalizes ё and punctuation", () => {
    assert.ok(normalizeText("REST, статус!").includes("статус"));
  });

  it("scores key hit ratio", () => {
    const s = scoreQuick("используем rest api и коды статус", {
      keys: ["rest", "статус"],
      breadthKeys: ["идемпотентность"],
    });
    assert.equal(s.knowledge, 1);
  });

  it("aggregates battery with 0.6/0.4 mix", () => {
    const agg = aggregateBattery(
      [{ knowledge: 1, breadth: 0.5 }],
      { knowledge: 0.8, breadth: 0.6 }
    );
    assert.ok(agg.test_score > 0.6 && agg.test_score < 1);
  });
});
