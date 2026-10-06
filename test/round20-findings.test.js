"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const ROOT = path.join(__dirname, "..");

const {
  emailLooksLikeRoundTest,
  displayNameLooksLikeRoundTest,
  shouldMarkUserAsTest,
} = require("../app/lib/is-test-user");
const { parseSalaryRange } = require("../app/lib/salary-range");
const { buildExplanation } = require("../app/modules/matching/explain");

describe("round 20 findings", () => {
  describe("item 1 — test account detection", () => {
    it("matches round 9, 20 and 123 email patterns", () => {
      assert.equal(emailLooksLikeRoundTest("r9c-123456@demo.local"), true);
      assert.equal(emailLooksLikeRoundTest("r20c-7823846@demo.local"), true);
      assert.equal(emailLooksLikeRoundTest("r123e-99@demo.local"), true);
      assert.equal(emailLooksLikeRoundTest("r1c-99@demo.local"), true);
      assert.equal(emailLooksLikeRoundTest("not-test@demo.local"), false);
    });

    it("matches display names Тест Р9 and Тест Р20", () => {
      assert.equal(displayNameLooksLikeRoundTest("Тест Р9 Кандидат"), true);
      assert.equal(displayNameLooksLikeRoundTest("Тест Р20 Компания"), true);
      assert.equal(displayNameLooksLikeRoundTest("Тест Р1 старый"), true);
      assert.equal(displayNameLooksLikeRoundTest("Анна"), false);
    });

    it("shouldMarkUserAsTest combines email and display name on @demo.local", () => {
      assert.equal(shouldMarkUserAsTest("r20e-1@demo.local", ""), true);
      assert.equal(shouldMarkUserAsTest("boss@demo.local", "Тест Р20"), true);
      assert.equal(shouldMarkUserAsTest("boss@example.com", "Тест Р20"), false);
    });
  });

  describe("item 5 — salary validation", () => {
    it("uses plain message for negative bounds", () => {
      const a = parseSalaryRange(-1, 100000);
      assert.match(a.fields.salaryRange, /отрицательной/i);
      const b = parseSalaryRange(100000, -5);
      assert.match(b.fields.salaryRange, /отрицательной/i);
    });
  });

  describe("item 7 — deck explanation wording", () => {
    it("uses plain domain line without «бонус»", () => {
      const lines = buildExplanation(
        { domain_boost: 1, fsp_boost: 0, stack: ["node"] },
        { grade: "middle", specialization: "backend", domain_text: "HoReCa", stack_json: '["node"]' }
      );
      assert.ok(lines.some((l) => l.includes("Опыт в домене потребности: HoReCa")));
      assert.ok(!lines.some((l) => /бонус/i.test(l)));
    });
  });

  describe("item 2 — ai usage for pool-visible candidates", () => {
    before(() => {
      const tmpDb = path.join(os.tmpdir(), `hc-r20-ai-${process.pid}.sqlite`);
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
      process.env.DB_PATH = tmpDb;
      process.env.DEMO_MODE = "1";
      try {
        require("../app/db").closeDb();
      } catch {
        /* first load */
      }
      for (const mod of ["../app/db", "../app/server", "../app/lib/ai-usage-summary"]) {
        delete require.cache[require.resolve(mod)];
      }
      const { createApp } = require("../app/server");
      createApp();
      const db = require("../app/db").getDb();
      const { newId } = require("../app/lib/ids");
      const cafeRow = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get();
      const borisRow = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get();
      assert.ok(cafeRow && borisRow, "demo seed must include cafe and boris");
      const borisId = borisRow.id;
      const sessionId = newId();
      const tokenId = newId();
      db.prepare(
        `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes_json, client_where, logging_consent_at)
         VALUES (?, ?, 'r20', 'hash', 'hc_test', '["read","write"]', 'Claude Code (r20 test)', datetime('now'))`
      ).run(tokenId, borisId);
      db.prepare(
        `INSERT INTO mcp_client_sessions (id, user_id, api_token_id, client_name, client_version, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, 'Claude Code', '1.0', datetime('now'), datetime('now'))`
      ).run(sessionId, borisId, tokenId);
      const bat = db
        .prepare(
          `SELECT id, started_at FROM batteries WHERE candidate_user_id = ? ORDER BY started_at DESC LIMIT 1`
        )
        .get(borisId);
      const callAt = bat?.started_at || new Date().toISOString();
      if (!bat) {
        const batId = newId();
        db.prepare(
          `INSERT INTO batteries (id, candidate_user_id, specialization, claimed_grade, form_key, started_at, completed_at)
           VALUES (?, ?, 'backend', 'middle', 'A', ?, ?)`
        ).run(batId, borisId, callAt, callAt);
        const taskId = db.prepare("SELECT id FROM tasks WHERE type = 'quick' LIMIT 1").get().id;
        db.prepare(
          `INSERT INTO attempts (id, candidate_user_id, task_id, battery_id, form_key, answer_text, submitted_at, action_source)
           VALUES (?, ?, ?, ?, 'A', 'ok', ?, 'mcp')`
        ).run(newId(), borisId, taskId, batId, callAt);
      } else if (bat) {
        const taskId = db.prepare("SELECT id FROM tasks WHERE type = 'quick' LIMIT 1").get().id;
        db.prepare(
          `INSERT INTO attempts (id, candidate_user_id, task_id, battery_id, form_key, answer_text, submitted_at, action_source)
           VALUES (?, ?, ?, ?, 'A', 'ok', ?, 'mcp')`
        ).run(newId(), borisId, taskId, bat.id, callAt);
      }
      db.prepare(
        `INSERT INTO mcp_tool_calls (id, session_id, user_id, api_token_id, tool_name, args_masked_json, intent_text, ok, created_at)
         VALUES (?, ?, ?, ?, 'submit_answer', '{}', 'проверяю REST', 1, ?)`
      ).run(newId(), sessionId, borisId, tokenId, callAt);
      db.prepare(
        `INSERT INTO mcp_tool_calls (id, session_id, user_id, api_token_id, tool_name, args_masked_json, intent_text, ok, created_at)
         VALUES (?, ?, ?, ?, 'start_assessment', '{}', 'начну', 1, ?)`
      ).run(newId(), sessionId, borisId, tokenId, callAt);
    });

    it("returns aiUsage without invitation when candidate is in employer pool", () => {
      const db = require("../app/db").getDb();
      const cafeId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
      const borisId = db.prepare("SELECT id FROM users WHERE email = 'boris@demo.local'").get().id;
      const { summarizeAiUsageForEmployer: summarize } = require("../app/lib/ai-usage-summary");
      const summary = summarize(cafeId, borisId);
      assert.ok(summary);
      assert.match(summary.clientLabel || summary.headline, /Claude Code/i);
      assert.ok(
        summary.activityLines.some((l) => /короткие ответы|REST/i.test(l)) ||
          /Claude Code/i.test(summary.clientLabel || summary.headline)
      );
    });
  });

  describe("item 4 — today steps helper", () => {
    it("does not list finished calls in upcoming steps", () => {
      const src = fs.readFileSync(path.join(ROOT, "app/public/candidate/today.html"), "utf8");
      assert.doesNotMatch(src, /else if \(endedOnly\)/);
      assert.match(src, /joinableCount > 0/);
    });
  });

  describe("item 3 — tasks spec chip field", () => {
    it("recognizes spec field for backend availability", () => {
      const src = fs.readFileSync(path.join(ROOT, "app/public/candidate/tasks.html"), "utf8");
      assert.match(src, /field === "spec"/);
    });
  });
});
