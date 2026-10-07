"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const { isEligibleForEmployerPool } = require("../app/lib/employer-pool-eligibility");
const { classifyRegistrationAge } = require("../app/lib/registration-age");
const { registerPayload, TEST_ADULT_BIRTH_DATE } = require("./register-payload");

function freshApp() {
  const tmpDb = path.join(os.tmpdir(), `hc-r58-${process.pid}-${Date.now()}.sqlite`);
  process.env.DB_PATH = tmpDb;
  process.env.DEMO_MODE = "1";
  process.env.DEMO_PASSWORD = "demo-demo-demo";
  for (const key of Object.keys(require.cache)) {
    if (key.includes("/app/")) delete require.cache[key];
  }
  const { createApp } = require("../app/server");
  return { app: createApp(), tmpDb };
}

describe("round58 findings", () => {
  describe("P1 employer pool gate", () => {
    it("requires confirmed email and display name or stack", () => {
      assert.equal(
        isEligibleForEmployerPool({
          email_confirmed_at: null,
          display_name: "Anna",
          email: "a@b.c",
          stack_json: "[]",
        }),
        false
      );
      assert.equal(
        isEligibleForEmployerPool({
          email_confirmed_at: "2020-01-01",
          display_name: "",
          email: "a@b.c",
          stack_json: "[]",
        }),
        false
      );
      assert.equal(
        isEligibleForEmployerPool({
          email_confirmed_at: "2020-01-01",
          display_name: "Anna",
          email: "a@b.c",
          stack_json: "[]",
        }),
        true
      );
      assert.equal(
        isEligibleForEmployerPool({
          email_confirmed_at: "2020-01-01",
          display_name: "",
          email: "a@b.c",
          stack_json: '["node"]',
        }),
        true
      );
    });

    let app;
    let tmpDb;

    before(() => {
      const fresh = freshApp();
      app = fresh.app;
      tmpDb = fresh.tmpDb;
    });

    after(() => {
      if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    });

    it("excludes registered-but-unconfirmed from loadCandidatesForNeed", async () => {
      const email = `r58-unconf-email-${Date.now()}@demo.local`;
      await request(app).post("/api/auth/register").send(registerPayload({ email }));
      const db = require("../app/db").getDb();
      const userId = db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
      db.prepare("UPDATE candidate_profiles SET display_name = ? WHERE user_id = ?").run(
        "Только регистрация",
        userId
      );

      const { loadCandidatesForNeed } = require("../app/modules/matching/pool");
      const employerId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
      const need = db
        .prepare("SELECT * FROM employer_needs WHERE employer_user_id = ?")
        .get(employerId);
      const pool = loadCandidatesForNeed(need, employerId);
      assert.ok(!pool.some((c) => c.id === userId));
    });

    it("keeps confirmed eligible unconfirmed (no test) in pool", async () => {
      const email = `r58-eligible-unconf-${Date.now()}@demo.local`;
      await request(app).post("/api/auth/register").send(registerPayload({ email }));
      await request(app).post("/api/auth/confirm").send({ email, code: "000000" });
      const db = require("../app/db").getDb();
      const userId = db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
      db.prepare("UPDATE candidate_profiles SET display_name = ?, stack_json = ? WHERE user_id = ?").run(
        "Готов без теста",
        JSON.stringify(["go"]),
        userId
      );

      const { loadCandidatesForNeed } = require("../app/modules/matching/pool");
      const employerId = db.prepare("SELECT id FROM users WHERE email = 'cafe@demo.local'").get().id;
      const need = db
        .prepare("SELECT * FROM employer_needs WHERE employer_user_id = ?")
        .get(employerId);
      const pool = loadCandidatesForNeed(need, employerId);
      const row = pool.find((c) => c.id === userId);
      assert.ok(row, "eligible unconfirmed candidate visible");
      assert.equal(row.categoryStatus, "unconfirmed");
    });
  });

  describe("P3 birth date validation", () => {
    it("rejects implausible ages at registration", async () => {
      const { app, tmpDb } = freshApp();
      try {
        const future = new Date();
        future.setUTCFullYear(future.getUTCFullYear() + 1);
        const futureIso = future.toISOString().slice(0, 10);
        const resFuture = await request(app)
          .post("/api/auth/register")
          .send(registerPayload({ email: `r58-future-${Date.now()}@demo.local`, birthDate: futureIso }));
        assert.equal(resFuture.status, 400);
        assert.match(resFuture.body.details.fields.birthDate, /будущем/i);

        const resOld = await request(app)
          .post("/api/auth/register")
          .send(
            registerPayload({
              email: `r58-old-${Date.now()}@demo.local`,
              birthDate: "1890-01-01",
            })
          );
        assert.equal(resOld.status, 400);
        assert.match(resOld.body.details.fields.birthDate, /реалистичн/i);
      } finally {
        if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
      }
    });

    it("classifyRegistrationAge flags future and too-old", () => {
      const future = new Date();
      future.setUTCFullYear(future.getUTCFullYear() + 2);
      const f = classifyRegistrationAge("candidate", future.toISOString().slice(0, 10));
      assert.equal(f.ok, false);
      assert.equal(f.code, "birth_date_in_future");

      const old = classifyRegistrationAge("candidate", "1890-06-15");
      assert.equal(old.ok, false);
      assert.equal(old.code, "birth_date_too_old");

      const adult = classifyRegistrationAge("candidate", TEST_ADULT_BIRTH_DATE);
      assert.equal(adult.ok, true);
    });
  });

  describe("P3 candidate today copy", () => {
    it("does not claim untested users are invisible in matching", () => {
      const html = fs.readFileSync(
        path.join(__dirname, "../app/public/candidate/today.html"),
        "utf8"
      );
      assert.ok(!html.includes("не появится в подборе"));
      assert.match(html, /неподтверждён/i);
    });
  });
});
