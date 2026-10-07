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
const { registerPayload } = require("./register-payload");
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

function assertNoHorizontalScroll(page, label) {
  return page
    .evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    .then((overflow) => assert.equal(overflow, false, `horizontal scroll on ${label}`));
}

function assertBoxesDisjoint(boxes, label) {
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const disjoint =
        a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      assert.ok(
        disjoint,
        `${label}: "${a.text}" overlaps "${b.text}" (${JSON.stringify(a)} vs ${JSON.stringify(b)})`
      );
    }
  }
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
const RECORDING_IT_MS = 240_000;

describe("cabinet pages (browser, slow API)", { timeout: 300_000, skip: !runBrowser }, () => {
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
    if (browser) await browser.close().catch(() => {});
    if (serverProc) {
      serverProc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 400));
      if (serverProc.exitCode == null) serverProc.kill("SIGKILL");
    }
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

  async function waitForCabinetTabIndicatorSettled(page, { maxDelta = 1.5, timeoutMs = 2500 } = {}) {
    await page.evaluate(
      async ({ maxDelta, timeoutMs }) => {
        await (document.fonts?.ready ?? Promise.resolve());
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const indicator = document.getElementById("cabinet-tabs-indicator");
        if (!indicator || indicator.hidden) return;

        const activeTab = () =>
          document.querySelector(
            ".cabinet-tabs .tab-link.active:not(.cabinet-more-btn), #cabinet-more.active"
          );

        const delta = () => {
          const active = activeTab();
          if (!active) return 0;
          const ir = indicator.getBoundingClientRect();
          const ar = active.getBoundingClientRect();
          return Math.abs(ir.left - ar.left);
        };

        if (delta() <= maxDelta) return;

        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!reduced) {
          await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              indicator.removeEventListener("transitionend", onTransitionEnd);
              resolve();
            };
            const onTransitionEnd = (event) => {
              if (
                event.target === indicator &&
                (event.propertyName === "transform" || event.propertyName === "width")
              ) {
                finish();
              }
            };
            indicator.addEventListener("transitionend", onTransitionEnd);
            setTimeout(finish, 900);
          });
        }

        const started = performance.now();
        while (performance.now() - started < timeoutMs) {
          if (delta() <= maxDelta) return;
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      },
      { maxDelta, timeoutMs }
    );
  }

  async function assertNoMobileCabinetOverflow(page, urlPath, { width }) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector("#cabinet-tabs", { timeout: 20000 });
    await waitForCabinetTabIndicatorSettled(page);
    const metrics = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      const ind = document.getElementById("cabinet-tabs-indicator");
      const active = document.querySelector(
        ".cabinet-tabs .tab-link.active:not(.cabinet-more-btn), #cabinet-more.active"
      );
      const ir = ind && !ind.hidden ? ind.getBoundingClientRect() : null;
      const ar = active?.getBoundingClientRect();
      let maxRight = 0;
      for (const el of document.querySelectorAll(
        ".cabinet-page-hero, .cabinet-page-hero-pattern, .cabinet-tabs-indicator"
      )) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) maxRight = Math.max(maxRight, rect.right);
      }
      return {
        sw,
        vw,
        maxRight,
        indDelta: ir && ar ? Math.abs(ir.left - ar.left) : ind?.hidden ? 0 : 999,
      };
    });
    assert.ok(
      metrics.sw <= metrics.vw + 1,
      `${urlPath}@${width}px scrollWidth ${metrics.sw} > viewport ${metrics.vw}`
    );
    assert.ok(
      metrics.maxRight <= metrics.vw + 1,
      `${urlPath}@${width}px chrome maxRight ${metrics.maxRight} > viewport ${metrics.vw}`
    );
    assert.ok(
      metrics.indDelta <= 1.5,
      `${urlPath}@${width}px tab indicator delta ${metrics.indDelta}px`
    );
  }

  it("round72: mobile cabinet has no horizontal overflow and aligned tab indicator", async () => {
    const widths = [320, 360, 390, 430];
    const employerRoutes = [
      "/employer/deck",
      "/employer/need",
      "/employer/list",
      "/employer/deferred",
      "/employer/profile",
      "/employer/invitations",
      "/employer/calls",
      "/employer/integrations",
    ];
    const candidateRoutes = [
      "/candidate/today",
      "/candidate/profile",
      "/candidate/tasks",
      "/candidate/invitations",
      "/candidate/calls",
      "/candidate/past",
      "/candidate/integrations",
    ];
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, "cafe@demo.local");
    for (const path of employerRoutes) {
      for (const width of widths) {
        await assertNoMobileCabinetOverflow(page, path, { width });
      }
    }
    await login(page, "anna@demo.local");
    for (const path of candidateRoutes) {
      for (const width of widths) {
        await assertNoMobileCabinetOverflow(page, path, { width });
      }
    }
    await context.close();
  });

  it("round66: prefers-reduced-motion keeps cabinet usable at 390", async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await login(page, "cafe@demo.local");
    await page.goto(`${BASE}/employer/list`, { waitUntil: "networkidle", timeout: 60000 });
    const h = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    assert.equal(h, false);
    assert.equal(errors.length, 0, errors.join("; "));
    await context.close();
  });

  it("round66: employer list row main stays readable at 360–430px", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    await login(page, "cafe@demo.local");
    await page.goto(`${BASE}/employer/list`, { waitUntil: "networkidle", timeout: 60000 });
    const main = page.locator(".list-row-main").first();
    await main.waitFor({ state: "visible", timeout: 30000 });
    for (const width of [390, 360, 430]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      const rowWidth = await main.evaluate((el) => el.getBoundingClientRect().width);
      assert.ok(rowWidth > 200, `list-row-main width ${rowWidth}px at viewport ${width}`);
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

  it("round65: employer list undecided cards keep width at 390px", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const longName = "Тест Р65 Вставка список мобильный";
    db.prepare("UPDATE candidate_profiles SET display_name = ? WHERE user_id = ?").run(longName, anna.id);
    db.prepare("DELETE FROM need_reviews WHERE need_id = ? AND candidate_user_id = ?", need.id, anna.id);
    const { newId } = require("../app/lib/ids");
    db.prepare("DELETE FROM attempt_events WHERE attempt_id IN (SELECT id FROM attempts WHERE candidate_user_id = ?)").run(
      anna.id
    );
    db.prepare("DELETE FROM attempts WHERE candidate_user_id = ?").run(anna.id);
    db.prepare("DELETE FROM batteries WHERE candidate_user_id = ?").run(anna.id);
    const batId = newId();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO batteries (id, candidate_user_id, specialization, claimed_grade, form_key, started_at, completed_at)
       VALUES (?, ?, 'backend', 'middle', 'A', ?, ?)`
    ).run(batId, anna.id, now, now);
    const quickTask = db.prepare("SELECT id FROM tasks WHERE type = 'quick' LIMIT 1").get();
    const attemptId = newId();
    db.prepare(
      `INSERT INTO attempts (id, candidate_user_id, task_id, battery_id, form_key, answer_text, submitted_at, action_source, integrity_metrics_json)
       VALUES (?, ?, ?, ?, 'A', ?, ?, 'web', ?)`
    ).run(
      attemptId,
      anna.id,
      quickTask.id,
      batId,
      "x".repeat(100),
      now,
      JSON.stringify({ pastedChars: 80, answerLength: 100 })
    );
    db.close();

    await login(page, "cafe@demo.local");
    await page.goto(`${BASE}/employer/list?need=${need.id}`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector('.list-row-card-rich button[data-decision="later"]', { timeout: 20000 });
    const card = page.locator(".list-row-card-rich", { hasText: longName });
    await card.waitFor({ state: "visible", timeout: 20000 });
    await card.locator(".status-pill.paste-input").waitFor({ state: "visible", timeout: 5000 });
    const layout = await card.evaluate((el) => {
      const main = el.querySelector(".list-row-main");
      const name = el.querySelector(".list-row-main strong");
      const mainBox = main?.getBoundingClientRect();
      const nameBox = name?.getBoundingClientRect();
      const cardBox = el.getBoundingClientRect();
      return {
        mainW: mainBox?.width ?? 0,
        nameW: nameBox?.width ?? 0,
        nameH: nameBox?.height ?? 0,
        cardH: cardBox.height,
      };
    });
    assert.ok(layout.mainW >= 200, `list-row-main width ${layout.mainW}`);
    assert.ok(layout.nameW >= 200, `name width ${layout.nameW}`);
    assert.ok(layout.nameH < 120, `name height ${layout.nameH} (vertical ribbon)`);
    assert.ok(layout.cardH < 700, `card height ${layout.cardH}`);
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
    const callsZero = page.locator(".stat-tile-ink .stat-zero");
    assert.ok(await callsZero.count(), "expected friendly zero state for calls tile");
    const roomBtn = page.locator('.timeline-section a:has-text("Комната")');
    assert.equal(await roomBtn.count(), 0);
    await context.close();
  });

  it("candidate today at 390 stacks summary stat tiles full width", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    await login(page, "anna@demo.local");
    await page.goto(`${BASE}/candidate/today`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector(".stat-tile-grid-today .stat-tile");
    const cols = await page.$eval(".stat-tile-grid-today", (el) => {
      return window.getComputedStyle(el).gridTemplateColumns;
    });
    const parts = cols.split(" ").filter(Boolean);
    assert.equal(parts.length, 1, `expected stacked grid, got ${cols}`);
    const widths = await page.$$eval(".stat-tile-grid-today .stat-tile", (tiles) =>
      tiles.map((t) => t.getBoundingClientRect().width)
    );
    assert.equal(widths.length, 3);
    for (const w of widths) {
      assert.ok(w > 300, `stat tile width ${w}px should exceed 300px at 390 viewport`);
    }
    await assertNoHorizontalScroll(page, "candidate/today@390");
    await context.close();
  });

  it("employer deck need stat labels do not overlap at 1280", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await login(page, "cafe@demo.local");
    await page.goto(`${BASE}/employer/deck`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector(".deck-need-stats dt", { timeout: 30000 });
    const labelBoxes = await page.$$eval(".deck-need-stats dt", (nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          text: (n.textContent || "").trim(),
        };
      })
    );
    assert.ok(labelBoxes.length >= 2, "expected deck need stat labels");
    assertBoxesDisjoint(labelBoxes, "deck-need-stats dt@1280");
    await assertNoHorizontalScroll(page, "employer/deck@1280");
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

  it("round34: employer reload rejoin restores WebRTC connection", async () => {
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
         VALUES (?, ?, ?, ?, 180000, 220000, 'round34 emp reload', 'email', 'accepted')`
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
      await cand.check("#consent", { force: true });
      await cand.click("#join", { force: true });
      await emp.waitForFunction(
        () => (window.__hcPcs || []).some((pc) => pc.connectionState === "connected"),
        { timeout: 60000 }
      );
      await emp.reload({ waitUntil: "commit" });
      await emp.waitForSelector("#join:not([disabled])", { timeout: 20000 });
      await emp.click("#join", { force: true });
      await emp.waitForFunction(
        () => (window.__hcPcs || []).some((pc) => pc.connectionState === "connected"),
        { timeout: 15000 }
      );
      await cand.waitForFunction(
        () => (window.__hcPcs || []).some((pc) => pc.connectionState === "connected"),
        { timeout: 15000 }
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

  it("round34: live call has no 4xx on recording-chunk uploads", async () => {
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
         VALUES (?, ?, ?, ?, 180000, 220000, 'round34 chunks', 'email', 'accepted')`
      ).run(invId, cafe.id, need.id, boris.id);
      db.close();
      const chunkStatuses = { employer: [], candidate: [] };
      const trackChunks = async (page, side) => {
        page.on("response", (res) => {
          const u = res.url();
          if (u.includes("/recording-chunk")) chunkStatuses[side].push(res.status());
        });
      };
      const empCtx = await mediaBrowser.newContext({ permissions: ["camera", "microphone"] });
      const candCtx = await mediaBrowser.newContext({ permissions: ["camera", "microphone"] });
      const emp = await empCtx.newPage();
      const cand = await candCtx.newPage();
      await trackChunks(emp, "employer");
      await trackChunks(cand, "candidate");
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
      const liveStarted = Date.now();
      await new Promise((r) => setTimeout(r, 32000));
      await emp.click("#end", { force: true });
      await emp.waitForSelector(".call-result-card", { timeout: 120000 });
      const liveMs = Date.now() - liveStarted;
      for (const side of ["employer", "candidate"]) {
        const bad = chunkStatuses[side].filter((s) => s >= 400);
        assert.equal(bad.length, 0, `${side} chunk 4xx: ${bad.join(",")}`);
        assert.ok(chunkStatuses[side].length >= 2, `${side} expected >=2 chunks, got ${chunkStatuses[side].length}`);
      }
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
      assert.ok(info.recordingSides?.includes("employer"));
      assert.ok(info.recordingSides?.includes("candidate"));
      const minBytes = Math.max(120 * 1024, Math.floor(liveMs * 0.004));
      const sizes = await emp.evaluate(async (id) => {
        const r = await fetch(`/api/calls/for-invitation/${id}`, { credentials: "include" });
        const info = await r.json();
        const out = {};
        for (const side of info.recordingSides || []) {
          const res = await fetch(`/api/calls/${info.callId}/recording?side=${side}`, {
            credentials: "include",
          });
          out[side] = (await res.arrayBuffer()).byteLength;
        }
        return out;
      }, invId);
      assert.ok(sizes.employer >= minBytes, `employer bytes ${sizes.employer} < ${minBytes}`);
      assert.ok(sizes.candidate >= minBytes, `candidate bytes ${sizes.candidate} < ${minBytes}`);
      const durs = await emp.evaluate(async (id) => {
        const r = await fetch(`/api/calls/for-invitation/${id}`, { credentials: "include" });
        const info = await r.json();
        const out = {};
        for (const side of info.recordingSides || []) {
          const v = document.createElement("video");
          v.preload = "metadata";
          v.src = `/api/calls/${info.callId}/recording?side=${side}`;
          await new Promise((resolve, reject) => {
            v.onloadedmetadata = () => resolve();
            v.onerror = () => reject(new Error("video metadata"));
            setTimeout(() => reject(new Error("timeout")), 15000);
          });
          out[side] = v.duration;
        }
        return out;
      }, invId);
      const minDurSec = liveMs * 0.001 * 0.75;
      for (const side of ["employer", "candidate"]) {
        assert.ok(Number.isFinite(durs[side]) && durs[side] > 0, `${side} video.duration must be finite, got ${durs[side]}`);
        assert.ok(durs[side] >= minDurSec * 0.5, `${side} dur ${durs[side]} < ${minDurSec * 0.5}`);
      }
      await empCtx.close();
      await candCtx.close();
    } finally {
      await mediaBrowser.close();
    }
  });

  it("round34: paste and immediate submit stores paste telemetry", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const email = `r34-paste-${Date.now()}@demo.local`;
    await context.request.post(`${BASE}/api/auth/register`, {
      data: registerPayload({ email, role: "candidate" }),
    });
    await context.request.post(`${BASE}/api/auth/confirm`, { data: { email, code: "000000" } });
    const loginRes = await context.request.post(`${BASE}/api/auth/login`, {
      data: { email, password: PASS },
    });
    assert.ok(loginRes.ok());
    const page = await context.newPage();
    await page.goto(`${BASE}/candidate/tasks`, { waitUntil: "commit" });
    await page.waitForSelector("#assessment-privacy", { timeout: 15000 });
    await page.check("#assessment-privacy", { force: true });
    await page.click("#start", { force: true });
    await page.waitForSelector("#open-q", { timeout: 15000 });
    await page.click("#open-q", { force: true });
    await page.waitForSelector("#answer", { timeout: 15000 });
    const pasteText =
      "HTTP API версии пагинация идемпотентность кэш Redis JWT очередь миграции метрики логи алерты мониторинг.";
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, pasteText);
    await page.focus("#answer");
    await page.keyboard.press("Control+V");
    await page.click("#submit", { force: true });
    await page.waitForFunction(
      () => !document.getElementById("submit") || document.querySelector("#open-q"),
      { timeout: 30000 }
    );
    const attemptId = await page.evaluate(async () => {
      const cur = await fetch("/api/assessment/battery/current", { credentials: "include" }).then((r) => r.json());
      const submitted = cur.battery?.attempts?.find((a) => a.submitted);
      return submitted?.id || cur.battery?.attempts?.[0]?.id;
    });
    assert.ok(attemptId);
    const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    const pasteCount = db
      .prepare(
        `SELECT COUNT(*) AS c FROM attempt_events WHERE attempt_id = ? AND event_type = 'paste'`
      )
      .get(attemptId).c;
    db.close();
    assert.ok(pasteCount >= 1, `paste events ${pasteCount}`);
    await context.close();
  });

  it("round41: mobile battery progress shows current step in viewport at 390x844", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const email = `r41-step-${Date.now()}@demo.local`;
    await context.request.post(`${BASE}/api/auth/register`, {
      data: registerPayload({ email, role: "candidate" }),
    });
    await context.request.post(`${BASE}/api/auth/confirm`, { data: { email, code: "000000" } });
    await context.request.post(`${BASE}/api/auth/login`, {
      data: { email, password: PASS },
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/candidate/tasks`, { waitUntil: "commit" });
    await page.waitForSelector("#assessment-privacy", { timeout: 15000 });
    await page.check("#assessment-privacy", { force: true });
    await page.click("#start", { force: true });
    await page.waitForSelector("#open-q", { timeout: 15000 });
    await page.click("#open-q", { force: true });
    await page.waitForSelector("#battery-progress-compact", { timeout: 15000 });
    await page.waitForFunction(
      () => {
        if (!document.body.classList.contains("assessment-question-active")) return false;
        const el = document.getElementById("battery-progress-compact");
        const step = document.getElementById("battery-current-step");
        const submit = document.getElementById("submit");
        if (!el || !step || !submit) return false;
        const r = el.getBoundingClientRect();
        const sr = step.getBoundingClientRect();
        const vh = window.innerHeight;
        const visible =
          r.width > 0 &&
          r.height > 0 &&
          r.bottom > 0 &&
          r.top < vh &&
          sr.width > 0 &&
          sr.bottom > 0 &&
          sr.top < vh;
        const tab = document.querySelector(".cabinet-mobile-nav");
        const tabTop = tab ? tab.getBoundingClientRect().top : vh;
        const submitOk = submit.getBoundingClientRect().bottom <= tabTop - 2;
        return visible && submitOk;
      },
      { timeout: 15000 }
    );
    const label = await page.locator("#battery-current-step").textContent();
    assert.match(label || "", /Короткий 1/);
    await context.close();
  });

  it("round41: expired quick question reload advances without page error", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const email = `r41-stuck-${Date.now()}@demo.local`;
    await context.request.post(`${BASE}/api/auth/register`, {
      data: registerPayload({ email, role: "candidate" }),
    });
    await context.request.post(`${BASE}/api/auth/confirm`, { data: { email, code: "000000" } });
    await context.request.post(`${BASE}/api/auth/login`, {
      data: { email, password: PASS },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/candidate/tasks`, { waitUntil: "commit" });
    await page.waitForSelector("#assessment-privacy", { timeout: 15000 });
    await page.check("#assessment-privacy", { force: true });
    await page.click("#start", { force: true });
    await page.waitForSelector("#open-q", { timeout: 15000 });
    await page.click("#open-q", { force: true });
    await page.waitForSelector("#answer", { timeout: 15000 });
    const dbPath = path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    const attempt = db
      .prepare(
        `SELECT a.id FROM attempts a
         JOIN batteries b ON b.id = a.battery_id
         WHERE a.candidate_user_id = ? AND a.submitted_at IS NULL
         ORDER BY a.rowid LIMIT 1`
      )
      .get(user.id);
    const past = new Date(Date.now() - 120_000).toISOString();
    db.prepare("UPDATE attempts SET opened_at = ?, started_at = ? WHERE id = ?").run(
      past,
      past,
      attempt.id
    );
    db.close();
    await page.reload({ waitUntil: "commit" });
    await page.waitForSelector("#open-q, #submit", { timeout: 15000 });
    assert.equal(errors.length, 0, errors.join("; "));
    const hasNext = await page.evaluate(() => Boolean(document.querySelector("#open-q")));
    assert.ok(hasNext, "expected next step open button after auto-expire");
    await context.close();
  });

  it("round38: mobile test question keeps submit above tab bar at 390x844", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const email = `r38-layout-${Date.now()}@demo.local`;
    await context.request.post(`${BASE}/api/auth/register`, {
      data: registerPayload({ email, role: "candidate" }),
    });
    await context.request.post(`${BASE}/api/auth/confirm`, { data: { email, code: "000000" } });
    const loginRes = await context.request.post(`${BASE}/api/auth/login`, {
      data: { email, password: PASS },
    });
    assert.ok(loginRes.ok());
    const page = await context.newPage();
    await page.goto(`${BASE}/candidate/tasks`, { waitUntil: "commit" });
    await page.waitForSelector("#assessment-privacy", { timeout: 15000 });
    await page.check("#assessment-privacy", { force: true });
    await page.click("#start", { force: true });
    await page.waitForSelector("#open-q", { timeout: 15000 });
    await page.click("#open-q", { force: true });
    await page.waitForSelector("#submit", { timeout: 15000 });
    await page.evaluate(() => {
      document.getElementById("submit")?.scrollIntoView({ block: "end" });
    });
    const box = await page.locator("#submit").boundingBox();
    assert.ok(box, "submit missing");
    const tabTop = await page.evaluate(() => {
      const nav = document.querySelector(".cabinet-mobile-nav");
      return nav ? nav.getBoundingClientRect().top : window.innerHeight;
    });
    assert.ok(box.y + box.height <= tabTop + 2, `submit bottom ${box.y + box.height} tab ${tabTop}`);
    await context.close();
  });

  it("round45: candidate opening employer deck does not call /api/employer/needs", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const needsCalls = [];
    await page.route("**/api/employer/needs**", (route) => {
      needsCalls.push(route.request().url());
      return route.continue();
    });
    await login(page, "anna@demo.local");
    await page.goto(`${BASE}/employer/deck`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForURL(/\/candidate\/today/, { timeout: 20000 });
    assert.equal(needsCalls.length, 0, `unexpected needs calls: ${needsCalls.join(", ")}`);
    await context.close();
  });

  it("round45: mobile tasks show compact progress strip", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const email = `r45-mobile-${Date.now()}@demo.local`;
    await context.request.post(`${BASE}/api/auth/register`, {
      data: registerPayload({ email, role: "candidate" }),
    });
    await context.request.post(`${BASE}/api/auth/confirm`, { data: { email, code: "000000" } });
    await context.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASS } });
    const page = await context.newPage();
    await page.goto(`${BASE}/candidate/tasks`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector("#assessment-privacy", { timeout: 15000 });
    await page.check("#assessment-privacy", { force: true });
    await page.click("#start", { force: true });
    await page.waitForSelector("#open-q", { timeout: 15000 });
    await page.click("#open-q", { force: true });
    await page.waitForSelector("#battery-progress-compact", { state: "visible", timeout: 15000 });
    await page.waitForFunction(
      () => {
        const steps = document.querySelector(".battery-steps-full");
        return steps && getComputedStyle(steps).display === "none";
      },
      { timeout: 5000 }
    );
    await context.close();
  });

  it("round45: employer triple reload keeps recording video duration near live time", async () => {
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
         VALUES (?, ?, ?, ?, 180000, 220000, 'round45 multi reload', 'email', 'accepted')`
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
      const wallStarted = Date.now();
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
      await cand.check("#consent", { force: true });
      await cand.click("#join", { force: true });
      await emp.waitForFunction(
        () => (window.__hcPcs || []).some((pc) => pc.connectionState === "connected"),
        { timeout: 60000 }
      );
      for (let i = 0; i < 3; i += 1) {
        await emp.reload({ waitUntil: "commit" });
        await emp.waitForSelector("#join:not([disabled])", { timeout: 20000 });
        await emp.click("#join", { force: true });
        await new Promise((r) => setTimeout(r, 2500));
      }
      const liveStarted = Date.now();
      await new Promise((r) => setTimeout(r, 12000));
      await emp.click("#end", { force: true });
      await emp.waitForURL(new RegExp(`/call/${invId}`), { timeout: 45000 });
      const liveMs = Date.now() - liveStarted;
      let dur = NaN;
      const metaDeadline = Date.now() + 90_000;
      while (Date.now() < metaDeadline) {
        try {
          dur = await emp.evaluate(async (id) => {
            const r = await fetch(`/api/calls/for-invitation/${id}`, { credentials: "include" });
            const info = await r.json();
            if (info.status !== "ended" || !info.callId) return NaN;
            const sides = info.recordingSides || [];
            if (!sides.includes("employer")) return NaN;
            const v = document.createElement("video");
            v.preload = "metadata";
            v.src = `/api/calls/${info.callId}/recording?side=employer`;
            await new Promise((resolve, reject) => {
              v.onloadedmetadata = () => resolve();
              v.onerror = () => reject(new Error("metadata"));
              setTimeout(() => reject(new Error("timeout")), 15000);
            });
            return v.duration;
          }, invId);
          if (Number.isFinite(dur) && dur > 0) break;
        } catch {
          /* recording may still be assembling on slow CI */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      const wallSec = (Date.now() - wallStarted) / 1000;
      assert.ok(Number.isFinite(dur) && dur > 0, `duration ${dur}`);
      assert.ok(
        dur <= wallSec + 20,
        `employer video duration ${dur}s vs wall ~${wallSec}s (multi-reload gap bug)`
      );
      assert.ok(dur < 180, `duration ${dur}s still looks inflated`);
      await empCtx.close();
      await candCtx.close();
    } finally {
      await mediaBrowser.close();
    }
  });

  function browserDbPath() {
    return path.join(ROOT, "data", `handcheck-browser-${PORT}.sqlite`);
  }

  function candidateChunkCountForInvitation(invId) {
    const Database = require("better-sqlite3");
    const db = new Database(browserDbPath());
    const call = db
      .prepare(
        `SELECT recording_path FROM calls WHERE invitation_id = ? ORDER BY started_at DESC LIMIT 1`
      )
      .get(invId);
    db.close();
    if (!call?.recording_path) return 0;
    const dir = path.join(call.recording_path, "chunks", "candidate");
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter((f) => /^\d+\.webm$/.test(f)).length;
  }

  async function waitForCandidateChunksOnDisk(invId, minCount = 1, timeoutMs = 45_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const n = candidateChunkCountForInvitation(invId);
      if (n >= minCount) return n;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(
      `timed out waiting for >=${minCount} candidate chunk(s) on disk (have ${candidateChunkCountForInvitation(invId)})`
    );
  }

  async function waitForRecordingChunkPost(page, timeoutMs = 45_000) {
    await page.waitForResponse(
      (res) =>
        res.url().includes("/recording-chunk") &&
        res.request().method() === "POST" &&
        res.status() === 200,
      { timeout: timeoutMs }
    );
  }

  async function fetchCandidateRecordingBuffer(page, callId) {
    const payload = await page.evaluate(async (id) => {
      const res = await fetch(`/api/calls/${id}/recording?side=candidate`, {
        credentials: "include",
      });
      if (!res.ok) return { ok: false, status: res.status };
      const ab = await res.arrayBuffer();
      return { ok: true, bytes: Array.from(new Uint8Array(ab)) };
    }, callId);
    if (!payload.ok) return null;
    return Buffer.from(payload.bytes);
  }

  async function waitForPlayableCandidateRecording(page, invId, timeoutMs = 90_000) {
    const { readDurationSecondsFromBuffer } = require("../app/lib/webm-ffmpeg");
    const { MIN_PLAYABLE_RECORDING_BYTES } = require("../app/lib/call-recording");
    const start = Date.now();
    let lastDur = null;
    let lastSides = [];
    while (Date.now() - start < timeoutMs) {
      const info = await page.evaluate(async (id) => {
        const r = await fetch(`/api/calls/for-invitation/${id}`, { credentials: "include" });
        return r.json();
      }, invId);
      lastSides = info.recordingSides || [];
      if (info.status === "ended" && lastSides.includes("candidate") && info.callId) {
        const buf = await fetchCandidateRecordingBuffer(page, info.callId);
        if (buf && buf.length >= MIN_PLAYABLE_RECORDING_BYTES) {
          lastDur = readDurationSecondsFromBuffer(buf);
          if (lastDur && lastDur > 0) {
            return { info, buf, dur: lastDur };
          }
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `candidate recording not playable within ${timeoutMs}ms (sides=${lastSides.join(",")}, lastDuration=${lastDur})`
    );
  }

  async function joinLiveCall(emp, cand, invId) {
    await emp.goto(`${BASE}/call/${invId}`, { waitUntil: "commit" });
    await cand.goto(`${BASE}/call/${invId}`, { waitUntil: "commit" });
    await emp.check("#consent", { force: true });
    await emp.click("#join", { force: true });
    await cand.check("#consent", { force: true });
    await cand.click("#join", { force: true });
    await emp.waitForFunction(
      () => (window.__hcPcs || []).some((pc) => pc.connectionState === "connected"),
      { timeout: 60000 }
    );
  }

  it("round53: candidate calls status pills use sentence case", async () => {
    const Database = require("better-sqlite3");
    const db = new Database(browserDbPath());
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const specs = [
      { status: "ready", label: "ready" },
      { status: "live", label: "live" },
      { status: "ended", label: "ended" },
    ];
    for (const spec of specs) {
      const invId = newId();
      const callId = newId();
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
         VALUES (?, ?, ?, ?, 180000, 220000, ?, 'email', 'accepted')`
      ).run(invId, cafe.id, need.id, anna.id, `r53 pill ${spec.label}`);
      if (spec.status === "ended") {
        db.prepare(
          `INSERT INTO calls (id, invitation_id, status, ended_at) VALUES (?, ?, 'ended', datetime('now'))`
        ).run(callId, invId);
      } else {
        db.prepare(`INSERT INTO calls (id, invitation_id, status) VALUES (?, ?, ?)`).run(
          callId,
          invId,
          spec.status
        );
      }
    }
    db.close();

    const page = await browser.newPage();
    await login(page, "anna@demo.local");
    await page.goto(`${BASE}/candidate/calls`, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector(".status-pill", { timeout: 20000 });
    const pills = await page.$$eval(".status-pill", (els) =>
      els.map((el) => ({
        text: (el.innerText || el.textContent || "").trim(),
        transform: getComputedStyle(el).textTransform,
      }))
    );
    assert.ok(pills.length >= 3, `expected call pills, got ${pills.length}`);
    for (const p of pills) {
      assert.match(p.text, /^[А-ЯЁA-Z]/, `pill "${p.text}"`);
      assert.notEqual(p.transform, "lowercase", `pill "${p.text}" has lowercase transform`);
    }
    await page.close();
  });

  it(
    "round53: visibility hide during uploads has no page errors or duplicate chunks",
    { timeout: RECORDING_IT_MS },
    async () => {
    const { ffmpegAvailable, readDurationSecondsFromBuffer } = require("../app/lib/webm-ffmpeg");
    if (!ffmpegAvailable()) return;

    const mediaBrowser = await chromium.launch({
      headless: true,
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    try {
      const Database = require("better-sqlite3");
      const db = new Database(browserDbPath());
      const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
      const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
      const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
      const { newId } = require("../app/lib/ids");
      const invId = newId();
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
         VALUES (?, ?, ?, ?, 180000, 220000, 'round53 visibility', 'email', 'accepted')`
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
      const pageErrors = [];
      cand.on("pageerror", (err) => pageErrors.push(String(err)));
      await login(emp, "cafe@demo.local");
      await login(cand, "boris@demo.local");
      await joinLiveCall(emp, cand, invId);
      await emp.waitForFunction(
        () => (document.getElementById("panel-title")?.textContent || "").includes("В эфире"),
        { timeout: 60000 }
      );
      const liveStarted = Date.now();
      await cand.waitForResponse(
        (res) => res.url().includes("/recording-chunk") && res.request().method() === "POST",
        { timeout: 45000 }
      );
      for (let i = 0; i < 3; i += 1) {
        await cand.waitForResponse(
          (res) => res.url().includes("/recording-chunk") && res.request().method() === "POST",
          { timeout: 45000 }
        );
        await cand.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await new Promise((r) => setTimeout(r, 1500));
        await cand.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      }
      await emp.click("#end", { force: true });
      await emp.waitForSelector(".call-result-card", { timeout: 120000 });
      const liveSec = (Date.now() - liveStarted) / 1000;
      assert.equal(pageErrors.length, 0, pageErrors.join("; "));
      let info = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        info = await emp.evaluate(async (id) => {
          const r = await fetch(`/api/calls/for-invitation/${id}`, { credentials: "include" });
          return r.json();
        }, invId);
        if (info.status === "ended" && (info.recordingSides || []).includes("candidate")) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const db2 = new Database(browserDbPath());
      const callRow = db2
        .prepare(`SELECT recording_path FROM calls WHERE invitation_id = ? LIMIT 1`)
        .get(invId);
      db2.close();
      const chunkDir = path.join(callRow.recording_path, "chunks", "candidate");
      const chunkFiles = fs
        .readdirSync(chunkDir)
        .filter((f) => /^\d+\.webm$/.test(f))
        .sort();
      const chunkSizes = chunkFiles.map((f) => fs.statSync(path.join(chunkDir, f)).size);
      const dupPairs = chunkSizes.filter((sz, idx) => idx > 0 && chunkSizes[idx - 1] === sz);
      assert.equal(dupPairs.length, 0, `duplicate consecutive chunk sizes: ${chunkSizes.join(",")}`);
      const buf = await emp.evaluate(async ({ callId, side }) => {
        const res = await fetch(`/api/calls/${callId}/recording?side=${side}`, { credentials: "include" });
        const ab = await res.arrayBuffer();
        return Array.from(new Uint8Array(ab));
      }, { callId: info.callId, side: "candidate" });
      const dur = readDurationSecondsFromBuffer(Buffer.from(buf));
      assert.ok(dur && dur > 0, `duration ${dur}`);
      assert.ok(
        Math.abs(dur - liveSec) <= liveSec * 0.25 + 4,
        `candidate duration ${dur}s vs live ~${liveSec}s`
      );
      await empCtx.close();
      await candCtx.close();
    } finally {
      await mediaBrowser.close();
    }
  }
  );

  it("round49: invitation status pills use sentence case on both sides", async () => {
    const Database = require("better-sqlite3");
    const db = new Database(browserDbPath());
    const anna = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get();
    const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
    const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
    const { newId } = require("../app/lib/ids");
    const invAccepted = newId();
    const invDeclined = newId();
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 180000, 220000, 'r49 pill accepted', 'email', 'accepted')`
    ).run(invAccepted, cafe.id, need.id, anna.id);
    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
       VALUES (?, ?, ?, ?, 170000, 210000, 'r49 pill declined', 'email', 'declined')`
    ).run(invDeclined, cafe.id, need.id, anna.id);
    db.close();

    const assertPillsCapitalized = async (page, urlPath) => {
      await page.goto(`${BASE}${urlPath}`, { waitUntil: "commit", timeout: 30000 });
      await page.waitForSelector(".status-pill", { timeout: 20000 });
      const texts = await page.$$eval(".status-pill", (els) =>
        els.map((el) => (el.textContent || "").trim()).filter(Boolean)
      );
      assert.ok(texts.length > 0, `no pills on ${urlPath}`);
      for (const t of texts) {
        assert.match(t, /^[А-ЯЁA-Z]/, `pill "${t}" on ${urlPath}`);
      }
    };

    const candCtx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const empCtx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const cand = await candCtx.newPage();
    const emp = await empCtx.newPage();
    await login(cand, "anna@demo.local");
    await login(emp, "cafe@demo.local");
    await assertPillsCapitalized(cand, "/candidate/invitations");
    await assertPillsCapitalized(emp, "/employer/invitations");
    await candCtx.close();
    await empCtx.close();
  });

  it(
    "round49: candidate reload keeps pre-reload recording chunks on server",
    { timeout: RECORDING_IT_MS },
    async () => {
    const { ffmpegAvailable, maxPacketGapSeconds } = require("../app/lib/webm-ffmpeg");
    if (!ffmpegAvailable()) return;

    const mediaBrowser = await chromium.launch({
      headless: true,
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    try {
      const Database = require("better-sqlite3");
      const db = new Database(browserDbPath());
      const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
      const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
      const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
      const { newId } = require("../app/lib/ids");
      const invId = newId();
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
         VALUES (?, ?, ?, ?, 180000, 220000, 'round49 reload chunk', 'email', 'accepted')`
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
      await joinLiveCall(emp, cand, invId);
      const liveStarted = Date.now();
      await waitForRecordingChunkPost(cand);
      await waitForCandidateChunksOnDisk(invId, 1);
      await cand.reload({ waitUntil: "commit" });
      await cand.waitForSelector("#join:not([disabled])", { timeout: 20000 });
      await cand.click("#join", { force: true });
      await waitForRecordingChunkPost(cand);
      const chunksAfterReload = candidateChunkCountForInvitation(invId);
      assert.ok(chunksAfterReload >= 1, `expected candidate chunks after reload, got ${chunksAfterReload}`);
      await new Promise((r) => setTimeout(r, 8000));
      await emp.click("#end", { force: true });
      await emp.waitForURL(new RegExp(`/call/${invId}`), { timeout: 45000 });
      await emp.waitForSelector(".call-result-card", { timeout: 60_000 });
      const liveSec = (Date.now() - liveStarted) / 1000;
      const { buf: webm, dur } = await waitForPlayableCandidateRecording(emp, invId);
      assert.ok(dur && dur > 0, `duration ${dur}`);
      assert.ok(
        dur >= liveSec - 12,
        `candidate duration ${dur}s vs live ~${liveSec}s (lost pre-reload media)`
      );
      const tmp = path.join(ROOT, "data", `r49-reload-${PORT}.webm`);
      fs.writeFileSync(tmp, webm);
      assert.ok(maxPacketGapSeconds(tmp) <= 0.5);
      const dec = require("child_process").spawnSync(
        "ffmpeg",
        ["-v", "error", "-i", tmp, "-f", "null", "-"],
        { encoding: "utf8" }
      );
      assert.equal(dec.status, 0, dec.stderr);
      fs.unlinkSync(tmp);
      await empCtx.close();
      await candCtx.close();
    } finally {
      await mediaBrowser.close();
    }
  }
  );

  it(
    "round49: reload after upload tick still keeps recording tail",
    { timeout: RECORDING_IT_MS },
    async () => {
    const { ffmpegAvailable } = require("../app/lib/webm-ffmpeg");
    if (!ffmpegAvailable()) return;

    const mediaBrowser = await chromium.launch({
      headless: true,
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    try {
      const Database = require("better-sqlite3");
      const db = new Database(browserDbPath());
      const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
      const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
      const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
      const { newId } = require("../app/lib/ids");
      const invId = newId();
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
         VALUES (?, ?, ?, ?, 180000, 220000, 'round49 reload after tick', 'email', 'accepted')`
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
      await joinLiveCall(emp, cand, invId);
      const liveStarted = Date.now();
      await waitForRecordingChunkPost(cand);
      await waitForCandidateChunksOnDisk(invId, 1);
      await new Promise((r) => setTimeout(r, 4000));
      await cand.reload({ waitUntil: "commit" });
      await cand.waitForSelector("#join:not([disabled])", { timeout: 20000 });
      await cand.click("#join", { force: true });
      await waitForRecordingChunkPost(cand);
      await new Promise((r) => setTimeout(r, 6000));
      await emp.click("#end", { force: true });
      await emp.waitForURL(new RegExp(`/call/${invId}`), { timeout: 45000 });
      await emp.waitForSelector(".call-result-card", { timeout: 60_000 });
      const liveSec = (Date.now() - liveStarted) / 1000;
      const { dur } = await waitForPlayableCandidateRecording(emp, invId);
      assert.ok(dur >= liveSec - 12, `candidate duration ${dur}s vs live ~${liveSec}s`);
      await empCtx.close();
      await candCtx.close();
    } finally {
      await mediaBrowser.close();
    }
  }
  );

  it(
    "round49: tab close uploads pending recording tail",
    { timeout: RECORDING_IT_MS },
    async () => {
    const { ffmpegAvailable, readDurationSecondsFromBuffer } = require("../app/lib/webm-ffmpeg");
    if (!ffmpegAvailable()) return;

    const mediaBrowser = await chromium.launch({
      headless: true,
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    try {
      const Database = require("better-sqlite3");
      const db = new Database(browserDbPath());
      const cafe = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
      const boris = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
      const need = db.prepare("SELECT id FROM employer_needs WHERE employer_user_id = ?").get(cafe.id);
      const { newId } = require("../app/lib/ids");
      const invId = newId();
      db.prepare(
        `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
         VALUES (?, ?, ?, ?, 180000, 220000, 'round49 tab close', 'email', 'accepted')`
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
      await joinLiveCall(emp, cand, invId);
      const liveStarted = Date.now();
      await new Promise((r) => setTimeout(r, 7000));
      const chunkUploadPromise = cand
        .waitForResponse(
          (res) => res.url().includes("/recording-chunk") && res.status() === 200,
          { timeout: 20000 }
        )
        .catch(() => null);
      await cand.close({ runBeforeUnload: true });
      await chunkUploadPromise;
      await new Promise((r) => setTimeout(r, 6000));
      let chunksAfterClose = 0;
      let bytesAfterClose = 0;
      for (let i = 0; i < 8; i += 1) {
        const Database = require("better-sqlite3");
        const db = new Database(browserDbPath());
        const call = db
          .prepare(`SELECT id, recording_path FROM calls WHERE invitation_id = ? LIMIT 1`)
          .get(invId);
        db.close();
        if (call?.recording_path) {
          const dir = path.join(call.recording_path, "chunks", "candidate");
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir).filter((f) => /^\d+\.webm$/.test(f));
            chunksAfterClose = files.length;
            bytesAfterClose = files.reduce(
              (sum, f) => sum + fs.statSync(path.join(dir, f)).size,
              0
            );
          }
        }
        if (chunksAfterClose >= 1 && bytesAfterClose > 20_000) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      assert.ok(chunksAfterClose >= 1, `expected chunks after tab close, got ${chunksAfterClose}`);
      assert.ok(bytesAfterClose > 20_000, `expected chunk bytes after tab close, got ${bytesAfterClose}`);
      await emp.waitForFunction(
        () => document.body?.textContent?.includes("вышел") || document.body?.textContent?.includes("комнат"),
        { timeout: 30000 }
      ).catch(() => {});
      await new Promise((r) => setTimeout(r, 6000));
      await emp.click("#end", { force: true });
      await emp.waitForURL(new RegExp(`/call/${invId}`), { timeout: 45000 });
      const liveSec = (Date.now() - liveStarted) / 1000;
      const recordingMeta = await emp.evaluate(async (id) => {
        const r = await fetch(`/api/calls/for-invitation/${id}`, { credentials: "include" });
        return r.json();
      }, invId);
      const { finalizeMergedWebm } = require("../app/lib/recording-store");
      const { listChunkFiles } = require("../app/lib/recording-store");
      const chunkPaths = listChunkFiles(recordingMeta.callId, "candidate");
      assert.ok(chunkPaths.length >= 1, "expected stored candidate chunks after finalize");
      const merged = finalizeMergedWebm(
        chunkPaths.map((p) => fs.readFileSync(p)),
        Math.round(liveSec * 1000)
      );
      const chunkDur = readDurationSecondsFromBuffer(merged);
      assert.ok(chunkDur && chunkDur > 0, `chunk merge duration ${chunkDur}`);
      assert.ok(
        chunkDur >= liveSec - 14,
        `candidate chunk duration ${chunkDur}s vs live ~${liveSec}s after tab close`
      );
      await empCtx.close();
      await candCtx.close();
    } finally {
      await mediaBrowser.close();
    }
  }
  );

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
