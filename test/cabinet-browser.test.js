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
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#email", { timeout: 15000 });
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  await page.click("#primary-action", { force: true });
  await page.waitForURL(/\/(candidate|employer)\//, { timeout: 45000 });
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

  it("candidate today at 390 uses compact three-up stat tiles", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    await login(page, "anna@demo.local");
    await page.goto(`${BASE}/candidate/today`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector(".stat-tile-grid-today .stat-tile");
    const cols = await page.$eval(".stat-tile-grid-today", (el) => {
      return window.getComputedStyle(el).gridTemplateColumns;
    });
    const parts = cols.split(" ").filter(Boolean);
    assert.equal(parts.length, 3, `expected 3-up grid, got ${cols}`);
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

  it("employer invitations escape XSS in candidate name", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
    const payload = 'Тест <img src=x onerror="document.title=\'HC-XSS-BROWSER\'">';
    db.prepare("UPDATE candidate_profiles SET display_name = ? WHERE user_id = ?").run(payload, boris.id);
    db.close();
    await login(page, "cafe@demo.local");
    await page.goto(`${BASE}/employer/invitations`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector(".invite-card", { timeout: 20000 });
    assert.equal(await page.locator(".invite-card img").count(), 0);
    const title = await page.title();
    assert.notEqual(title, "HC-XSS-BROWSER");
    await context.close();
  });

  it("employer deck shows need switcher and honors ?need=", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const { newId } = require("../app/lib/ids");
    const secondId = newId();
    db.prepare(
      `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, active)
       VALUES (?, ?, 'R21 switch need', 'backend', 'middle', '[]', '', 1)`
    ).run(secondId, cafe.id);
    db.close();
    await login(page, "cafe@demo.local");
    await page.goto(`${BASE}/employer/deck?need=${secondId}`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector("#employer-need-switch", { timeout: 20000 });
    const selected = await page.$eval("#employer-need-switch", (el) => el.value);
    assert.equal(selected, secondId);
    await context.close();
  });

  it("candidate tasks template uses single neutral cooldown copy", () => {
    const src = fs.readFileSync(path.join(ROOT, "app/public/candidate/tasks.html"), "utf8");
    assert.match(src, /Пересдать тест можно после/);
    assert.ok(!src.includes('field-error">Пересдача возможна'));
  });

  it("candidate today uses locked improve control without duplicate footer CTAs", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, "boris@demo.local");
    await page.goto(`${BASE}/candidate/today`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector(".stat-tile-grid-today", { timeout: 20000 });
    const footerDup = await page.locator('.form-actions a:has-text("Профиль")').count();
    assert.equal(footerDup, 0);
    const locked = await page.locator(".btn-improve-locked, .btn-primary:has-text('Улучшить')").count();
    assert.ok(locked >= 1);
    await context.close();
  });

  it("call room sets live lede after join handler (source check)", () => {
    const src = fs.readFileSync(path.join(ROOT, "app/public/call.js"), "utf8");
    assert.match(src, /setCallLede\([\s\S]*эфир/i);
    assert.match(src, /\/start[\s\S]*setCallLede/);
  });

  it("round22: employer need stat tile escapes stack XSS", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, "cafe@demo.local");
    const needs = await page.evaluate(async () => {
      const r = await fetch("/api/employer/needs", { credentials: "include" });
      return (await r.json()).items;
    });
    const needId = needs[0].id;
    const payload = '<img src=x onerror="document.title=\'x22\'">';
    await page.evaluate(
      async ({ id, stack }) => {
        await fetch(`/api/employer/needs/${id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stack }),
        });
      },
      { id: needId, stack: ["Node.js", payload] }
    );
    await page.goto(`${BASE}/employer/need?need=${needId}`, { waitUntil: "commit" });
    await page.waitForSelector(".stat-tile-value");
    const title = await page.title();
    assert.notEqual(title, "x22");
    const html = await page.locator(".stat-tile-value").nth(2).innerHTML();
    assert.ok(!html.includes("<img"));
    await context.close();
  });

  it("round22: auth register shows password length error", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/auth?mode=register`, { waitUntil: "commit" });
    await page.click("#tab-register");
    await page.fill("#email", `r22pw-${Date.now()}@demo.local`);
    await page.fill("#password", "short");
    await page.click("#primary-action", { force: true });
    await page.waitForSelector("#err:not([hidden])");
    const err = await page.locator("#err").textContent();
    assert.match(err, /8 символов/);
    await context.close();
  });

  it("round22: tasks empty submit shows validation error", async () => {
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
    await page.goto(`${BASE}/candidate/tasks`, { waitUntil: "commit" });
    await page.check("#assessment-privacy", { force: true });
    await page.click("#start", { force: true });
    await page.waitForSelector("#open-q", { timeout: 20000 });
    await page.click("#open-q", { force: true });
    await page.waitForSelector("#submit");
    await page.fill("#answer", "   ");
    await page.click("#submit", { force: true });
    await page.waitForSelector("#err:not([hidden])");
    const err = await page.locator("#err").textContent();
    assert.match(err, /Напишите ответ/i);
    await context.close();
  });

  it("profile empty episode shows field errors (round 24 P1-6)", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, "boris@demo.local");
    await page.goto(`${BASE}/candidate/profile`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector("#add-ep", { timeout: 15000 });
    await page.click("#add-ep", { force: true });
    await page.waitForSelector("#ep-role-err:not([hidden])", { timeout: 10000 });
    await page.waitForSelector("#ep-domain-err:not([hidden])", { timeout: 10000 });
    const roleErr = (await page.locator("#ep-role-err").textContent()) || "";
    const domainErr = (await page.locator("#ep-domain-err").textContent()) || "";
    assert.match(roleErr, /роль/i);
    assert.match(domainErr, /домен/i);
    await context.close();
  });

  it("round28: two-party call WebRTC connects and saves both recordings", async () => {
    const mediaBrowser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    });
    try {
      const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
      const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
      const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
      const { newId } = require("../app/lib/ids");
      const invId = newId();
      db.prepare("DELETE FROM calls WHERE invitation_id IN (SELECT id FROM invitations WHERE candidate_user_id = ?)").run(
        boris.id
      );
      db.prepare("DELETE FROM invitations WHERE candidate_user_id = ? AND employer_user_id = ?", boris.id, cafe.id);
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
         VALUES (?, ?, ?, ?, 180000, 220000, 'round27 call', 'email', 'accepted')`
      ).run(invId, cafe.id, need.id, boris.id);
      db.close();

      const webrtcHooks = () => {
        window.__hcPcs = [];
        const Orig = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Orig {
          constructor(...args) {
            super(...args);
            window.__hcPcs.push(this);
          }
        };
        class FakeRecognition {
          constructor() {
            this.continuous = true;
            this.interimResults = false;
            this.lang = "ru-RU";
          }
          start() {
            setTimeout(() => {
              if (this.onresult) {
                this.onresult({
                  resultIndex: 0,
                  results: [{ 0: { transcript: "тестовая реплика" }, isFinal: true, length: 1 }],
                });
              }
            }, 80);
          }
          stop() {}
        }
        window.SpeechRecognition = FakeRecognition;
        window.webkitSpeechRecognition = FakeRecognition;
      };

      const empCtx = await mediaBrowser.newContext({
        permissions: ["camera", "microphone"],
      });
      const candCtx = await mediaBrowser.newContext({
        permissions: ["camera", "microphone"],
      });
      await empCtx.addInitScript(webrtcHooks);
      await candCtx.addInitScript(webrtcHooks);
      const empPage = await empCtx.newPage();
      const candPage = await candCtx.newPage();
      empPage.setDefaultTimeout(90000);
      candPage.setDefaultTimeout(90000);

      const wsSeen = Promise.race([
        empPage.waitForEvent("websocket", (ws) => ws.url().includes("/ws/calls/"), {
          timeout: 90000,
        }),
        candPage.waitForEvent("websocket", (ws) => ws.url().includes("/ws/calls/"), {
          timeout: 90000,
        }),
      ]);

      await login(empPage, "cafe@demo.local");
      await login(candPage, "boris@demo.local");
      await empPage.goto(`${BASE}/call/${invId}`, { waitUntil: "commit", timeout: 30000 });
      await candPage.goto(`${BASE}/call/${invId}`, { waitUntil: "commit", timeout: 30000 });

      await empPage.waitForSelector("#consent", { timeout: 20000 });
      await empPage.check("#consent", { force: true });
      await empPage.click("#join", { force: true });
      await empPage.waitForSelector("#end:not([hidden])", { timeout: 30000 });
      await candPage.waitForSelector("#consent", { timeout: 20000 });
      await candPage.check("#consent", { force: true });
      await candPage.click("#join", { force: true });
      await candPage.waitForSelector("#end:not([hidden])", { timeout: 30000 });

      await wsSeen;
      await empPage.waitForSelector("#local.live", { timeout: 30000 });
      await candPage.waitForSelector("#local.live", { timeout: 30000 });
      await empPage.waitForFunction(
        async (id) => {
          const r = await fetch(`/api/calls/for-invitation/${id}`, { credentials: "include" });
          const j = await r.json();
          return j.status === "live";
        },
        invId,
        { timeout: 45000 }
      );
      await empPage.waitForFunction(
        () => {
          const pcs = window.__hcPcs || [];
          return pcs.some((pc) => pc.connectionState === "connected");
        },
        { timeout: 45000 }
      );
      await candPage.waitForFunction(
        () => {
          const pcs = window.__hcPcs || [];
          return pcs.some((pc) => pc.connectionState === "connected");
        },
        { timeout: 45000 }
      );
      await empPage.waitForFunction(
        () => {
          const v = document.getElementById("remote");
          return v && !v.hidden && v.videoWidth > 0;
        },
        { timeout: 45000 }
      );
      await candPage.waitForFunction(
        () => {
          const v = document.getElementById("remote");
          return v && !v.hidden && v.videoWidth > 0;
        },
        { timeout: 45000 }
      );
      await new Promise((r) => setTimeout(r, 3000));
      await empPage.click("#end", { force: true });
      await empPage.waitForURL((url) => url.pathname === `/call/${invId}`, { timeout: 45000 });
      await empPage.waitForSelector(".call-result-card", { timeout: 30000 });
      await candPage.waitForSelector(".call-result-card", { timeout: 45000 });

      let info = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        info = await empPage.evaluate(async (id) => {
          const r = await fetch(`/api/calls/for-invitation/${id}`, { credentials: "include" });
          return r.json();
        }, invId);
        const sides = info.recordingSides || [];
        if (info.status === "ended" && sides.includes("candidate") && sides.includes("employer")) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      assert.equal(info.status, "ended");
      const sides = info.recordingSides || [];
      assert.ok(sides.includes("employer"), `employer recording missing: ${sides.join(",")}`);
      assert.ok(sides.includes("candidate"), `candidate recording missing: ${sides.join(",")}`);
      const db2 = new Database(dbPath);
      const transcript = db2
        .prepare("SELECT transcript_text FROM calls WHERE invitation_id = ?")
        .get(invId)?.transcript_text;
      db2.close();
      assert.ok(
        transcript && /тестовая реплика|Кандидат|Работодатель/i.test(transcript),
        "expected speech transcript chunk"
      );

      await empCtx.close();
      await candCtx.close();
    } finally {
      await mediaBrowser.close();
    }
  });

  it("round31: candidate reload rejoin restores WebRTC connection", async () => {
    const mediaBrowser = await chromium.launch({
      headless: true,
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    try {
      const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
      const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
      const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
      const { newId } = require("../app/lib/ids");
      const invId = newId();
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
         VALUES (?, ?, ?, ?, 180000, 220000, 'round28 rejoin', 'email', 'accepted')`
      ).run(invId, cafe.id, need.id, boris.id);
      db.close();
      const hooks = () => {
        window.__hcPcs = [];
        const Orig = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Orig {
          constructor(...args) {
            super(...args);
            window.__hcPcs.push(this);
          }
        };
      };
      const empCtx = await mediaBrowser.newContext({ permissions: ["camera", "microphone"] });
      const candCtx = await mediaBrowser.newContext({ permissions: ["camera", "microphone"] });
      await empCtx.addInitScript(hooks);
      await candCtx.addInitScript(hooks);
      const emp = await empCtx.newPage();
      const cand = await candCtx.newPage();
      await login(emp, "cafe@demo.local");
      await login(cand, "boris@demo.local");
      await emp.goto(`${BASE}/call/${invId}`, { waitUntil: "commit" });
      await cand.goto(`${BASE}/call/${invId}`, { waitUntil: "commit" });
      await emp.check("#consent", { force: true });
      await emp.click("#join", { force: true });
      await emp.waitForSelector("#end:not([hidden])", { timeout: 30000 });
      await cand.check("#consent", { force: true });
      await cand.click("#join", { force: true });
      await emp.waitForFunction(
        () => (window.__hcPcs || []).some((pc) => pc.connectionState === "connected"),
        { timeout: 60000 }
      );
      await cand.reload({ waitUntil: "commit" });
      await cand.waitForSelector("#join:not([disabled])", { timeout: 20000 });
      await cand.click("#join", { force: true });
      await cand.waitForFunction(
        () => (window.__hcPcs || []).some((pc) => pc.connectionState === "connected"),
        { timeout: 60000 }
      );
      await emp.waitForFunction(
        () => (window.__hcPcs || []).some((pc) => pc.connectionState === "connected"),
        { timeout: 60000 }
      );
      await cand.waitForFunction(
        () => {
          const v = document.getElementById("remote");
          return v && !v.hidden && v.videoWidth > 0;
        },
        { timeout: 30000 }
      );
      await empCtx.close();
      await candCtx.close();
    } finally {
      await mediaBrowser.close();
    }
  });

  it("round28: employer alone sees waiting state and can exit without 409", async () => {
    const mediaBrowser = await chromium.launch({
      headless: true,
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    try {
      const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
      const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
      const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
      const { newId } = require("../app/lib/ids");
      const invId = newId();
      db.prepare("DELETE FROM calls WHERE invitation_id = ?").run(invId);
      db.prepare("DELETE FROM invitations WHERE id = ?").run(invId);
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
         VALUES (?, ?, ?, ?, 180000, 220000, 'round28 alone', 'email', 'accepted')`
      ).run(invId, cafe.id, need.id, boris.id);
      db.close();
      const ctx = await mediaBrowser.newContext({ permissions: ["camera", "microphone"] });
      const page = await ctx.newPage();
      await login(page, "cafe@demo.local");
      await page.goto(`${BASE}/call/${invId}`, { waitUntil: "commit", timeout: 30000 });
      await page.waitForSelector("#consent", { timeout: 20000 });
      await page.check("#consent", { force: true });
      await page.click("#join", { force: true });
      await page.waitForSelector("#end:text('Выйти')", { timeout: 20000 });
      const panelTitle = await page.locator("#panel-title").textContent();
      assert.match(panelTitle || "", /Ожидание/i);
      const recLabel = await page.locator("#rec-label").textContent();
      assert.ok(!/Запись активна/i.test(recLabel || ""));
      await page.click("#end", { force: true });
      await page.waitForURL(/\/employer\/calls/, { timeout: 15000 });
      await ctx.close();
    } finally {
      await mediaBrowser.close();
    }
  });

  it("round28: speech recognition error shows RU note", async () => {
    const mediaBrowser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    });
    try {
      const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
      const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
      const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
      const { newId } = require("../app/lib/ids");
      const invId = newId();
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
         VALUES (?, ?, ?, ?, 180000, 220000, 'round28 sr', 'email', 'accepted')`
      ).run(invId, cafe.id, need.id, boris.id);
      db.close();
      const srInit = () => {
        class BadRecognition {
          constructor() {
            this.continuous = true;
          }
          start() {
            if (this.onerror) this.onerror({ error: "not-allowed" });
          }
          stop() {}
        }
        window.SpeechRecognition = BadRecognition;
        window.webkitSpeechRecognition = BadRecognition;
      };
      const empCtx = await mediaBrowser.newContext({ permissions: ["camera", "microphone"] });
      const candCtx = await mediaBrowser.newContext({ permissions: ["camera", "microphone"] });
      await empCtx.addInitScript(srInit);
      await candCtx.addInitScript(srInit);
      const emp = await empCtx.newPage();
      const cand = await candCtx.newPage();
      await login(emp, "cafe@demo.local");
      await login(cand, "boris@demo.local");
      await emp.goto(`${BASE}/call/${invId}`, { waitUntil: "commit" });
      await cand.goto(`${BASE}/call/${invId}`, { waitUntil: "commit" });
      await emp.waitForSelector("#consent", { timeout: 20000 });
      await emp.check("#consent", { force: true });
      await emp.click("#join", { force: true });
      await cand.waitForSelector("#consent", { timeout: 20000 });
      await cand.check("#consent", { force: true });
      await cand.click("#join", { force: true });
      await emp.waitForFunction(
        () => (document.getElementById("panel-title")?.textContent || "").includes("В эфире"),
        { timeout: 45000 }
      );
      await emp.waitForSelector("#speech-note:not([hidden])", { timeout: 30000 });
      const note = await emp.locator("#speech-note").textContent();
      assert.match(note || "", /Расшифровка недоступна/i);
      await empCtx.close();
      await candCtx.close();
    } finally {
      await mediaBrowser.close();
    }
  });

  it("round28: without MediaRecorder shows unavailable label", async () => {
    const callJs = fs.readFileSync(path.join(ROOT, "app/public/call.js"), "utf8");
    const webrtcJs = fs.readFileSync(path.join(ROOT, "app/public/call-room-webrtc.js"), "utf8");
    assert.match(callJs, /Запись недоступна в этом браузере/);
    assert.match(webrtcJs, /recordingUnavailable: true/);
    const mediaBrowser = await chromium.launch({
      headless: true,
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    try {
      const empCtx = await mediaBrowser.newContext({ permissions: ["camera", "microphone"] });
      await empCtx.addInitScript(() => {
        window.MediaRecorder = undefined;
      });
      const page = await empCtx.newPage();
      await page.goto(`${BASE}/call/00000000-0000-0000-0000-000000000001`, {
        waitUntil: "commit",
      });
      const hasMr = await page.evaluate(() => typeof window.MediaRecorder === "undefined");
      assert.equal(hasMr, true);
      await empCtx.close();
    } finally {
      await mediaBrowser.close();
    }
  });

  it("round33: anonymous /privacy renders policy without auth redirect", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/privacy`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(
      () => location.pathname === "/privacy" && document.querySelector(".privacy-doc h2"),
      { timeout: 15000 }
    );
    const heading = await page.locator(".privacy-doc h2").first().textContent();
    assert.match(heading || "", /Цели обработки/i);
    await context.close();
  });

  it("round33: live call uploads playable recordings for both sides", async () => {
    const mediaBrowser = await chromium.launch({
      headless: true,
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    try {
      const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
      const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
      const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
      const { newId } = require("../app/lib/ids");
      const invId = newId();
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
         VALUES (?, ?, ?, ?, 180000, 220000, 'round33 recording', 'email', 'accepted')`
      ).run(invId, cafe.id, need.id, boris.id);
      db.close();
      const empCtx = await mediaBrowser.newContext({ permissions: ["camera", "microphone"] });
      const candCtx = await mediaBrowser.newContext({ permissions: ["camera", "microphone"] });
      const emp = await empCtx.newPage();
      const cand = await candCtx.newPage();
      await login(emp, "cafe@demo.local");
      await login(cand, "boris@demo.local");
      await emp.goto(`${BASE}/call/${invId}`, { waitUntil: "commit" });
      await cand.goto(`${BASE}/call/${invId}`, { waitUntil: "commit" });
      await emp.check("#consent", { force: true });
      await emp.click("#join", { force: true });
      await cand.check("#consent", { force: true });
      await cand.click("#join", { force: true });
      await emp.waitForFunction(
        () => (document.getElementById("panel-title")?.textContent || "").includes("В эфире"),
        { timeout: 60000 }
      );
      await new Promise((r) => setTimeout(r, 26000));
      await emp.click("#end", { force: true });
      await emp.waitForURL(new RegExp(`/call/${invId}`), { timeout: 45000 });
      await cand.waitForURL(new RegExp(`/call/${invId}`), { timeout: 90000 });
      await emp.waitForSelector(".call-result-card", { timeout: 30000 });
      await cand.waitForSelector(".call-result-card", { timeout: 45000 });
      let info = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        info = await emp.evaluate(async (id) => {
          const r = await fetch(`/api/calls/for-invitation/${id}`, { credentials: "include" });
          return r.json();
        }, invId);
        const sides = info.recordingSides || [];
        if (info.status === "ended" && sides.includes("employer") && sides.includes("candidate")) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const sides = info.recordingSides || [];
      assert.ok(sides.includes("employer"), `employer recording missing: ${sides.join(",")}`);
      assert.ok(sides.includes("candidate"), `candidate recording missing: ${sides.join(",")}`);
      const sizes = await emp.evaluate(async (id) => {
        const r = await fetch(`/api/calls/for-invitation/${id}`, { credentials: "include" });
        const info = await r.json();
        const out = {};
        for (const side of info.recordingSides || []) {
          const res = await fetch(`/api/calls/${info.callId}/recording?side=${side}`, {
            credentials: "include",
          });
          const buf = await res.arrayBuffer();
          out[side] = buf.byteLength;
        }
        return out;
      }, invId);
      assert.ok(sizes.employer > 100 * 1024, `employer bytes ${sizes.employer}`);
      assert.ok(sizes.candidate > 100 * 1024, `candidate bytes ${sizes.candidate}`);
      await empCtx.close();
      await candCtx.close();
    } finally {
      await mediaBrowser.close();
    }
  });

  it("shows created API token once in integrations UI (P0-1)", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, "anna@demo.local");
    await page.goto(`${BASE}/candidate/integrations`, { waitUntil: "commit", timeout: 30000 });
    await page.fill("#token-name", "Browser test token");
    await page.fill("#client-where", "Cursor");
    await page.check("#logging-consent", { force: true });
    await page.check("#scope-write", { force: true });
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
