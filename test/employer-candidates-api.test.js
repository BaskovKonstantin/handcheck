"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");

describe("GET /api/employer/candidates", () => {
  let app;

  before(() => {
    const tmpDb = path.join(os.tmpdir(), `hc-cand-${process.pid}.sqlite`);
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    delete require.cache[require.resolve("../app/server")];
    const { createApp } = require("../app/server");
    app = createApp();
  });

  it("returns bank items for logged-in employer", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    const res = await agent.get("/api/employer/candidates");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.ok(res.body.total >= 1);
    const sample = res.body.items[0];
    assert.ok(sample.id);
    assert.ok(sample.displayName);
    assert.equal(sample.test_score, undefined);
    assert.equal(sample.rankScore, undefined);
    assert.equal(sample._rank, undefined);
  });

  it("filters by parsed q senior node fsp", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    const res = await agent.get("/api/employer/candidates?q=" + encodeURIComponent("сеньор нода фсп"));
    assert.equal(res.status, 200);
    assert.ok(res.body.parsedChips?.length >= 2);
  });
});
