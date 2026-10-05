"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { domainBoost } = require("../app/lib/domain-boost");

describe("domain-boost", () => {
  it("matches официанта and HoReCa", () => {
    const boost = domainBoost("автоматизация работы официанта", [
      { role_title: "официанта", domain: "обслуживание гостей", industry: "HoReCa" },
    ]);
    assert.ok(boost > 0);
  });

  it("empty episodes → 0", () => {
    assert.equal(domainBoost("ресторан", []), 0);
  });
});
