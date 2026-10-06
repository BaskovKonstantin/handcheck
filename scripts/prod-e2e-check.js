"use strict";

/**
 * Round 4 prod smoke — functional checks + screenshot paths.
 * BASE_URL=https://handcheck.baski.pro node scripts/prod-e2e-check.js
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "https://handcheck.baski.pro";
const PASS = process.env.DEMO_PASSWORD || "demo-demo-demo";
const OUT = process.env.OUT_DIR || path.join(__dirname, "../handcheck-ui/round4/prod-before");

const issues = [];

function fail(msg) {
  issues.push({ severity: "fail", msg });
  console.error("FAIL:", msg);
}

function warn(msg) {
  issues.push({ severity: "warn", msg });
  console.warn("WARN:", msg);
}

async function login(page, email) {
  await goto(`${BASE}/auth`);
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  await page.click("#login");
  await page.waitForURL(/\/(candidate|employer)\//, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function apiJson(context, method, url, body) {
  const opts = { method };
  if (body) {
    opts.data = body;
    opts.headers = { "Content-Type": "application/json" };
  }
  const res = await context.request.fetch(`${BASE}${url}`, opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status(), json };
}

async function shot(page, name, w) {
  await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
  const file = path.join(OUT, `${name}-${w}.png`);
  await page.screenshot({ path: file, fullPage: true, timeout: 60000, animations: "disabled" });
  return file;
}

async function checkNoHorizontalScroll(page, label) {
  const overflow = await page.evaluate(() => {
    const sw = document.documentElement.scrollWidth;
    const cw = document.documentElement.clientWidth;
    return sw > cw + 2;
  });
  if (overflow) fail(`${label}: horizontal scroll at ${page.viewportSize().width}px`);
}

async function checkForbiddenNumbers(page, label) {
  const text = await page.locator("main, .cabinet-main, body").first().innerText().catch(() => "");
  if (/\b(test_score|integrity|рейтинг)\b/i.test(text)) warn(`${label}: suspicious score wording`);
  if (/\b\d{1,2}\.\d{2}\b/.test(text) && /балл|score|rank/i.test(text)) {
    warn(`${label}: possible numeric rating in UI`);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ["--disable-http2", "--disable-remote-fonts"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(60000);
  const goto = (url) => page.goto(url, { waitUntil: "domcontentloaded" });

  const health = await context.request.get(`${BASE}/api/health`);
  if (health.status() !== 200) fail(`/api/health status ${health.status()}`);
  else console.log("health OK");

  for (const w of [1280, 390]) {
    await goto(`${BASE}/`);
    await page.waitForTimeout(800);
    await shot(page, "01-landing", w);
    await checkNoHorizontalScroll(page, "landing");
    const h1 = await page.locator("h1").first().innerText();
    if (!h1.includes("Категория по навыку")) fail(`landing h1 wrong: ${h1}`);
  }

  await login(page, "anna@demo.local");
  const meAnna = await apiJson(context, "GET", "/api/me");
  if (meAnna.status !== 200 || meAnna.json.role !== "candidate") fail("anna login /api/me");

  for (const route of [
    "/candidate/today",
    "/candidate/past",
    "/candidate/tasks",
    "/candidate/invitations",
    "/candidate/calls",
    "/candidate/profile",
  ]) {
    const res = await context.request.get(`${BASE}${route}`);
    if (res.status() !== 200) fail(`${route} HTTP ${res.status()}`);
  }

  const cat = await apiJson(context, "GET", "/api/candidate/category");
  if (cat.status === 200 && cat.json.label) {
    console.log("anna category:", cat.json.label);
  }

  const invAnna = await apiJson(context, "GET", "/api/candidate/invitations");
  const catBody = JSON.stringify(invAnna.json);
  if (/integrity|test_score|motivation/.test(catBody)) fail("candidate invitations leak private fields");

  for (const w of [1280, 390]) {
    await goto(`${BASE}/candidate/today`);
    await page.waitForTimeout(700);
    await shot(page, "02-candidate-today", w);
    await checkNoHorizontalScroll(page, "candidate/today");
    await checkForbiddenNumbers(page, "candidate/today");
  }

  await context.clearCookies();
  await login(page, "cafe@demo.local");

  for (const route of [
    "/employer/need",
    "/employer/deck",
    "/employer/list",
    "/employer/deferred",
    "/employer/invitations",
    "/employer/calls",
    "/employer/profile",
  ]) {
    const res = await context.request.get(`${BASE}${route}`);
    if (res.status() !== 200) fail(`${route} HTTP ${res.status()}`);
  }

  const needs = await apiJson(context, "GET", "/api/employer/needs");
  const needId = needs.json.items?.[0]?.id;
  if (!needId) fail("cafe has no need");

  const matches = await apiJson(context, "GET", `/api/employer/needs/${needId}/matches`);
  if (matches.status !== 200) fail(`matches ${matches.status}`);
  const matchBody = JSON.stringify(matches.json);
  if (/test_score|integrity/.test(matchBody)) fail("matches API leaks scores");

  const deck = await apiJson(context, "GET", `/api/employer/needs/${needId}/deck/next`);
  if (deck.status === 200 && deck.json.candidateId) {
    console.log("deck candidate:", deck.json.displayName || deck.json.candidateId);
    const expl = deck.json.explanation || "";
    if (/\d/.test(expl)) warn("deck explanation contains digits");
  }

  for (const w of [1280, 390]) {
    await goto(`${BASE}/employer/deck`);
    await page.waitForTimeout(900);
    await shot(page, "03-employer-deck", w);
    await checkNoHorizontalScroll(page, "employer/deck");
    const hasPhoto = await page.locator("img.avatar, .deck-card img[src*='face']").count();
    if (hasPhoto > 0) fail("deck shows avatar photo");
  }

  const listFiltered = await context.request.get(
    `${BASE}/employer/list?stack=node&fsp=1`
  );
  if (listFiltered.status() !== 200) fail("employer list with query");

  const pendingInv = (invAnna.json.items || []).find((i) => i.status === "sent" || i.status === "viewed");
  let callInvitationId = pendingInv?.id;

  if (!callInvitationId) {
    const accepted = (invAnna.json.items || []).find((i) => i.status === "accepted");
    callInvitationId = accepted?.id;
  }

  if (!callInvitationId && deck.json?.candidateId) {
    const invRes = await apiJson(context, "POST", "/api/employer/invitations", {
      needId,
      candidateId: deck.json.candidateId,
      salaryFrom: 130000,
      salaryTo: 190000,
      offerText: "Round 4 E2E invite",
      contactChannel: "email",
    });
    if (invRes.status === 201 || invRes.status === 200) {
      callInvitationId = invRes.json.id;
      console.log("created invite", callInvitationId);
    } else if (invRes.status === 409) {
      console.log("invite skipped:", invRes.json.error);
    } else {
      warn(`invite POST ${invRes.status} ${JSON.stringify(invRes.json)}`);
    }
  }

  if (callInvitationId) {
    await context.clearCookies();
    await login(page, "anna@demo.local");
    const invList2 = await apiJson(context, "GET", "/api/candidate/invitations");
    const row = (invList2.json.items || []).find((i) => i.id === callInvitationId);
    if (row && (row.status === "sent" || row.status === "viewed")) {
      await apiJson(context, "POST", `/api/candidate/invitations/${callInvitationId}/accept`);
    }

    for (const w of [1280, 390]) {
      await goto(`${BASE}/call/${callInvitationId}`);
      await page.waitForTimeout(800);
      await shot(page, "04-call-room", w);
      await checkNoHorizontalScroll(page, "call room");
      const joinBtn = page.locator("#join-call, button:has-text('Войти')").first();
      const disabled = await joinBtn.isDisabled().catch(() => false);
      if (!disabled) fail("call room: Войти active without consent checkbox");
      const consent = page.locator('input[type="checkbox"]').first();
      if (await consent.isVisible()) {
        const checked = await consent.isChecked();
        if (checked) fail("call room: consent pre-checked without server consent");
      }
    }

    const callInfo = await apiJson(context, "GET", `/api/calls/for-invitation/${callInvitationId}`);
    if (callInfo.status === 403) fail("call for-invitation 403 after accept");
  } else {
    warn("no invitation for call room check");
  }

  await browser.close();

  const outPath = path.join(OUT, "issues.json");
  fs.writeFileSync(outPath, JSON.stringify(issues, null, 2));
  console.log("\nIssues:", issues.length, "written", outPath);
  if (issues.some((i) => i.severity === "fail")) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
