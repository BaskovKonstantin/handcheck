"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("jury company test seed", () => {
  let tmpDb;

  before(() => {
    tmpDb = path.join(os.tmpdir(), `hc-jury-seed-${process.pid}.sqlite`);
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/app/")) delete require.cache[key];
    }
    const { createApp } = require("../app/server");
    createApp();
  });

  it("seed-jury-company-tests is idempotent", () => {
    const { seedJuryCompanyTests, JURY_EMPLOYER } = require("../scripts/seed-jury-company-tests");
    const db = require("../app/db").getDb();
    seedJuryCompanyTests(db);
    const tests = db
      .prepare("SELECT COUNT(*) AS c FROM employer_tests WHERE employer_user_id = (SELECT id FROM users WHERE email = ?)")
      .get(JURY_EMPLOYER);
    assert.ok(tests.c >= 3);
    seedJuryCompanyTests(db);
    const tests2 = db
      .prepare("SELECT COUNT(*) AS c FROM employer_tests WHERE employer_user_id = (SELECT id FROM users WHERE email = ?)")
      .get(JURY_EMPLOYER);
    assert.equal(tests2.c, tests.c);
  });
});
