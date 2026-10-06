"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://127.0.0.1:8810";
const OUT = path.join(__dirname, "..", "handcheck-ui", "round10", "after");

async function login(page, email) {
  await page.goto(`${BASE}/auth`, { waitUntil: "commit" });
  await page.fill("#email", email);
  await page.fill("#password", "demo-demo-demo");
  await page.click("#primary-action", { force: true });
  await page.waitForURL(/\/(candidate|employer)\//, { timeout: 20000 });
}

async function waitLoaded(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".skeleton-card").length === 0 &&
      document.querySelector("#cabinet-aside") &&
      !document.querySelector(".cabinet-email-skeleton"),
    { timeout: 15000 }
  );
}

async function shot(page, name, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.waitForTimeout(400);
  const file = path.join(OUT, `${name}-${width}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("wrote", file);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await login(page, "anna@demo.local");
  for (const w of [1280, 390]) {
    for (const [route, name] of [
      ["/candidate/today", "cand-today"],
      ["/candidate/tasks", "cand-tasks"],
      ["/candidate/calls", "cand-calls"],
    ]) {
      await page.goto(`${BASE}${route}`, { waitUntil: "commit" });
      await waitLoaded(page);
      await shot(page, name, w);
    }
  }

  await context.clearCookies();
  await login(page, "cafe@demo.local");
  for (const w of [1280, 390]) {
    for (const [route, name] of [
      ["/employer/invitations", "emp-invitations"],
      ["/employer/list", "emp-list"],
    ]) {
      await page.goto(`${BASE}${route}`, { waitUntil: "commit" });
      await waitLoaded(page);
      await shot(page, name, w);
    }
  }

  await browser.close();
})();
