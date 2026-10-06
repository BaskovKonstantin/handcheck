#!/usr/bin/env node
"use strict";

/**
 * Stdio MCP bridge → HandCheck remote Streamable HTTP /mcp
 * Env: HANDCHECK_URL (default http://127.0.0.1:8810), HANDCHECK_TOKEN (hc_…)
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

const base = (process.env.HANDCHECK_URL || "http://127.0.0.1:8810").replace(/\/$/, "");
const token = process.env.HANDCHECK_TOKEN || process.env.HANDCHECK_API_TOKEN;
if (!token) {
  console.error("HANDCHECK_TOKEN is required (Bearer hc_…)");
  process.exit(1);
}

async function main() {
  const client = new Client({ name: "handcheck-mcp-bridge", version: "0.5.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  });
  await client.connect(transport);

  const server = new Server({ name: "handcheck", version: "0.5.0" }, { capabilities: {} });

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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
