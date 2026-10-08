"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("seed-jury-pack", () => {
  before(() => {
    const tmpDb = path.join(os.tmpdir(), `hc-jury-${process.pid}.sqlite`);
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    delete require.cache[require.resolve("../app/server")];
    delete require.cache[require.resolve("../scripts/seed-jury-pack")];
    const { createApp } = require("../app/server");
    createApp();
  });

  it("is idempotent and creates jury invitations", () => {
    const { seedJuryPack } = require("../scripts/seed-jury-pack");
    const first = seedJuryPack();
    const second = seedJuryPack();
    assert.equal(first.skipped, false);
    assert.equal(second.skipped, true);
    const db = require("../app/db").getDb();
    const n = db
      .prepare("SELECT COUNT(*) AS c FROM invitations WHERE id LIKE 'jury-pack-%'")
      .get().c;
    assert.equal(n, 4);
  });
});
