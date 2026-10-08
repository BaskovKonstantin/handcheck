"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const PASS = "demo-demo-demo";
const PASTE_120 =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
let PORT = "";
let BASE = "";
let serverProc;
let browser;
let setupCache = null;

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not become healthy");
}

async function login(page, email) {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  await page.click("#primary-action", { force: true });
  await page.waitForURL(/\/(candidate|employer)\//, { timeout: 45000 });
}

function assertNoHorizontalScroll(page, label) {
  return page
    .evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    .then((overflow) => assert.equal(overflow, false, `horizontal scroll on ${label}`));
}

async function employerSeedInviteWithTest(page) {
  if (setupCache) return setupCache;
  await login(page, "cafe@demo.local");
  await page.goto(`${BASE}/employer/need`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof HandCheck !== "undefined" && HandCheck.api, { timeout: 20000 });
  setupCache = await page.evaluate(async () => {
    const needs = await HandCheck.api("/api/employer/needs");
    const needId = needs.items[0].id;
    const created = await HandCheck.api("/api/employer/tests", {
      method: "POST",
      body: JSON.stringify({ needId, templateKey: "backend-api-basics" }),
    });
    await HandCheck.api(`/api/employer/tests/${created.id}/publish`, { method: "POST", body: "{}" });
    const matches = await HandCheck.api(`/api/employer/needs/${needId}/matches`);
    const anna = (matches.items || []).find((x) => x.displayName === "Анна");
    if (!anna) throw new Error("anna not in pool");
    const inv = await HandCheck.api("/api/employer/invitations", {
      method: "POST",
      body: JSON.stringify({
        needId,
        candidateId: anna.id,
        salaryFrom: 120000,
        salaryTo: 180000,
        offerText: "Browser flow invite",
        contactChannel: "telegram",
        employerTestId: created.id,
      }),
    });
    return {
      invitationId: inv.id,
      testId: created.id,
    };
  });
  const annaPage = await browser.newPage();
  await login(annaPage, "anna@demo.local");
  await annaPage.goto(`${BASE}/candidate/tasks`, { waitUntil: "domcontentloaded" });
  await annaPage.waitForFunction(() => typeof HandCheck !== "undefined" && HandCheck.api, {
    timeout: 20000,
  });
  const assignmentId = await annaPage.evaluate(async (invitationId) => {
    await HandCheck.api(`/api/candidate/invitations/${invitationId}/accept`, {
      method: "POST",
      body: "{}",
    });
    const list = await HandCheck.api("/api/candidate/company-tests");
    const row = (list.items || []).find((x) => x.status === "assigned") || (list.items || [])[0];
    return row?.id || null;
  }, setupCache.invitationId);
  await annaPage.close();
  setupCache = { ...setupCache, assignmentId };
  if (!setupCache?.assignmentId) throw new Error("assignment not created after accept");
  return setupCache;
}

async function employerSeedSingleTextTest(page) {
  await login(page, "cafe@demo.local");
  await page.goto(`${BASE}/employer/need`, { waitUntil: "domcontentloaded" });
  const seed = await page.evaluate(async (pasteText) => {
    const needs = await HandCheck.api("/api/employer/needs");
    const needId = needs.items[0].id;
    const created = await HandCheck.api("/api/employer/tests", {
      method: "POST",
      body: JSON.stringify({ needId, title: "Paste probe", intro: "" }),
    });
    await HandCheck.api(`/api/employer/tests/${created.id}/items`, {
      method: "POST",
      body: JSON.stringify({
        kind: "text",
        prompt: "Опишите REST",
        rubricKeys: { keywords: ["api", "rest"] },
        timeLimitSec: 300,
      }),
    });
    await HandCheck.api(`/api/employer/tests/${created.id}/publish`, { method: "POST", body: "{}" });
    const matches = await HandCheck.api(`/api/employer/needs/${needId}/matches`);
    const anna = (matches.items || []).find((x) => x.displayName === "Анна");
    const inv = await HandCheck.api("/api/employer/invitations", {
      method: "POST",
      body: JSON.stringify({
        needId,
        candidateId: anna.id,
        salaryFrom: 120000,
        salaryTo: 180000,
        offerText: "Paste probe invite",
        contactChannel: "telegram",
      }),
    });
    return { invitationId: inv.id, testId: created.id, candidateId: anna.id, pasteText };
  }, PASTE_120);
  const annaPage = await browser.newPage();
  await login(annaPage, "anna@demo.local");
  await annaPage.goto(`${BASE}/candidate/tasks`, { waitUntil: "domcontentloaded" });
  await annaPage.waitForFunction(() => typeof HandCheck !== "undefined" && HandCheck.api, {
    timeout: 20000,
  });
  await annaPage.evaluate(async (invitationId) => {
    await HandCheck.api(`/api/candidate/invitations/${invitationId}/accept`, {
      method: "POST",
      body: "{}",
    });
  }, seed.invitationId);
  await annaPage.close();
  const assignmentId = await page.evaluate(async ({ testId, candidateId, invitationId }) => {
    const assign = await HandCheck.api(`/api/employer/tests/${testId}/assign`, {
      method: "POST",
      body: JSON.stringify({ candidateId, invitationId }),
    });
    return assign.id;
  }, seed);
  return { assignmentId, pasteText: seed.pasteText };
}

async function completeCompanyTestOnPage(page, assignmentId) {
  await page.click(`button[data-assignment-id="${assignmentId}"][data-company-test-action="assigned"]`);
  await page.waitForSelector("#company-test-active", { timeout: 30000 });
  for (let step = 0; step < 12; step += 1) {
    await page.waitForTimeout(350);
    const finalBtn = page.locator("#company-test-final-submit");
    if (await finalBtn.isVisible().catch(() => false)) {
      await finalBtn.click();
      await page.waitForTimeout(600);
      return;
    }
    const submit = page.locator("#company-test-answer-submit");
    if (!(await submit.isVisible().catch(() => false))) continue;
    const radios = page.locator('input[name="ct-choice"][type="radio"]');
    if (await radios.count()) await radios.first().check({ force: true });
    const checks = page.locator('input[name="ct-choice"][type="checkbox"]');
    const n = await checks.count();
    for (let j = 0; j < n; j += 1) await checks.nth(j).check({ force: true });
    const ta = page.locator("#company-test-answer");
    if (await ta.isVisible().catch(() => false)) {
      await ta.fill("ответ API 404 not found return status конфликт");
    }
    await submit.click();
  }
  throw new Error("company test UI did not finish");
}

describe("employer tests UI", { skip: !process.env.RUN_BROWSER }, () => {
  before(async () => {
    const tmpDb = path.join(ROOT, "data", `browser-emp-tests-${Date.now()}.sqlite`);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = PASS;
    PORT = String(8800 + Math.floor(Math.random() * 200));
    BASE = `http://127.0.0.1:${PORT}`;
    serverProc = spawn("node", ["app/server.js"], {
      cwd: ROOT,
      env: { ...process.env, PORT },
      stdio: "pipe",
    });
    await waitForHealth();
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
    serverProc?.kill("SIGTERM");
  });

  it("employer tests constructor at 1280px", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await login(page, "cafe@demo.local");
    await page.goto(`${BASE}/employer/tests`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-template-create='backend-api-basics']", { timeout: 45000 });
    await page.click("[data-template-create='backend-api-basics']");
    await page.waitForSelector(".employer-tests-editor", { timeout: 45000 });
    await assertNoHorizontalScroll(page, "employer-tests-constructor-1280");
    await page.close();
  });

  it("candidate take and employer review at 390px without horizontal overflow", async () => {
    const setupPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const { assignmentId } = await employerSeedInviteWithTest(setupPage);
    await setupPage.close();

    const anna = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(anna, "anna@demo.local");
    await anna.goto(`${BASE}/candidate/tasks`, { waitUntil: "domcontentloaded" });
    await anna.waitForSelector("#company-tests-panel", { timeout: 45000 });
    await anna.waitForSelector(`button[data-assignment-id="${assignmentId}"]`, { timeout: 30000 });
    await completeCompanyTestOnPage(anna, assignmentId);
    await anna.waitForFunction(
      async (aid) => {
        const list = await HandCheck.api("/api/candidate/company-tests");
        const row = (list.items || []).find((x) => x.id === aid);
        return row?.status === "submitted";
      },
      assignmentId,
      { timeout: 30000 }
    );
    await assertNoHorizontalScroll(anna, "candidate-take-390");
    await anna.close();

    const employer = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(employer, "cafe@demo.local");
    await employer.goto(`${BASE}/employer/invitations`, { waitUntil: "domcontentloaded" });
    await employer.waitForSelector(`[data-review-test="${assignmentId}"]`, { timeout: 45000 });
    const [reviewResp] = await Promise.all([
      employer.waitForResponse(
        (r) => r.url().includes(`/api/employer/test-assignments/${assignmentId}`) && r.ok(),
        { timeout: 30000 }
      ),
      employer.click(`[data-review-test="${assignmentId}"]`),
    ]);
    const reviewJson = await reviewResp.json();
    assert.ok(reviewJson.items?.length > 0, "review API returned items");
    assert.equal(reviewJson.statusLabel, "Сдан");
    await employer.waitForFunction(
      (aid) => {
        const panel = document.getElementById(`review-${aid}`);
        return Boolean(panel && !panel.hidden && panel.querySelector(".employer-test-preview-card"));
      },
      assignmentId,
      { timeout: 20000 }
    );
    const hasMark = await employer.locator(".employer-test-review-panel .status-pill").count();
    assert.ok(hasMark > 0, "expected per-question review marks");
    await assertNoHorizontalScroll(employer, "employer-review-390");
    await employer.close();
  });

  it("records paste vs typing for employer review paste chip", async () => {
    const setupPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const { assignmentId } = await employerSeedSingleTextTest(setupPage);
    await setupPage.close();

    const anna = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(anna, "anna@demo.local");
    await anna.goto(`${BASE}/candidate/tasks`, { waitUntil: "domcontentloaded" });
    await anna.waitForSelector(`button[data-assignment-id="${assignmentId}"]`, { timeout: 30000 });
    await anna.click(`button[data-assignment-id="${assignmentId}"][data-company-test-action="assigned"]`);
    await anna.waitForSelector("#company-test-answer", { timeout: 30000 });
    const ta = anna.locator("#company-test-answer");
    await anna.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await anna.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, PASTE_120);
    await ta.click();
    await anna.keyboard.press("Control+V");
    await ta.pressSequentially(" rest api", { delay: 20 });
    await anna.click("#company-test-answer-submit");
    await anna.click("#company-test-final-submit");
    await anna.close();

    const employer = await browser.newPage();
    await login(employer, "cafe@demo.local");
    const review = await employer.evaluate(async (aid) => {
      return HandCheck.api(`/api/employer/test-assignments/${aid}`);
    }, assignmentId);
    const textItem = (review.items || []).find((x) => x.kind === "text");
    assert.ok(textItem.pasteChars >= 100, `expected paste chars, got ${textItem.pasteChars}`);
    assert.ok(textItem.typedChars > 0, "expected typed chars");
    assert.ok(textItem.pasteInputMark?.label === "Вставка");
    await employer.close();
  });
});
