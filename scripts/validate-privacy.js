"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");
const request = require("supertest");

const tmpDb = path.join(os.tmpdir(), `hc-priv-${process.pid}.sqlite`);
if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
process.env.DB_PATH = tmpDb;
process.env.DEMO_MODE = "1";
process.env.DEMO_PASSWORD = "demo-demo-demo";

const { createApp } = require("../app/server");
const { getDb } = require("../app/db");
const { newId } = require("../app/lib/ids");

async function main() {
  const app = createApp();
  const db = getDb();
  const cafeAgent = request.agent(app);
  await cafeAgent.post("/api/auth/login").send({
    email: "cafe@demo.local",
    password: "demo-demo-demo",
  });
  const annaId = db.prepare("SELECT id FROM users WHERE email = 'anna@demo.local'").get().id;
  const need = db
    .prepare(
      "SELECT id FROM employer_needs WHERE employer_user_id = (SELECT id FROM users WHERE email = 'cafe@demo.local')"
    )
    .get();

  const deck = await cafeAgent.get(`/api/employer/needs/${need.id}/deck/next`);
  const body = JSON.stringify(deck.body);
  assert.ok(!body.includes("phone"), "P1 failed");
  console.log("P1 pass");

  const otherEmp = db.prepare("SELECT id FROM users WHERE email = 'other@demo.local'").get().id;
  const otherAgent = request.agent(app);
  await otherAgent.post("/api/auth/login").send({
    email: "other@demo.local",
    password: "demo-demo-demo",
  });
  const t0 = Date.now();
  const contactsDenied = await otherAgent.get(
    `/api/employer/candidates/${annaId}/contacts`
  );
  assert.equal(contactsDenied.status, 403, "P1b status");
  assert.ok(Date.now() - t0 < 3000, `P1b contacts must fail fast, took ${Date.now() - t0}ms`);
  console.log("P1b pass (contacts 403 fast)");

  const invId = (
    await cafeAgent.post("/api/employer/invitations").send({
      needId: need.id,
      candidateId: annaId,
      salaryFrom: 120000,
      salaryTo: 180000,
      offerText: "Присоединяйтесь",
      contactChannel: "telegram",
    })
  ).body.id;

  const annaAgent = request.agent(app);
  await annaAgent.post("/api/auth/login").send({
    email: "anna@demo.local",
    password: "demo-demo-demo",
  });
  await annaAgent.post(`/api/candidate/invitations/${invId}/accept`);

  const contacts = await cafeAgent.get(`/api/employer/candidates/${annaId}/contacts`);
  assert.ok(contacts.body.phone && contacts.body.contactEmail, "P2 failed");
  console.log("P2 pass");

  const inv2 = newId();
  db.prepare(
    `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
     VALUES (?, ?, ?, ?, 100, 200, 'x', 'tg', 'sent')`
  ).run(inv2, otherEmp, need.id, annaId);
  const invs = await annaAgent.get("/api/candidate/invitations");
  assert.equal(invs.body.items.filter((i) => i.status === "sent" || i.status === "accepted").length, 2, "P3");
  const avail = db.prepare("SELECT availability FROM candidate_profiles WHERE user_id = ?").get(annaId);
  assert.equal(avail.availability, "open", "P3 paused");
  console.log("P3 pass");

  const cat = await annaAgent.get("/api/candidate/category");
  const s = JSON.stringify(cat.body);
  assert.ok(!s.includes("test_score") && !s.includes("integrity"), "P4");
  console.log("P4 pass");

  const pendingInv = newId();
  db.prepare(
    `INSERT INTO invitations (id, employer_user_id, need_id, candidate_user_id, salary_from, salary_to, offer_text, contact_channel, status)
     VALUES (?, ?, ?, ?, 1, 2, 'o', 'tg', 'sent')`
  ).run(pendingInv, otherEmp, need.id, annaId);
  const p5 = await annaAgent.get(`/api/calls/for-invitation/${pendingInv}`);
  assert.equal(p5.status, 403, "P5");
  console.log("P5 pass");

  const callRes = await annaAgent.get(`/api/calls/for-invitation/${invId}`);
  const callId = callRes.body.callId;
  const start = await annaAgent.post(`/api/calls/${callId}/start`);
  assert.equal(start.status, 400, "P6");
  console.log("P6 pass");

  const badStart = await cafeAgent.post("/api/calls/not-a-uuid/start");
  assert.equal(badStart.status, 400, "P7 status");
  assert.equal(badStart.body.error, "invalid_id", "P7 error");
  const badConsent = await cafeAgent.post("/api/calls/not-a-uuid/consent").send({ accepted: true });
  assert.equal(badConsent.status, 400, "P7 consent");
  console.log("P7 pass (call id UUID guard)");

  const oversize = 81 * 1024 * 1024;
  const t413 = Date.now();
  const tooBig = await cafeAgent
    .post(`/api/calls/${callId}/recording`)
    .set("Content-Length", String(oversize))
    .send(Buffer.alloc(0));
  assert.equal(tooBig.status, 413, "P8 status");
  assert.ok(Date.now() - t413 < 3000, `P8 should reject fast, took ${Date.now() - t413}ms`);
  console.log("P8 pass (recording Content-Length 413)");

  console.log("validate-privacy: all pass");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
