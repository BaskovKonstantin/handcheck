#!/usr/bin/env node
"use strict";

const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "handcheck-ui", "mcp-integrations");
const BASE = process.env.HC_SHOT_BASE || "http://127.0.0.1:8810";
const PASS = process.env.DEMO_PASSWORD || "demo-demo-demo";

async function main() {
  const fs = require("fs");
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${BASE}/auth`, { waitUntil: "commit" });
  await page.fill("#email", "anna@demo.local");
  await page.fill("#password", PASS);
  await page.click("#primary-action", { force: true });
  await page.waitForURL(/\/candidate\//, { timeout: 20000, waitUntil: "commit" });
  await page.goto(`${BASE}/candidate/integrations`, { waitUntil: "commit" });
  await page.waitForSelector("h1", { timeout: 15000 });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(OUT, "candidate-integrations-1280.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(OUT, "candidate-integrations-390.png"), fullPage: true });

  await browser.close();
  console.log("Saved to", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
