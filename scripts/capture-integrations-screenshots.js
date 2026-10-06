"use strict";

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = process.env.OUT_DIR || path.join(__dirname, "../handcheck-ui/mcp-integrations");
const PASS = process.env.DEMO_PASSWORD || "demo-demo-demo";

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  process.env.DB_PATH = path.join(OUT, "shot.sqlite");
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = PASS;
  const { createApp } = require("../app/server");
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.APP_BASE_URL = base;

  const browser = await chromium.launch({ headless: true });
  for (const [email, suffix, name] of [
    ["anna@demo.local", "/candidate/integrations", "candidate-integrations"],
    ["cafe@demo.local", "/employer/integrations", "employer-integrations"],
  ]) {
    const page = await browser.newPage();
    await page.goto(`${base}/auth`);
    await page.fill("#email", email);
    await page.fill("#password", PASS);
    await page.click("#primary-action");
    await page.waitForURL(/\/(candidate|employer)\//, { timeout: 15000 });
    await page.goto(`${base}${suffix}`);
    await page.waitForSelector("#main .panel", { timeout: 15000 });
    for (const w of [1280, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      const file = path.join(OUT, `${name}-${w}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(file);
    }
    await page.close();
  }
  await browser.close();
  await new Promise((r) => server.close(r));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
