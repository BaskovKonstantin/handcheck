"use strict";

const { chromium } = require("playwright");
const path = require("path");

const OUT = process.env.OUT_DIR || "/opt/cursor/artifacts/screenshots/after";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8810";

async function shot(page, name, w) {
  await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
  const file = path.join(OUT, `${name}-${w}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("wrote", file);
}

async function login(page, email) {
  await page.goto(`${BASE}/auth`);
  await page.fill("#email", email);
  await page.fill("#password", "demo-demo-demo");
  await page.click("#login");
  await page.waitForTimeout(800);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const w of [1280, 390]) {
    await page.goto(BASE + "/");
    await page.waitForTimeout(400);
    await shot(page, "01-landing", w);
  }

  await login(page, "cafe@demo.local");
  for (const w of [1280, 390]) {
    await page.goto(`${BASE}/employer/deck`);
    await page.waitForTimeout(600);
    await shot(page, "03-deck", w);
  }

  await context.clearCookies();
  await login(page, "anna@demo.local");
  for (const w of [1280, 390]) {
    await page.goto(`${BASE}/candidate/today`);
    await page.waitForTimeout(500);
    await shot(page, "04-today", w);
    await page.goto(`${BASE}/candidate/invitations`);
    await page.waitForTimeout(500);
    await shot(page, "05-invitations", w);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
