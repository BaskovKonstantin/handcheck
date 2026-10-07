"use strict";

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "handcheck-ui", "post48-layout-fix", "after");
const BASE = process.env.HC_SCREEN_BASE || "http://127.0.0.1:8811";
const PASS = "demo-demo-demo";

const PAGES = [
  { name: "candidate-today", url: "/candidate/today", auth: "anna@demo.local" },
  { name: "employer-deck", url: "/employer/deck", auth: "cafe@demo.local" },
];

async function login(page, email) {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  await page.click("#primary-action", { force: true });
  await page.waitForURL(/\/(candidate|employer)\//, { timeout: 30000 });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const width of [1280, 390]) {
    for (const p of PAGES) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      if (p.auth) await login(page, p.auth);
      await page.goto(`${BASE}${p.url}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(OUT, `${p.name}-${width}.png`),
        fullPage: true,
      });
      await context.close();
    }
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
