"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
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
      ["/candidate/tasks", ".empty-state, .choice-chip, textarea, .battery-steps"],
      ["/candidate/calls", ".stat-tile, .invite-card, .empty-state"],
      ["/candidate/invitations", ".invite-card, .empty-state"],
      ["/candidate/profile", ".panel, #displayName, .episode-list"],
      ["/candidate/integrations", "#create-token, .token-list"],
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
      ["/employer/need", "#need-select, #title, .stat-tile"],
      ["/employer/deferred", ".stat-tile, .empty-state, .invite-card"],
    ];
    for (const [path, sel] of routes) {
      const p = await context.newPage();
      await assertCabinetPage(p, path, sel, "cafe@demo.local");
      await p.close();
    }
    await context.close();
  });

  it("mobile Ещё menu reaches every employer nav item at 390", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    await login(page, "cafe@demo.local");
    const paths = [
      "/employer/deck",
      "/employer/need",
      "/employer/invitations",
      "/employer/calls",
      "/employer/list",
      "/employer/deferred",
      "/employer/profile",
      "/employer/integrations",
    ];
    for (const path of paths) {
      if (!["/employer/deck", "/employer/need", "/employer/invitations", "/employer/calls"].includes(path)) {
        await page.goto(`${BASE}/employer/deck`, { waitUntil: "commit" });
        await page.click("#cabinet-more");
        await page.waitForSelector("#cabinet-more-sheet:not([hidden])");
        await page.evaluate((p) => {
          const link = document.querySelector(`#cabinet-more-sheet a[href="${p}"]`);
          link?.click();
        }, path);
        await page.waitForURL(`**${path}`, { timeout: 15000 });
      } else {
        await page.goto(`${BASE}${path}`, { waitUntil: "commit" });
      }
      assert.equal(new URL(page.url()).pathname, path);
      assert.ok(await page.locator("#cabinet-aside").count());
    }
    await context.close();
  });

  it("integrations page uses step layout and aligned consent checkbox", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, "anna@demo.local");
    await page.goto(`${BASE}/candidate/integrations`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector(".integrations-steps");
    const consentBox = await page.locator("label.consent-option").boundingBox();
    const consentInput = await page.locator("#logging-consent").boundingBox();
    assert.ok(consentBox && consentInput);
    assert.ok(consentInput.x >= consentBox.x - 2);
    assert.ok(consentInput.x < consentBox.x + consentBox.width * 0.35);
    await context.close();
  });

  it("candidate today hides room CTA when only ended calls exist", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invId = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status, created_at)
       VALUES (?, ?, ?, ?, 200000, 250000, 't', 'email', 'accepted', datetime('now'))`
    ).run(invId, cafe.id, need.id, anna.id);
    db.prepare("DELETE FROM calls WHERE invitation_id = ?").run(invId);
    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, ended_at) VALUES (?, ?, 'ended', datetime('now'))`
    ).run(newId(), invId);
    db.close();
    await login(page, "anna@demo.local");
    await page.goto(`${BASE}/candidate/today`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector(".stat-tile-grid-today");
    const callsValue = await page.locator(".stat-tile-ink .stat-tile-value").textContent();
    assert.equal(callsValue.trim(), "0");
    const roomBtn = page.locator('.timeline-section a:has-text("Комната")');
    assert.equal(await roomBtn.count(), 0);
    await context.close();
  });

  it("candidate today at 390 stacks stat tiles in one column", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    await login(page, "anna@demo.local");
    await page.goto(`${BASE}/candidate/today`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector(".stat-tile-grid-today .stat-tile");
    const cols = await page.$eval(".stat-tile-grid-today", (el) => {
      return window.getComputedStyle(el).gridTemplateColumns;
    });
    assert.ok(!cols.includes("110px"), `expected single-column grid, got ${cols}`);
    const tileCount = await page.locator(".stat-tile-grid-today .stat-tile").count();
    assert.equal(tileCount, 3);
    await context.close();
  });

  it("ended call room updates hero lede", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, "cafe@demo.local");
    const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    let row = db
      .prepare(
        `SELECT i.id AS invitation_id FROM invitations i
         JOIN calls c ON c.invitation_id = i.id
         WHERE c.status = 'ended' LIMIT 1`
      )
      .get();
    if (!row?.invitation_id) {
      const { newId } = require("../app/lib/ids");
      const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
      const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
      const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
      const invId = newId();
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
         VALUES (?, ?, ?, ?, 100000, 120000, 'browser', 'email', 'accepted')`
      ).run(invId, cafe.id, need.id, boris.id);
      const callId = newId();
      db.prepare(
        `INSERT INTO calls (id, invitation_id, status, ended_at, transcript_text)
         VALUES (?, ?, 'ended', datetime('now'), 'демо')`
      ).run(callId, invId);
      row = { invitation_id: invId };
    }
    db.close();
    assert.ok(row?.invitation_id, "need ended call in seed");
    await page.goto(`${BASE}/call/${row.invitation_id}`, { waitUntil: "commit" });
    await page.waitForSelector(".call-result-card", { timeout: 20000 });
    const lede = await page.locator(".call-room-hero .lede").textContent();
    assert.match(lede || "", /закрыта|итог/i);
    await page.waitForSelector(".call-result-card");
    await page.waitForSelector("#cabinet-aside");
    await context.close();
  });

  it("candidate tasks start form hides battery steps and labels Backend without скоро", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
    db.prepare(
      "UPDATE batteries SET completed_at = datetime('now') WHERE candidate_user_id = ? AND completed_at IS NULL"
    ).run(boris.id);
    db.close();
    await login(page, "boris@demo.local");
    await page.goto(`${BASE}/candidate/tasks`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector('.choice-chip[data-choice="backend"]', { timeout: 20000 });
    assert.equal(await page.locator(".battery-steps").count(), 0);
    const text = (await page.locator('.choice-chip[data-choice="backend"]').textContent()) || "";
    assert.ok(!/скоро/i.test(text), `backend chip should not say скоро: ${text}`);
    await context.close();
  });

  it("candidate today does not list finished calls in upcoming steps", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    await login(page, "boris@demo.local");
    await page.goto(`${BASE}/candidate/today`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector(".timeline-section", { timeout: 15000 });
    const ended = page.locator('.timeline-section:has-text("завершён")');
    assert.equal(await ended.count(), 0);
    await context.close();
  });

  it("call room sets live lede after join handler (source check)", () => {
    const src = fs.readFileSync(path.join(ROOT, "app/public/call.js"), "utf8");
    assert.match(src, /setCallLede\([\s\S]*эфир/i);
    assert.match(src, /\/start[\s\S]*setCallLede/);
  });

  it("shows created API token once in integrations UI (P0-1)", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, "anna@demo.local");
    await page.goto(`${BASE}/candidate/integrations`, { waitUntil: "commit", timeout: 30000 });
    await page.fill("#token-name", "Browser test token");
    await page.fill("#client-where", "Cursor");
    await page.check("#logging-consent");
    await page.check("#scope-write");
    await page.click("#create-token", { force: true });
    await page.waitForFunction(() => {
      const raw = document.getElementById("token-raw");
      return raw && raw.textContent.startsWith("hc_");
    });
    const token = await page.locator("#token-raw").textContent();
    assert.match(token, /^hc_/);
    await context.close();
  });
});
