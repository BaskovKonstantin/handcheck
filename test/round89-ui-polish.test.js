"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const request = require("supertest");
const {
  employerReviewStatusLabel,
  matchesEmployerReviewStatusFilter,
} = require("../app/lib/employer-review-status");
const { renderInvitationCompanyTestsHtml } = require("../app/lib/employer-invitation-company-tests");

const esc = (s) => String(s);

describe("round 89 UI polish", () => {
  it("employerReviewStatusLabel distinguishes candidate decline from employer rejection", () => {
    assert.equal(employerReviewStatusLabel("declined"), "Отказался");
    assert.equal(employerReviewStatusLabel("rejected"), "Отказ");
    assert.equal(employerReviewStatusLabel("invited"), "Приглашён");
  });

  it("status filter treats declined and rejected separately", () => {
    const declined = { reviewDecision: "declined" };
    const rejected = { reviewDecision: "rejected" };
    assert.equal(matchesEmployerReviewStatusFilter(declined, "declined"), true);
    assert.equal(matchesEmployerReviewStatusFilter(declined, "rejected"), false);
    assert.equal(matchesEmployerReviewStatusFilter(rejected, "rejected"), true);
    assert.equal(matchesEmployerReviewStatusFilter(rejected, "declined"), false);
  });

  it("invitation company tests render one row per test without glued status line", () => {
    const { rowsHtml, reviewPanels } = renderInvitationCompanyTestsHtml(
      [
        {
          id: "a1",
          title: "Backend: базовые вопросы по API",
          status: "submitted",
          statusLabel: "Сдан",
        },
        {
          id: "a2",
          title: "Frontend: HTTP и работа с API",
          status: "submitted",
          statusLabel: "Сдан",
        },
      ],
      esc
    );
    assert.match(rowsHtml, /invite-company-test-row/);
    assert.equal((rowsHtml.match(/invite-company-test-row/g) || []).length, 2);
    assert.doesNotMatch(rowsHtml, /Тест «/);
    assert.doesNotMatch(rowsHtml, /Ответы: Backend/);
    assert.match(rowsHtml, /data-review-test="a1"/);
    assert.match(rowsHtml, /data-review-test="a2"/);
    assert.match(reviewPanels, /review-a1/);
    assert.match(reviewPanels, /review-a2/);
  });

  it("assigned company test row has status chip without answers button", () => {
    const { rowsHtml } = renderInvitationCompanyTestsHtml(
      [{ id: "x", title: "QA smoke", status: "assigned", statusLabel: "Назначен" }],
      esc
    );
    assert.match(rowsHtml, /Назначен/);
    assert.doesNotMatch(rowsHtml, /data-review-test/);
  });
});

describe("round 89 jury candidates API", () => {
  let app;

  before(() => {
    const tmpDb = path.join(os.tmpdir(), `hc-r89-${process.pid}.sqlite`);
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    process.env.DEMO_PASSWORD = "demo-demo-demo";
    delete require.cache[require.resolve("../app/server")];
    delete require.cache[require.resolve("../app/db")];
    delete require.cache[require.resolve("../scripts/seed-jury-pack")];
    const { createApp } = require("../app/server");
    app = createApp();
    const { seedJuryPack } = require("../scripts/seed-jury-pack");
    seedJuryPack();
  });

  it("marks jury Denis as declined (not employer rejected)", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "jury@demo.local", password: "demo-demo-demo" });
    const db = require("../app/db").getDb();
    const need = db
      .prepare(
        `SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'jury@demo.local') LIMIT 1`
      )
      .get();
    const res = await agent.get(`/api/employer/candidates?need=${need.id}`);
    assert.equal(res.status, 200);
    const denis = res.body.items.find((r) => String(r.displayName).includes("Денис"));
    assert.ok(denis, "expected Жюри Денис in need list");
    assert.equal(denis.reviewStatus, "declined");
    const onlyRejected = await agent.get(
      `/api/employer/candidates?need=${need.id}&status=rejected`
    );
    assert.ok(!onlyRejected.body.items.some((r) => r.id === denis.id));
    const onlyDeclined = await agent.get(
      `/api/employer/candidates?need=${need.id}&status=declined`
    );
    assert.ok(onlyDeclined.body.items.some((r) => r.id === denis.id));
  });
});
