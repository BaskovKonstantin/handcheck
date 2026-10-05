"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");

describe("session cookie Secure flag", () => {
  let app;
  const tmpDb = path.join(os.tmpdir(), `hc-cookie-${process.pid}.sqlite`);

  before(() => {
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    process.env.APP_BASE_URL = "https://handcheck.baski.pro";
    delete require.cache[require.resolve("../app/server")];
    const { createApp } = require("../app/server");
    app = createApp();
  });

  it("omits Secure on plain HTTP request even when APP_BASE_URL is https", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    const cookie = res.headers["set-cookie"]?.[0] || "";
    assert.ok(cookie.includes("handcheck_sid="));
    assert.ok(!cookie.includes("Secure"), `unexpected Secure: ${cookie}`);
  });

  it("sets Secure when X-Forwarded-Proto is https", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-Proto", "https")
      .send({ email: "cafe@demo.local", password: "demo-demo-demo" });
    const cookie = res.headers["set-cookie"]?.[0] || "";
    assert.ok(cookie.includes("Secure"), `missing Secure: ${cookie}`);
  });
});
