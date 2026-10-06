"use strict";

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "https://handcheck.baski.pro";
const PASS = process.env.DEMO_PASSWORD || "demo-demo-demo";
const OUT = process.env.OUT_DIR || path.join(__dirname, "../handcheck-ui/round6/after");

async function login(page, email) {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  await page.click("#login");
  await page.waitForURL(/\/(candidate|employer)\//, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);
}

async function shot(page, name, w) {
  await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
  const file = path.join(OUT, `${name}-${w}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  console.log("wrote", file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ["--disable-http2", "--disable-remote-fonts"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  await login(page, "anna@demo.local");
  for (const w of [1280, 390]) {
    await page.goto(`${BASE}/candidate/today`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await shot(page, "cand-today", w);
  }
  await page.goto(`${BASE}/candidate/invitations`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await shot(page, "cand-invitations", 1280);

  await context.clearCookies();
  await login(page, "cafe@demo.local");
  await page.goto(`${BASE}/employer/deck`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await shot(page, "emp-deck", 390);
  await page.goto(`${BASE}/employer/calls`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await shot(page, "emp-calls", 1280);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
