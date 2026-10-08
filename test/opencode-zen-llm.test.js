"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

function clearAppCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}app${path.sep}`) || key.endsWith(`${path.sep}app`)) {
      delete require.cache[key];
    }
  }
}

function withTmpDbEnv(extra = {}) {
  const tmpDb = path.join(os.tmpdir(), `hc-llm-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.SESSION_SECRET = "test-session-secret";
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  clearAppCache();
  return tmpDb;
}

function loadClient(env) {
  withTmpDbEnv(env);
  return require("../app/lib/llm-client");
}

describe("opencode zen llm client", () => {
  const prev = {};

  beforeEach(() => {
    for (const k of [
      "LLM_BASE_URL",
      "LLM_API_KEY",
      "LLM_MODEL",
      "LLM_FALLBACK_MODELS",
      "DB_PATH",
      "SESSION_SECRET",
    ]) {
      prev[k] = process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    clearAppCache();
  });

  it("isLlmConfigured requires url+key (zen default when key only)", () => {
    const a = loadClient({ LLM_BASE_URL: "", LLM_API_KEY: "" });
    assert.equal(a.isLlmConfigured(), false);

    const b = loadClient({ LLM_BASE_URL: "", LLM_API_KEY: "sk-test" });
    assert.equal(b.isLlmConfigured(), true);
    const config = require("../app/config");
    assert.equal(config.LLM_BASE_URL, "https://opencode.ai/zen/v1");
  });

  it("falls back to next model on HTTP error", async () => {
    const llm = loadClient({
      LLM_BASE_URL: "https://example.test/v1",
      LLM_API_KEY: "sk-test",
      LLM_MODEL: "primary-model",
      LLM_FALLBACK_MODELS: "fallback-model",
    });
    const calls = [];
    const fetchImpl = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body.model);
      if (body.model === "primary-model") {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"prompt":"P","rubric":{"keys":["k"]}}' } }],
        }),
      };
    };
    const gen = await llm.generateTask({
      specialization: "backend",
      grade: "middle",
      type: "quick",
      fetchImpl,
    });
    assert.deepEqual(calls, ["primary-model", "fallback-model"]);
    assert.equal(gen.prompt, "P");
    assert.equal(gen.model, "fallback-model");
  });

  it("extractJsonText strips fences", () => {
    const llm = loadClient({ LLM_BASE_URL: "https://x", LLM_API_KEY: "k" });
    assert.equal(llm.extractJsonText('```json\n{"a":1}\n```'), '{"a":1}');
  });

  it("summarizeCallTranscript returns summary JSON", async () => {
    const llm = loadClient({
      LLM_BASE_URL: "https://example.test/v1",
      LLM_API_KEY: "sk-test",
      LLM_MODEL: "m",
      LLM_FALLBACK_MODELS: "",
    });
    const out = await llm.summarizeCallTranscript({
      needDomainText: "postgres",
      transcript: "Кандидат: postgres. Работодатель: ок.",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"summary":"Короткий LLM итог."}' } }],
        }),
      }),
    });
    assert.equal(out.summary, "Короткий LLM итог.");
  });
});

describe("analyzeCall LLM summary", () => {
  it("prefers LLM summary when configured", async () => {
    const tmpDb = withTmpDbEnv({
      LLM_BASE_URL: "https://example.test/v1",
      LLM_API_KEY: "sk-test",
      DEMO_MODE: "1",
    });

    const { getDb, closeDb } = require("../app/db");
    closeDb();
    const db = getDb();
    const { newId } = require("../app/lib/ids");
    const emp = newId();
    const cand = newId();
    const need = newId();
    const inv = newId();
    const call = newId();

    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, email_confirmed_at)
       VALUES (?, 'e@t.local', 'x', 'employer', datetime('now'))`
    ).run(emp);
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, email_confirmed_at)
       VALUES (?, 'c@t.local', 'x', 'candidate', datetime('now'))`
    ).run(cand);

    db.prepare(
      `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, notes, active)
       VALUES (?, ?, 'Need', 'backend', 'middle', '[]', 'postgres redis', '', 1)`
    ).run(need, emp);

    db.prepare(
      `INSERT INTO invitations (id, employer_user_id, candidate_user_id, need_id, status, salary_from, salary_to, offer_text, contact_channel, action_source)
       VALUES (?, ?, ?, ?, 'accepted', 100000, 200000, 'offer', 'email', 'web')`
    ).run(inv, emp, cand, need);

    db.prepare(
      `INSERT INTO calls (id, invitation_id, status, transcript_text, started_at, ended_at)
       VALUES (?, ?, 'ended', 'Кандидат: работал с postgres. Работодатель: отлично.', datetime('now'), datetime('now'))`
    ).run(call, inv);

    const { analyzeCall } = require("../app/modules/calls/analyze-call");
    await analyzeCall(call, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"summary":"LLM итог про postgres и обе стороны."}' } }],
        }),
      }),
    });
    const row = db.prepare("SELECT summary_text FROM call_analyses WHERE call_id = ?").get(call);
    assert.equal(row.summary_text, "LLM итог про postgres и обе стороны.");
    try {
      fs.unlinkSync(tmpDb);
    } catch {
      /* ignore */
    }
  });
});
