"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const PASS = "demo-demo-demo";
let PORT = "";
let BASE = "";
let serverProc;
let browser;

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not become healthy");
}

async function login(page, email) {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  await page.click("#primary-action", { force: true });
  await page.waitForURL(/\/(candidate|employer)\//, { timeout: 45000 });
}

function assertNoHorizontalScroll(page, label) {
  return page
    .evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    .then((overflow) => assert.equal(overflow, false, `horizontal scroll on ${label}`));
}

describe("employer tests UI", { skip: !process.env.RUN_BROWSER }, () => {
  before(async () => {
    const tmpDb = path.join(ROOT, "data", `browser-emp-tests-${Date.now()}.sqlite`);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = PASS;
    PORT = String(8800 + Math.floor(Math.random() * 200));
    BASE = `http://127.0.0.1:${PORT}`;
    serverProc = spawn("node", ["app/server.js"], {
      cwd: ROOT,
      env: { ...process.env, PORT },
      stdio: "pipe",
    });
    await waitForHealth();
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
    serverProc?.kill("SIGTERM");
  });

  for (const width of [1280, 390]) {
    it(`employer tests constructor at ${width}px`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await login(page, "cafe@demo.local");
      await page.goto(`${BASE}/employer/tests`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("h1", { timeout: 30000 });
      const title = await page.textContent("h1");
      assert.match(title || "", /Тест/i);
      await page.waitForSelector("#root", { timeout: 15000 });
      await assertNoHorizontalScroll(page, `employer-tests-${width}`);
      await page.close();
    });
  }
});
