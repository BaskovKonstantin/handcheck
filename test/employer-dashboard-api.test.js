"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");

describe("GET /api/employer/dashboard", () => {
  let app;

  before(() => {
    const tmpDb = path.join(os.tmpdir(), `hc-dash-${process.pid}.sqlite`);
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    delete require.cache[require.resolve("../app/server")];
    const { createApp } = require("../app/server");
    app = createApp();
  });

  it("returns dashboard aggregates without scores", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    const res = await agent.get("/api/employer/dashboard");
    assert.equal(res.status, 200);
    assert.ok(res.body.companyName);
    assert.ok(res.body.kpis);
    assert.ok(Array.isArray(res.body.needs));
    assert.ok(res.body.funnel);
    assert.equal(res.body.test_score, undefined);
  });
});
