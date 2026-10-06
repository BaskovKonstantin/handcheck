"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { hashToken, generateTokenMaterial } = require("../app/lib/api-token");
const { newId } = require("../app/lib/ids");

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-tok-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  return { app: createApp(), tmpDb };
}

describe("API tokens", () => {
  let app;
  let tmpDb;

  before(() => {
    ({ app, tmpDb } = freshApp());
  });

  after(() => {
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  it("stores only hash and supports revoke + scopes", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "anna@demo.local",
      password: "demo-demo-demo",
    });
    const created = await agent.post("/api/integrations/tokens").send({
      name: "Test read",
      scopes: ["read"],
      clientWhere: "Cursor",
      loggingConsent: true,
    });
    assert.equal(created.status, 201);
    assert.match(created.body.token, /^hc_/);
    const { getDb } = require("../app/db");
    const db = getDb();
    const row = db.prepare("SELECT token_hash FROM api_tokens WHERE id = ?").get(created.body.id);
    assert.equal(row.token_hash, hashToken(created.body.token));
    assert.notEqual(row.token_hash, created.body.token);

    const list = await agent.get("/api/integrations/tokens");
    assert.equal(list.body.items.length, 1);
    await agent.delete(`/api/integrations/tokens/${created.body.id}`);
    const mcp = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${created.body.token}`)
      .send({ jsonrpc: "2.0", method: "initialize", params: {}, id: 1 });
    assert.equal(mcp.status, 401);
  });

  it("read-only token cannot use REST API (P0-2)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "anna@demo.local",
      password: "demo-demo-demo",
    });
    const created = await agent.post("/api/integrations/tokens").send({
      name: "read REST",
      scopes: ["read"],
      clientWhere: "Claude Desktop",
      loggingConsent: true,
    });
    const res = await request(app)
      .get("/api/candidate/profile")
      .set("Authorization", `Bearer ${created.body.token}`);
    assert.equal(res.status, 403);
  });

  it("write scope required for mutating MCP tools", async () => {
    const { raw, hash } = generateTokenMaterial();
    const { getDb } = require("../app/db");
    const db = getDb();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const id = newId();
    db.prepare(
      `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes_json)
       VALUES (?, ?, 'read only', ?, 'hc_test…', '["read"]')`
    ).run(id, anna.id, hash);

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${raw}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "start_assessment", arguments: { specialization: "backend", grade: "middle" } },
      });
    assert.ok([200, 400].includes(res.status));
    if (res.status === 200) {
      const text = res.text;
      assert.match(text, /scope|прав/i);
    }
  });

  it("employer token cannot call candidate-only profile read as wrong role isolation", async () => {
    const { raw, hash } = generateTokenMaterial();
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    db.prepare(
      `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes_json)
       VALUES (?, ?, 'cafe', ?, 'hc_cafe…', '["read","write"]')`
    ).run(newId(), cafe.id, hash);
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${raw}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: {},
      });
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /get_my_profile/);
  });
});
