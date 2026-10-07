"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { newId } = require("../app/lib/ids");
const {
  parseDeferredListQuery,
  listDeferredCandidates,
} = require("../app/lib/employer-deferred-list");
const {
  parseStoredDraft,
  pickRestoredDraftText,
  writeLocalDraft,
  createWorkDraftLifecycle,
  sendDraftPatchKeepalive,
  LOCAL_DRAFT_DEBOUNCE_MS,
} = require("../app/lib/tasks-draft-persist");

function bootApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-r59-${process.pid}-${Date.now()}.sqlite`);
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  delete require.cache[require.resolve("../app/server")];
  const { createApp } = require("../app/server");
  return { app: createApp(), tmpDb };
}

describe("round59 P2 employer deferred list", () => {
  let app;
  let db;
  let employerId;
  let need;

  before(() => {
    const boot = bootApp();
    app = boot.app;
    db = require("../app/db").getDb();
    employerId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
    need = db.prepare("SELECT * FROM employer_needs WHERE employer_user_id = ?").get(employerId);
  });

  it("parseDeferredListQuery honors limit, offset, page, and cursor", () => {
    assert.deepEqual(parseDeferredListQuery({ limit: "25", offset: "5" }), {
      limit: 25,
      offset: 5,
    });
    assert.deepEqual(parseDeferredListQuery({ limit: 10, page: 3 }), { limit: 10, offset: 20 });
    assert.deepEqual(parseDeferredListQuery({ limit: 10, cursor: "15" }), {
      limit: 10,
      offset: 15,
    });
  });

  it("returns all deferred candidates across pages (25 distinct ids)", async () => {
    db.prepare("DELETE FROM need_reviews WHERE need_id = ?").run(need.id);
    const now = new Date().toISOString();
    const ids = [];
    for (let i = 0; i < 25; i += 1) {
      const uid = newId();
      ids.push(uid);
      const email = `r59-def-${i}-${Date.now()}@demo.local`;
      db.prepare(
        `INSERT INTO users (id, email, password_hash, role, email_confirmed_at) VALUES (?, ?, ?, 'candidate', ?)`
      ).run(uid, email, "x", now);
      db.prepare(
        `INSERT INTO candidate_profiles (user_id, display_name, stack_json, phone, contact_email, availability)
         VALUES (?, ?, ?, '+79001112233', 'c@test.local', 'open')`
      ).run(uid, `Кандидат ${i}`, '["node"]');
      db.prepare(`INSERT INTO candidate_private (candidate_user_id, trust_ok) VALUES (?, 1)`).run(uid);
      if (i % 3 !== 0) {
        db.prepare(
          `INSERT INTO candidate_categories
           (candidate_user_id, category_id, specialization, grade, test_score, knowledge, breadth, motivation, assigned_at)
           VALUES (?, 'backend_middle', 'backend', 'middle', 0.55, 0.5, 0.5, 0.5, ?)`
        ).run(uid, now);
      }
      const ts = new Date(Date.now() - i * 1000).toISOString();
      db.prepare(
        `INSERT INTO need_reviews (id, employer_user_id, need_id, candidate_user_id, decision, updated_at)
         VALUES (?, ?, ?, ?, 'later', ?)`
      ).run(newId(), employerId, need.id, uid, ts);
    }

    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({
      email: "cafe@demo.local",
      password: "demo-demo-demo",
    });

    const page1 = await agent.get(
      `/api/employer/needs/${need.id}/deferred?limit=10&offset=0`
    );
    assert.equal(page1.status, 200);
    assert.equal(page1.body.total, 25);
    assert.equal(page1.body.items.length, 10);
    assert.equal(page1.body.hasMore, true);
    assert.equal(page1.body.nextCursor, 10);

    const page2 = await agent.get(
      `/api/employer/needs/${need.id}/deferred?limit=10&offset=10`
    );
    const page3 = await agent.get(
      `/api/employer/needs/${need.id}/deferred?limit=10&offset=20`
    );
    const seen = new Set([
      ...page1.body.items.map((x) => x.candidateId),
      ...page2.body.items.map((x) => x.candidateId),
      ...page3.body.items.map((x) => x.candidateId),
    ]);
    assert.equal(seen.size, 25);
    for (const id of ids) assert.ok(seen.has(id), `missing deferred ${id}`);

    const libPage = listDeferredCandidates(db, need, employerId, { limit: 100, offset: 0 });
    assert.equal(libPage.total, 25);
    assert.equal(libPage.items.length, 25);
    assert.ok(libPage.items[0].deferredAt >= libPage.items[1].deferredAt);
  });

  it("deferred page wires pagination UI and total stat tile", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "../app/public/employer/deferred.html"),
      "utf8"
    );
    assert.match(html, /deferredTotal/);
    assert.match(html, /Показать ещё/);
    assert.match(html, /limit=\$\{PAGE_SIZE\}/);
  });
});

describe("round59 P3 work task draft persistence", () => {
  it("pickRestoredDraftText prefers longer server draft", () => {
    assert.equal(pickRestoredDraftText("abc", "abcdef"), "abcdef");
    assert.equal(pickRestoredDraftText("", "server"), "server");
    assert.equal(pickRestoredDraftText("local wins", "x"), "local wins");
  });

  it("parseStoredDraft reads localStorage payload", () => {
    assert.deepEqual(parseStoredDraft(null), { text: "", at: 0 });
    assert.deepEqual(parseStoredDraft(JSON.stringify({ text: "hi", at: 3 })), {
      text: "hi",
      at: 3,
    });
  });

  it("input debounce writes local draft before server interval", () => {
    const storage = new Map();
    const store = {
      setItem(k, v) {
        storage.set(k, v);
      },
      getItem(k) {
        return storage.has(k) ? storage.get(k) : null;
      },
    };
    let saved = "";
    const lifecycle = createWorkDraftLifecycle({
      attemptId: "att-1",
      taskType: "work",
      getText: () => saved,
      storage: store,
      saveDraft: async (text) => {
        saved = text;
      },
      onInputDebounceMs: 5,
      serverIntervalMs: 60_000,
    });
    lifecycle.start();
    saved = "typed";
    lifecycle.scheduleLocalFromInput();
    return new Promise((resolve) => {
      setTimeout(() => {
        const parsed = parseStoredDraft(store.getItem(lifecycle.draftKey));
        assert.equal(parsed.text, "typed");
        lifecycle.stop();
        resolve();
      }, 30);
    });
  });

  it("lifecycle hide flushes local draft and keepalive PATCH", () => {
    const storage = new Map();
    const store = {
      setItem(k, v) {
        storage.set(k, v);
      },
      getItem(k) {
        return storage.has(k) ? storage.get(k) : null;
      },
    };
    const fetches = [];
    const lifecycle = createWorkDraftLifecycle({
      attemptId: "att-hide",
      taskType: "work",
      getText: () => "before reload",
      storage: store,
      saveDraft: async () => {},
      keepaliveDeps: {
        fetchImpl: (url, opts) => {
          fetches.push({ url, opts });
          return Promise.resolve({ ok: true });
        },
        sendBeacon: null,
      },
    });
    lifecycle.flushOnLifecycleHide();
    const parsed = parseStoredDraft(store.getItem(lifecycle.draftKey));
    assert.equal(parsed.text, "before reload");
    assert.equal(fetches.length, 1);
    assert.match(fetches[0].url, /\/draft$/);
    assert.equal(fetches[0].opts.keepalive, true);
  });

  it("sendDraftPatchKeepalive uses sendBeacon when available", () => {
    const beacons = [];
    const ok = sendDraftPatchKeepalive("a1", "text", {
      sendBeacon: (_url, blob) => {
        beacons.push(blob);
        return true;
      },
      fetchImpl: null,
    });
    assert.equal(ok, true);
    assert.equal(beacons.length, 1);
  });

  it("tasks.html loads draft helper and wires lifecycle hide + input debounce", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "../app/public/candidate/tasks.html"),
      "utf8"
    );
    assert.match(html, /tasks-draft-persist\.js/);
    assert.match(html, /HandCheckTasksDraft/);
    assert.match(html, /flushOnLifecycleHide/);
    assert.match(html, /scheduleLocalFromInput/);
    assert.doesNotMatch(html, /draftTimer/);
  });
});
