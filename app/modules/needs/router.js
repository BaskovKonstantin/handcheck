"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail, requireRole("employer"));

router.get("/needs", (req, res) => {
  const rows = getDb()
    .prepare("SELECT * FROM employer_needs WHERE employer_user_id = ? ORDER BY title")
    .all(req.user.id);
  res.json({
    items: rows.map((n) => ({
      id: n.id,
      title: n.title,
      specialization: n.specialization,
      grade: n.grade,
      stack: JSON.parse(n.stack_json || "[]"),
      domainText: n.domain_text,
      notes: n.notes,
      active: Boolean(n.active),
    })),
  });
});

router.post("/needs", (req, res) => {
  const id = newId();
  const {
    title = "",
    specialization = "backend",
    grade = "middle",
    stack = [],
    domainText = "",
    notes = "",
  } = req.body || {};
  getDb()
    .prepare(
      `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, req.user.id, title, specialization, grade, JSON.stringify(stack), domainText, notes);
  res.status(201).json({ id });
});

router.put("/needs/:id", (req, res, next) => {
  const db = getDb();
  const n = db
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(req.params.id, req.user.id);
  if (!n) return next(httpError(404, "not_found"));
  const body = req.body || {};
  db.prepare(
    `UPDATE employer_needs SET title = ?, specialization = ?, grade = ?, stack_json = ?, domain_text = ?, notes = ?, active = ?
     WHERE id = ?`
  ).run(
    body.title ?? n.title,
    body.specialization ?? n.specialization,
    body.grade ?? n.grade,
    JSON.stringify(body.stack ?? JSON.parse(n.stack_json)),
    body.domainText ?? n.domain_text,
    body.notes ?? n.notes,
    body.active === undefined ? n.active : body.active ? 1 : 0,
    n.id
  );
  res.json({ ok: true });
});

module.exports = router;
