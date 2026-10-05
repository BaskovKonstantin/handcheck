"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { employerCandidateView } = require("../app/lib/privacy");

describe("privacy", () => {
  const candidate = {
    id: "c1",
    displayName: "A",
    categoryLabel: "Backend × Middle",
    stack: ["node"],
    backgroundDomains: [],
    explanation: ["x"],
    taskPhrases: ["a", "b", "c"],
    phone: "+1",
    contact_email: "a@x.com",
  };

  it("hides contacts before accept", () => {
    const v = employerCandidateView("emp1", candidate, {
      status: "sent",
      employer_user_id: "emp1",
    });
    assert.equal(v.phone, undefined);
  });

  it("shows contacts after accept for same employer", () => {
    const v = employerCandidateView("emp1", candidate, {
      status: "accepted",
      employer_user_id: "emp1",
    });
    assert.equal(v.phone, "+1");
  });
});
