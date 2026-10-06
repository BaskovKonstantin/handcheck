"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("demo seed top-up", () => {
  let tmpDb;

  before(() => {
    tmpDb = path.join(os.tmpdir(), `hc-topup-${process.pid}-${Date.now()}.sqlite`);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/app/")) delete require.cache[key];
    }
    const { createApp } = require("../app/server");
    createApp();
  });

  after(() => {
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("ensures demo3..demo8 exist and top-up is idempotent", () => {
    const { topUpDemoCandidates, DEMO_TOPUP_CANDIDATES } = require("../app/db/seed");
    const db = require("../app/db").getDb();
    for (const spec of DEMO_TOPUP_CANDIDATES) {
      const row = db.prepare("SELECT id FROM users WHERE email = ?").get(spec.email);
      assert.ok(row, `missing ${spec.email}`);
    }
    const second = topUpDemoCandidates(db);
    assert.equal(second.inserted, 0);
  });

  it("leaves several candidates in cafe deck pool", () => {
    const { loadCandidatesForNeed } = require("../app/modules/matching/pool");
    const db = require("../app/db").getDb();
    const employerId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    const need = db
      .prepare("SELECT * FROM employer_needs WHERE employer_user_id = ?")
      .get(employerId);
    const deck = loadCandidatesForNeed(need, employerId, { forDeck: true });
    assert.ok(deck.length >= 4, `expected deck pool >= 4, got ${deck.length}`);
  });
});
