"use strict";

/**
 * Скриншоты экранов для презентации жюри.
 *
 *   node scripts/capture-presentation-shots.js
 *
 * Поднимает временный стенд на чистой БД, проходит демо-вход обоими ролями
 * и складывает PNG в handcheck-ui/presentation/.
 */

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "handcheck-ui", "presentation");
const DB = "/tmp/hc-shots.sqlite";
const PORT = 8813;
const BASE = `http://127.0.0.1:${PORT}`;
const PASS = "demo-demo-demo";

const SHOTS = [
  { role: "guest", path: "/", name: "01-login-gate", full: false },
  { role: "employer", path: "/employer/deck", name: "02-employer-deck", full: true },
  { role: "employer", path: "/employer/list", name: "03-employer-list", full: true },
  { role: "employer", path: "/employer/candidates", name: "04-employer-candidates", full: true },
  { role: "employer", path: "/employer/need", name: "05-employer-need", full: true },
  { role: "employer", path: "/employer/invitations", name: "06-employer-invitations", full: true },
  { role: "employer", path: "/employer/overview", name: "07-employer-overview", full: true },
  { role: "candidate", path: "/candidate/today", name: "08-candidate-today", full: true },
  { role: "candidate", path: "/candidate/invitations", name: "09-candidate-invitations", full: true },
  { role: "candidate", path: "/candidate/tasks", name: "10-candidate-tasks", full: true },
  { role: "candidate", path: "/candidate/past", name: "11-candidate-past", full: true },
  { role: "guest", path: "/", name: "12-login-mobile", viewport: { width: 390, height: 844 }, full: false },
  { role: "candidate", path: "/candidate/today", name: "13-candidate-today-mobile", viewport: { width: 390, height: 844 }, full: false },
];

const EMAILS = { employer: "cafe@demo.local", candidate: "anna@demo.local" };

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* стенд ещё поднимается */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("стенд не поднялся");
}


async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const res = await fetch(`${BASE}${path}`, { method: opts.method || "POST", headers, body: opts.body ? JSON.stringify(opts.body) : undefined, redirect: "manual" });
  const text = await res.text();
  try {
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, json: null };
  }
}

/** Наполняет стенд реальными статусами: приглашения, accept, decline, тест работодателя. */
async function preseed() {
  const login = async (email) => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASS }),
    });
    return (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).find((c) => c.startsWith("handcheck_sid=")) || "";
  };
  const call = (cookie, method, path, body) =>
    api(path, { method, body, headers: { Cookie: cookie, "x-demo-admin": "1" } });

  const emp = await login("cafe@demo.local");
  const anna = await login("anna@demo.local");
  const boris = await login("boris@demo.local");

  const needs = await call(emp, "GET", "/api/employer/needs");
  const need = needs.json?.items?.[0];
  if (!need) return;

  const bank = await call(emp, "GET", "/api/employer/candidates?spec=backend");
  const annaId = (bank.json?.items || []).find((c) => /Анна/i.test(c.displayName || ""))?.id;
  const borisId = (bank.json?.items || []).find((c) => /Борис/i.test(c.displayName || ""))?.id;

  const invAnna = await call(emp, "POST", "/api/employer/invitations", {
    needId: need.id, candidateId: annaId, salaryFrom: 120000, salaryTo: 180000,
    offerText: "Приглашаем в команду: бэкенд на Node.js", contactChannel: "telegram",
  });
  const invBoris = await call(emp, "POST", "/api/employer/invitations", {
    needId: need.id, candidateId: borisId, salaryFrom: 100000, salaryTo: 150000,
    offerText: "Второе приглашение: интеграции и API", contactChannel: "email",
  });
  if (invAnna.json?.invitationId || invAnna.json?.id) {
    await call(anna, "POST", `/api/candidate/invitations/${invAnna.json.invitationId || invAnna.json.id}/accept`, {});
  }
  if (invBoris.json?.invitationId || invBoris.json?.id) {
    await call(boris, "POST", `/api/candidate/invitations/${invBoris.json.invitationId || invBoris.json.id}/decline`, {});
  }

  // короткий тест работодателя для принявшего приглашение
  const test = await call(emp, "POST", "/api/employer/tests", {
    needId: need.id, title: "Скрининг: API и очереди", intro: "Два вопроса на стек потребности",
  });
  const testId = test.json?.id;
  if (!testId) return;
  await call(emp, "POST", `/api/employer/tests/${testId}/items`, {
    kind: "single", prompt: "Что выберет Node.js для очереди задач?",
    options: [{ id: "o1", label: "event loop" }, { id: "o2", label: "thread pool" }],
    answerKey: { correctIds: ["o1"] },
  });
  await call(emp, "POST", `/api/employer/tests/${testId}/items`, {
    kind: "text", prompt: "Опишите схему хранения профиля кандидата",
    rubricKeys: { keywords: ["таблица", "индекс", "кандидат"] },
  });
  await call(emp, "POST", `/api/employer/tests/${testId}/publish`, {});
  await call(emp, "POST", `/api/employer/tests/${testId}/assign`, { candidateId: annaId });
}

async function login(page, email) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const emailInput = page.locator("#email");
  if (await emailInput.count()) {
    // ручной вход по email (панель «Вход по email»)
    await page.locator("details.login-gate-manual summary").click();
    await emailInput.fill(email);
    await page.fill("#password", PASS);
    await page.click("#btn-login");
  } else {
    await page.click(`#btn-${email.startsWith("cafe") ? "employer" : "candidate"}`);
  }
  await page.waitForURL(/\/(candidate|employer)/, { timeout: 20000 });
}

async function main() {
  fs.rmSync(DB, { force: true });
  fs.rmSync(`${DB}-wal`, { force: true });
  fs.rmSync(`${DB}-shm`, { force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const srv = spawn("node", ["app/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DEMO_MODE: "1",
      DEMO_PASSWORD: PASS,
      PORT: String(PORT),
      DB_PATH: DB,
      SESSION_SECRET: "shots-secret",
      APP_BASE_URL: BASE,
    },
    stdio: "ignore",
  });

  let browser;
  try {
    await waitForHealth();
    await preseed();
    browser = await chromium.launch({
      headless: true,
      executablePath: "/usr/bin/google-chrome",
      args: ["--no-sandbox"],
    });

    const contexts = {};
    for (const role of ["employer", "candidate"]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await login(page, EMAILS[role]);
      contexts[role] = ctx;
    }
    const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    for (const shot of SHOTS) {
      const viewport = shot.viewport || { width: 1440, height: 900 };
      const ctx = shot.role === "guest" ? guest : contexts[shot.role];
      const page = await ctx.newPage();
      await page.setViewportSize(viewport);
      await page.goto(`${BASE}${shot.path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2200);
      const file = path.join(OUT, `${shot.name}.png`);
      await page.screenshot({ path: file, fullPage: shot.full });
      console.log(`saved ${path.relative(ROOT, file)}`);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    srv.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});