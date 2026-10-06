"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://127.0.0.1:8810";
const OUT = path.join(__dirname, "..", "handcheck-ui", "round9", "after");

async function login(page, email) {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", "demo-demo-demo");
  await page.click("#primary-action");
  await page.waitForTimeout(1200);
}

async function shot(page, name, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.waitForTimeout(600);
  const file = path.join(OUT, `${name}-${width}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("wrote", file);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await login(page, "cafe@demo.local");
  for (const w of [1280, 390]) {
    await page.goto(`${BASE}/employer/deck`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await shot(page, "emp-deck", w);
    await page.goto(`${BASE}/employer/invitations`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await shot(page, "emp-invitations", w);
  }

  await login(page, "anna@demo.local");
  for (const w of [1280, 390]) {
    await page.goto(`${BASE}/candidate/calls`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await shot(page, "cand-calls", w);
    await page.goto(`${BASE}/candidate/tasks`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await shot(page, "cand-tasks", w);
  }

  await browser.close();
})();
