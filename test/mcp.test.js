"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

describe("MCP HTTP", () => {
  let app;
  let server;
  let baseUrl;
  let createApiToken;
  const tmpDb = path.join(os.tmpdir(), `hc-mcp-${process.pid}-${Date.now()}.sqlite`);

  before(async () => {
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
    ({ createApiToken } = require("../app/lib/api-tokens"));
    const { createApp } = require("../app/server");
    app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}/mcp`;
  });

  after(() => {
    if (server) server.close();
  });

  it("lists tools and whoami for candidate token", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const anna = db.prepare("SELECT id, email FROM users WHERE email = 'anna@demo.local'").get();
    const { token } = createApiToken(anna.id, "MCP test", ["read", "write"]);
    const client = new Client({ name: "test", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    assert.ok(names.includes("whoami"));
    assert.ok(names.includes("get_my_profile"));
    assert.ok(!names.includes("list_needs"));
    const who = await client.callTool({ name: "whoami", arguments: {} });
    const text = who.content.find((c) => c.type === "text")?.text || "";
    assert.match(text, new RegExp(anna.email));
    await transport.close();
  });

  it("employer token exposes deck tools only for employer", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const { token } = createApiToken(cafe.id, "Employer MCP", ["read"]);
    const client = new Client({ name: "test-emp", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    assert.ok(names.includes("list_needs"));
    assert.ok(names.includes("get_next_candidate"));
    assert.ok(!names.includes("get_my_profile"));
    await transport.close();
  });

  it("candidate token gets readable error on employer tool via wrong role path", async () => {
    const { getDb } = require("../app/db");
    const db = getDb();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const { token } = createApiToken(anna.id, "Anna read", ["read"]);
    const client = new Client({ name: "test", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(!tools.tools.some((t) => t.name === "list_needs"));
    await transport.close();
  });
});
