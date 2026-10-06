"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("matching pool", () => {
  let loadCandidatesForNeed;
  let db;
  let needId;
  let employerId;
  let annaId;

  before(() => {
    const tmpDb = path.join(os.tmpdir(), `hc-pool-${process.pid}.sqlite`);
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    delete require.cache[require.resolve("../app/server")];
    delete require.cache[require.resolve("../app/modules/matching/pool")];
    const { createApp } = require("../app/server");
    createApp();
    ({ loadCandidatesForNeed } = require("../app/modules/matching/pool"));
    db = require("../app/db").getDb();
    employerId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    annaId = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get().id;
    needId = db
      .prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?")
      .get(employerId).id;
    const need = db.prepare("SELECT * FROM employer_needs WHERE id = ?").get(needId);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO need_reviews (id, employer_user_id, need_id, candidate_user_id, decision, updated_at)
       VALUES (?, ?, ?, ?, 'invited', ?)`
    ).run("test-review-invited", employerId, needId, annaId, now);
  });

  it("excludes invited from deck pool", () => {
    const need = db.prepare("SELECT * FROM employer_needs WHERE id = ?").get(needId);
    const deck = loadCandidatesForNeed(need, employerId, { forDeck: true });
    assert.ok(!deck.some((c) => c.id === annaId));
  });

  it("keeps invited in matches list", () => {
    const need = db.prepare("SELECT * FROM employer_needs WHERE id = ?").get(needId);
    const matches = loadCandidatesForNeed(need, employerId, { forDeck: false });
    assert.ok(matches.some((c) => c.id === annaId && c.reviewDecision === "invited"));
  });
});
