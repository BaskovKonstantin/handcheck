"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
let PORT = process.env.HC_TEST_PORT || "";
let BASE = "";
const PASS = "demo-demo-demo";
const API_DELAY_MS = 900;

let serverProc;
let browser;

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
  await page.goto(`${BASE}/auth`, { waitUntil: "commit", timeout: 30000 });
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  await page.click("#primary-action", { force: true });
  await page.waitForURL(/\/(candidate|employer)\//, { timeout: 20000 });
}

async function assertCabinetPage(page, urlPath, contentSelector, emailHint) {
  await page.route("**/api/**", async (route) => {
    await new Promise((r) => setTimeout(r, API_DELAY_MS));
    await route.continue();
  });
  await page.goto(`${BASE}${urlPath}`, { waitUntil: "commit", timeout: 30000 });
  try {
    await page.waitForFunction(
      (sel) => {
        const skeletons = document.querySelectorAll(".skeleton-card").length;
        const hits = document.querySelectorAll(sel).length;
        const aside = document.querySelector("#cabinet-aside");
        const email = document.querySelector(".cabinet-user-card .cabinet-email");
        const emailOk =
          email && !email.classList.contains("cabinet-email-skeleton") && email.textContent.includes("@");
        return skeletons === 0 && hits > 0 && aside && emailOk;
      },
      contentSelector,
      { timeout: 20000 }
    );
  } catch (e) {
    const debug = await page.evaluate((sel) => ({
      url: location.pathname,
      skeletons: document.querySelectorAll(".skeleton-card").length,
      hits: document.querySelectorAll(sel).length,
      aside: !!document.querySelector("#cabinet-aside"),
      emailHtml: document.querySelector(".cabinet-user-card .cabinet-email")?.outerHTML || null,
      vw: window.innerWidth,
    }), contentSelector);
    console.error("cabinet page debug", urlPath, debug);
    throw e;
  }
  const email = await page.locator(".cabinet-user-card .cabinet-email").first().textContent();
  assert.ok(email.includes(emailHint), `expected sidebar email ${emailHint}, got ${email}`);
}

const runBrowser = process.env.RUN_BROWSER === "1";

describe("cabinet pages (browser, slow API)", { timeout: 180000, skip: !runBrowser }, () => {
  before(async () => {
    if (!PORT) {
      const srv = require("node:net").createServer();
      await new Promise((resolve, reject) => {
        srv.listen(0, "127.0.0.1", () => {
          PORT = String(srv.address().port);
          srv.close((err) => (err ? reject(err) : resolve()));
        });
      });
    }
    BASE = `http://127.0.0.1:${PORT}`;
    serverProc = spawn("node", ["app/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        DEMO_MODE: "1",
        DEMO_PASSWORD: PASS,
        PORT,
        DB_PATH: path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`),
      },
      stdio: "ignore",
    });
    await waitForHealth();
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    if (browser) await browser.close();
    if (serverProc) serverProc.kill("SIGTERM");
  });

  it("candidate cabinet routes render content and chrome", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, "anna@demo.local");
    const routes = [
      ["/candidate/today", ".stat-tile, .empty-state, .timeline-section"],
      ["/candidate/tasks", ".battery-steps, .empty-state, .choice-chip, textarea"],
      ["/candidate/calls", ".stat-tile, .invite-card, .empty-state"],
      ["/candidate/invitations", ".invite-card, .empty-state"],
      ["/candidate/profile", ".panel, #displayName, .episode-list"],
    ];
    for (const [path, sel] of routes) {
      const p = await context.newPage();
      await assertCabinetPage(p, path, sel, "anna@demo.local");
      await p.close();
    }
    await context.close();
  });

  it("employer cabinet routes render content and chrome", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, "cafe@demo.local");
    const routes = [
      ["/employer/deck", "#deck-card:not([hidden]), .empty-state .empty-title"],
      ["/employer/invitations", ".stat-tile, .invite-card, .empty-state"],
      ["/employer/list", ".list-row-card, .empty-state"],
      ["/employer/calls", ".invite-card, .empty-state, .stat-tile"],
      ["/employer/need", ".panel, .form-field, .empty-state"],
      ["/employer/deferred", ".stat-tile, .empty-state, .invite-card"],
    ];
    for (const [path, sel] of routes) {
      const p = await context.newPage();
      await assertCabinetPage(p, path, sel, "cafe@demo.local");
      await p.close();
    }
    await context.close();
  });
});
