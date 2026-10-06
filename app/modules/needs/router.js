"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const { validateNeedBody, employerNeedTitleTaken } = require("../../lib/need-validation");

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

router.post("/needs", (req, res, next) => {
  const parsed = validateNeedBody(req.body || {}, { requireTitle: true });
  if (!parsed.ok) return next(httpError(400, "invalid_body", { fields: parsed.fields }));
  const v = parsed.value;
  const db = getDb();
  if (employerNeedTitleTaken(db, req.user.id, v.title)) {
    return next(
      httpError(409, "need_duplicate_title", {
        message: "Потребность с таким названием уже есть",
      })
    );
  }
  const id = newId();
  const activeFlag = v.active === undefined ? 1 : v.active ? 1 : 0;
  db
    .prepare(
      `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, notes, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      req.user.id,
      v.title,
      v.specialization || "backend",
      v.grade || "middle",
      JSON.stringify(v.stack || []),
      v.domainText || "",
      v.notes || "",
      activeFlag
    );
  res.status(201).json({ id });
});

router.put("/needs/:id", (req, res, next) => {
  const db = getDb();
  const n = db
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(req.params.id, req.user.id);
  if (!n) return next(httpError(404, "not_found"));
  const merged = {
    title: req.body?.title ?? n.title,
    specialization: req.body?.specialization ?? n.specialization,
    grade: req.body?.grade ?? n.grade,
    stack: req.body?.stack !== undefined ? req.body.stack : JSON.parse(n.stack_json || "[]"),
    domainText: req.body?.domainText ?? n.domain_text,
    notes: req.body?.notes ?? n.notes,
    active: req.body?.active,
  };
  const parsed = validateNeedBody(merged, { requireTitle: true });
  if (!parsed.ok) return next(httpError(400, "invalid_body", { fields: parsed.fields }));
  const v = parsed.value;
  if (employerNeedTitleTaken(db, req.user.id, v.title, n.id)) {
    return next(
      httpError(409, "need_duplicate_title", {
        message: "Потребность с таким названием уже есть",
      })
    );
  }
  db.prepare(
    `UPDATE employer_needs SET title = ?, specialization = ?, grade = ?, stack_json = ?, domain_text = ?, notes = ?, active = ?
     WHERE id = ?`
  ).run(
    v.title,
    v.specialization,
    v.grade,
    JSON.stringify(v.stack || []),
    v.domainText || "",
    v.notes || "",
    v.active === undefined ? n.active : v.active ? 1 : 0,
    n.id
  );
  res.json({ ok: true });
});

module.exports = router;
