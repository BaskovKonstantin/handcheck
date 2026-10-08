"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");

describe("demo-login quick entry", () => {
  let app;
  const tmpDb = path.join(os.tmpdir(), `hc-demo-login-${process.pid}.sqlite`);

  before(() => {
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    process.env.SESSION_SECRET = "test-session-secret";
    for (const key of Object.keys(require.cache)) {
      if (key.includes(`${path.sep}app${path.sep}`)) delete require.cache[key];
    }
    const { createApp } = require("../app/server");
    app = createApp();
  });

  it("logs in first demo employer and candidate", async () => {
    const emp = await request(app).post("/api/auth/demo-login").send({ role: "employer" });
    assert.equal(emp.status, 200);
    assert.equal(emp.body.user.role, "employer");
    assert.match(emp.body.user.email, /@demo\.local$/i);

    const cand = await request(app).post("/api/auth/demo-login").send({ role: "candidate" });
    assert.equal(cand.status, 200);
    assert.equal(cand.body.user.role, "candidate");
    assert.match(cand.body.user.email, /@demo\.local$/i);
  });

  it("rejects invalid role", async () => {
    const res = await request(app).post("/api/auth/demo-login").send({ role: "admin" });
    assert.equal(res.status, 400);
  });

  it("GET / serves login gate, not marketing landing", async () => {
    const res = await request(app).get("/");
    assert.equal(res.status, 200);
    assert.match(res.text, /Войти как работодатель/);
    assert.match(res.text, /Войти как соискатель/);
    assert.doesNotMatch(res.text, /Начать бесплатно/);
  });

  it("GET /auth redirects to /", async () => {
    const res = await request(app).get("/auth");
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/");
  });
});
