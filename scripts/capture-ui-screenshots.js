"use strict";

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = process.env.OUT_DIR || "/opt/cursor/artifacts/screenshots/round3-after";
const BASE = process.env.BASE_URL || "http://127.0.0.1:8810";
const PASS = process.env.DEMO_PASSWORD || "demo-demo-demo";

async function shot(page, name, w) {
  await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
  const file = path.join(OUT, `${name}-${w}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("wrote", file);
}

async function login(page, email) {
  await page.goto(`${BASE}/auth`);
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  await page.click("#login");
  await page.waitForTimeout(900);
}

async function captureSet(page, prefix, routes) {
  for (const w of [1280, 390]) {
    for (const { slug, url, wait } of routes) {
      await page.goto(`${BASE}${url}`);
      await page.waitForTimeout(wait || 700);
      await shot(page, `${prefix}-${slug}`, w);
    }
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await captureSet(page, "01", [{ slug: "landing", url: "/" }]);
  await captureSet(page, "02", [{ slug: "auth", url: "/auth" }]);

  await login(page, "anna@demo.local");
  await captureSet(page, "03", [
    { slug: "today", url: "/candidate/today", wait: 900 },
    { slug: "profile", url: "/candidate/profile", wait: 900 },
    { slug: "invitations", url: "/candidate/invitations", wait: 700 },
    { slug: "calls", url: "/candidate/calls", wait: 700 },
  ]);

  await context.clearCookies();
  await login(page, "cafe@demo.local");
  await captureSet(page, "04", [
    { slug: "deck", url: "/employer/deck", wait: 900 },
    { slug: "list", url: "/employer/list", wait: 700 },
    { slug: "invitations", url: "/employer/invitations", wait: 700 },
    { slug: "calls", url: "/employer/calls", wait: 700 },
  ]);

  const needsRes = await context.request.get(`${BASE}/api/employer/needs`);
  const needs = await needsRes.json();
  const needId = needs.items[0]?.id;
  const deckRes = await context.request.get(`${BASE}/api/employer/needs/${needId}/deck/next`);
  const deck = await deckRes.json();
  if (deck.candidateId) {
    await context.request.post(`${BASE}/api/employer/invitations`, {
      data: {
        needId,
        candidateId: deck.candidateId,
        salaryFrom: 120000,
        salaryTo: 180000,
        offerText: "Демо-оффер для скриншота комнаты",
        contactChannel: "telegram",
      },
      headers: { "Content-Type": "application/json" },
    });
  }
  await context.clearCookies();
  await login(page, "anna@demo.local");
  const invRes = await context.request.get(`${BASE}/api/candidate/invitations`);
  const inv = await invRes.json();
  const pending = (inv.items || []).find((i) => i.status === "sent" || i.status === "viewed");
  if (pending) {
    await context.request.post(`${BASE}/api/candidate/invitations/${pending.id}/accept`);
    for (const w of [1280, 390]) {
      await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
      await page.goto(`${BASE}/call/${pending.id}`);
      await page.waitForTimeout(800);
      await shot(page, "05-call-room", w);
    }
  } else {
    console.log("skip call room — no invitation to accept");
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
