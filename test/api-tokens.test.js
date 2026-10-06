"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { hashCode } = require("../app/lib/tokens");

describe("api tokens", () => {
  let app;
  let createApiToken;
  let listApiTokens;
  let revokeApiToken;
  let resolveBearerToken;
  let hasScope;
  const tmpDb = path.join(os.tmpdir(), `hc-tok-${process.pid}-${Date.now()}.sqlite`);

  before(() => {
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    delete require.cache[require.resolve("../app/config")];
    try {
      const { closeDb } = require("../app/db");
      closeDb();
    } catch {
      /* first load */
    }
    delete require.cache[require.resolve("../app/db")];
    delete require.cache[require.resolve("../app/server")];
    delete require.cache[require.resolve("../app/lib/api-tokens")];
    ({
      createApiToken,
      listApiTokens,
      revokeApiToken,
      resolveBearerToken,
      hasScope,
    } = require("../app/lib/api-tokens"));
    const { createApp } = require("../app/server");
    app = createApp();
  });

  it("stores only hash, not plaintext", () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const { token, id } = createApiToken(anna.id, "Test", ["read"]);
    const row = db.prepare("SELECT token_hash FROM api_tokens WHERE id = ?").get(id);
    assert.equal(row.token_hash, hashCode(token));
    assert.notEqual(row.token_hash, token);
  });

  it("revoke prevents bearer resolution", () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const { token, id } = createApiToken(anna.id, "Revoke me", ["read"]);
    assert.ok(resolveBearerToken(`Bearer ${token}`));
    revokeApiToken(anna.id, id);
    assert.equal(resolveBearerToken(`Bearer ${token}`), null);
  });

  it("scopes enforced on integrations create", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "anna@demo.local",
      password: "demo-demo-demo",
    });
    const res = await agent
      .post("/api/integrations/tokens")
      .send({ name: "Cursor", scopes: ["read", "write"] });
    assert.equal(res.status, 201);
    assert.match(res.body.token, /^hc_/);
  });

  it("candidate bearer cannot hit employer-only REST", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const { token } = createApiToken(anna.id, "Anna MCP", ["read", "write"]);
    const res = await request(app)
      .get("/api/employer/needs")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 403);
  });

  it("employer token resolves with role employer", () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const { token } = createApiToken(cafe.id, "Cafe", ["read"]);
    const resolved = resolveBearerToken(`Bearer ${token}`);
    assert.equal(resolved.user.role, "employer");
    assert.ok(hasScope(resolved, "read"));
  });
});
