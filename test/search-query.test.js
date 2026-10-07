"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseSearchQuery } = require("../app/lib/search-query");

describe("search-query parser", () => {
  it("maps senior node fsp tokens", () => {
    const p = parseSearchQuery("сеньор нода фсп");
    assert.equal(p.grade, "senior");
    assert.equal(p.stack, "node");
    assert.equal(p.fsp, "1");
    assert.equal(p.text, "");
    assert.equal(p.chips.length, 3);
  });

  it("maps english qa frontend", () => {
    const p = parseSearchQuery("senior frontend");
    assert.equal(p.grade, "senior");
    assert.equal(p.spec, "frontend");
  });

  it("keeps unknown tokens as free text", () => {
    const p = parseSearchQuery("сеньор Иванов финтех");
    assert.equal(p.grade, "senior");
    assert.match(p.text, /Иванов/);
    assert.match(p.text, /финтех/);
  });
});
