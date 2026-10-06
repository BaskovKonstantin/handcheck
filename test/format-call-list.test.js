"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  formatCallTimestamp,
  shortInvitationRef,
  groupEmployerCalls,
} = require("../app/lib/format-call-list");

describe("format-call-list", () => {
  it("formatCallTimestamp returns null for empty", () => {
    assert.equal(formatCallTimestamp(null), null);
    assert.equal(formatCallTimestamp(""), null);
  });

  it("shortInvitationRef uses tail of uuid", () => {
    const ref = shortInvitationRef("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    assert.match(ref, /^#[A-F0-9]{6}$/);
  });

  it("groupEmployerCalls groups by candidate and sorts by recency", () => {
    const groups = groupEmployerCalls([
      {
        candidateName: "Анна",
        invitationId: "a",
        invitationAt: "2026-01-01T10:00:00Z",
        endedAt: null,
        startedAt: null,
      },
      {
        candidateName: "Анна",
        invitationId: "b",
        invitationAt: "2026-02-01T10:00:00Z",
        endedAt: "2026-02-02T12:00:00Z",
        startedAt: null,
      },
      {
        candidateName: "Борис",
        invitationId: "c",
        invitationAt: "2026-03-01T10:00:00Z",
        endedAt: null,
        startedAt: null,
      },
    ]);
    assert.equal(groups.length, 2);
    const anna = groups.find((g) => g.candidateName === "Анна");
    assert.equal(anna.calls.length, 2);
    assert.equal(anna.calls[0].invitationId, "b");
  });
});
