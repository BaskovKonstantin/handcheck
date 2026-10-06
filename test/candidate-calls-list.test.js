"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { splitCandidateCalls, candidateCallStats } = require("../app/lib/candidate-calls-list");

describe("candidate-calls-list", () => {
  it("splits ended calls for collapse group", () => {
    const items = [
      { callStatus: "ready", invitationId: "a" },
      { callStatus: "ended", invitationId: "b" },
      { callStatus: "live", invitationId: "c" },
      { callStatus: "ended", invitationId: "d" },
    ];
    const { active, ended } = splitCandidateCalls(items);
    assert.equal(active.length, 2);
    assert.equal(ended.length, 2);
  });

  it("candidateCallStats counts statuses", () => {
    const stats = candidateCallStats([
      { callStatus: "ready" },
      { callStatus: "live" },
      { callStatus: "ended" },
    ]);
    assert.equal(stats.total, 3);
    assert.equal(stats.ready, 1);
    assert.equal(stats.live, 1);
    assert.equal(stats.ended, 1);
  });
});
