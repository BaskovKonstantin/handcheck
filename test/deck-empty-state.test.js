"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { getDeckEmptyState } = require("../app/lib/deck-empty-state");

describe("deck empty state", () => {
  it("offers invitations when matches were already invited", () => {
    const s = getDeckEmptyState({ invitedInMatches: 2 });
    assert.equal(s.title, "Колода пуста");
    assert.ok(s.actions.some((a) => a.href === "/employer/invitations" && a.primary));
    assert.ok(s.actions.some((a) => a.href === "/employer/need"));
  });

  it("offers list and deferred when nobody invited yet", () => {
    const s = getDeckEmptyState({ invitedInMatches: 0 });
    assert.ok(s.actions.some((a) => a.href === "/employer/list" && a.primary));
    assert.ok(s.actions.some((a) => a.href === "/employer/deferred"));
  });
});
