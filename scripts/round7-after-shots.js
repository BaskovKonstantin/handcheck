"use strict";

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8810";
const PASS = process.env.DEMO_PASSWORD || "demo-demo-demo";
const OUT = process.env.OUT_DIR || path.join(__dirname, "../handcheck-ui/round7/after");

async function login(page, email) {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  await page.click("#primary-action");
  await page.waitForURL(/\/(candidate|employer)\//, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function shot(page, name, w) {
  await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
  const file = path.join(OUT, `${name}-${w}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  console.log("wrote", file);
}

async function visit(page, url, name, widths = [1280, 390]) {
  for (const w of widths) {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await shot(page, name, w);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ["--disable-http2", "--disable-remote-fonts"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await shot(page, "auth", 1280);
  await shot(page, "auth", 390);

  await login(page, "anna@demo.local");
  await visit(page, "/candidate/today", "cand-today");
  await visit(page, "/candidate/profile", "cand-profile");
  await visit(page, "/candidate/tasks", "cand-tasks");

  await context.clearCookies();
  await login(page, "cafe@demo.local");
  await visit(page, "/employer/need", "emp-need");
  await visit(page, "/employer/deferred", "emp-deferred");
  await visit(page, "/employer/invitations", "emp-invitations");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
