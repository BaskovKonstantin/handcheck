"use strict";

/**
 * Smoke: integrations pages render for demo users (1280 + 390).
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { chromium } = require("playwright");

function boot() {
  const tmpDb = path.join(os.tmpdir(), `hc-browser-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  process.env.APP_BASE_URL = "http://127.0.0.1:0";
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  const app = createApp();
  const server = http.createServer(app);
  return { server, tmpDb };
}

describe("browser integrations smoke", () => {
  let server;
  let tmpDb;
  let base;

  before(async () => {
    const b = boot();
    server = b.server;
    tmpDb = b.tmpDb;
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    process.env.APP_BASE_URL = base;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  });

  for (const [email, pathSuffix] of [
    ["anna@demo.local", "/candidate/integrations"],
    ["cafe@demo.local", "/employer/integrations"],
  ]) {
    it(`loads ${pathSuffix} at 1280 and 390`, async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(`${base}/auth`);
      await page.fill("#email", email);
      await page.fill("#password", "demo-demo-demo");
      await page.click("#primary-action");
      await page.waitForURL(/\/(candidate|employer)\//, { timeout: 15000 });
      await page.goto(`${base}${pathSuffix}`);
      await page.waitForSelector("h1", { timeout: 15000 });
      const h1 = await page.locator("h1").innerText();
      assert.match(h1, /Интеграции/);
      for (const w of [1280, 390]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForSelector("#main .panel", { timeout: 15000 });
      }
      await browser.close();
    });
  }

  it("shows created token with copy row (P0-1)", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/auth`);
    await page.fill("#email", "anna@demo.local");
    await page.fill("#password", "demo-demo-demo");
    await page.click("#primary-action");
    await page.waitForURL(/\/candidate\//, { timeout: 15000 });
    await page.goto(`${base}/candidate/integrations`);
    await page.waitForSelector("#create-token", { timeout: 15000 });
    await page.fill("#token-name", "Playwright token");
    await page.click("#create-token");
    await page.waitForFunction(() => {
      const raw = document.getElementById("token-raw");
      return raw && /^hc_/.test(raw.textContent || "");
    });
    const snippet = await page.locator("#cursor-snippet").textContent();
    assert.match(snippet, /hc_/);
    await browser.close();
  });
});
