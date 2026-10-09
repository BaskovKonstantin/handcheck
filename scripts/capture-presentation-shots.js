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