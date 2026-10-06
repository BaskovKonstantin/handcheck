#!/usr/bin/env node
"use strict";

/**
 * Stdio MCP bridge → HandCheck remote /mcp (Streamable HTTP).
 * Env: HANDCHECK_MCP_URL (default http://127.0.0.1:8810/mcp), HANDCHECK_API_TOKEN (hc_…)
 */

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

async function main() {
  const url = process.env.HANDCHECK_MCP_URL || "http://127.0.0.1:8810/mcp";
  const token = process.env.HANDCHECK_API_TOKEN || process.env.HANDCHECK_TOKEN;
  if (!token || !String(token).startsWith("hc_")) {
    process.stderr.write(
      "Set HANDCHECK_API_TOKEN to a personal token (hc_…) from the Integrations page.\n"
    );
    process.exit(1);
  }

  const client = new Client({ name: "handcheck-mcp-bridge", version: "0.5.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
  await client.connect(transport);

  const server = new Server(
    { name: "handcheck-mcp", version: "0.5.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => client.listTools());
  server.setRequestHandler(CallToolRequestSchema, (req) =>
    client.callTool({ name: req.params.name, arguments: req.params.arguments || {} })
  );
  server.setRequestHandler(ListResourcesRequestSchema, () => client.listResources());
  server.setRequestHandler(ReadResourceRequestSchema, (req) =>
    client.readResource({ uri: req.params.uri })
  );
  server.setRequestHandler(ListPromptsRequestSchema, () => client.listPrompts());
  server.setRequestHandler(GetPromptRequestSchema, (req) =>
    client.getPrompt({ name: req.params.name, arguments: req.params.arguments || {} })
  );

  const stdio = new StdioServerTransport();
  await server.connect(stdio);
}

main().catch((err) => {
  process.stderr.write(`${err?.message || err}\n`);
  process.exit(1);
});
