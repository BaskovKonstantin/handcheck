"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const config = require("../../config");
const { validateTestMeta, validateItemBody } = require("./validation");
const { listTemplateMeta, getTemplate } = require("./templates");
const {
  assertEmployerOwnsTest,
  assertEmployerOwnsNeed,
  loadTestWithItems,
  touchTest,
  insertItem,
  assertDraftEditable,
  validatePublishable,
  cloneTemplateItems,
  mapItemRow,
  mapTestRow,
} = require("./service");
const { generateEmployerTestItems } = require("../../lib/employer-test-llm");
const {
  assignCompanyTest,
  loadAssignmentForEmployer,
  buildEmployerReview,
} = require("../../lib/company-test-flow");

const router = express.Router();
router.use(requireAuth, requireConfirmedEmail, requireRole("employer"));

router.get("/tests/config", (_req, res) => {
  res.json({
    llmConfigured: Boolean(config.LLM_BASE_URL),
    templates: listTemplateMeta(),
  });
});

router.get("/tests", (req, res) => {
  const db = getDb();
  const needFilter = req.query.needId ? String(req.query.needId) : "";
  const statusFilter = req.query.status ? String(req.query.status) : "";
  let sql = `SELECT t.*, n.title AS need_title
       FROM employer_tests t
       JOIN employer_needs n ON n.id = t.need_id
       WHERE t.employer_user_id = ? AND t.status != 'archived'`;
  const params = [req.user.id];
  if (needFilter) {
    sql += " AND t.need_id = ?";
    params.push(needFilter);
  }
  if (statusFilter) {
    sql += " AND t.status = ?";
    params.push(statusFilter);
  }
  sql += " ORDER BY n.title, t.updated_at DESC";
  const rows = db.prepare(sql).all(...params);
  const byNeed = new Map();
  for (const r of rows) {
    if (!byNeed.has(r.need_id)) {
      byNeed.set(r.need_id, { needId: r.need_id, needTitle: r.need_title, tests: [] });
    }
    byNeed.get(r.need_id).tests.push(mapTestRow(r, r.need_title));
  }
  res.json({ groups: [...byNeed.values()], templates: listTemplateMeta() });
});

router.post("/tests", (req, res, next) => {
  try {
    const db = getDb();
    const body = req.body || {};
    const templateKey = body.templateKey ? String(body.templateKey).trim() : "";
    const parsed = validateTestMeta({
      needId: body.needId,
      title: body.title || (templateKey ? "Новый тест" : undefined),
      intro: body.intro ?? "",
    });
    if (!parsed.ok) throw httpError(400, "invalid_body", { fields: parsed.fields });
    const need = assertEmployerOwnsNeed(db, parsed.value.needId, req.user.id);
    const tpl = templateKey ? getTemplate(templateKey) : null;
    if (templateKey && !tpl) {
      throw httpError(400, "invalid_body", { fields: { templateKey: "Неизвестный шаблон" } });
    }
    const title = tpl ? tpl.title : parsed.value.title;
    const intro = tpl ? tpl.intro : parsed.value.intro;
    const id = newId();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO employer_tests (id, employer_user_id, need_id, title, intro, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`
    ).run(id, req.user.id, need.id, title, intro, now, now);
    if (tpl) cloneTemplateItems(db, id, templateKey);
    res.status(201).json({ id });
  } catch (e) {
    next(e);
  }
});

router.get("/tests/:id", (req, res, next) => {
  try {
    const db = getDb();
    const data = loadTestWithItems(db, req.params.id, req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.put("/tests/:id", (req, res, next) => {
  try {
    const db = getDb();
    const test = assertEmployerOwnsTest(db, req.params.id, req.user.id);
    assertDraftEditable(test);
    const fields = {};
    let title = test.title;
    let intro = test.intro;
    let needId = test.need_id;
    if (req.body?.title !== undefined) {
      const t = String(req.body.title).trim();
      if (!t) fields.title = "Укажите название";
      else if (t.length > 200) fields.title = "Название — не длиннее 200 символов";
      else title = t;
    }
    if (req.body?.intro !== undefined) {
      intro = String(req.body.intro);
      if (intro.length > 4000) fields.intro = "Вступление — не длиннее 4000 символов";
    }
    if (req.body?.needId !== undefined) {
      const n = String(req.body.needId).trim();
      if (!n) fields.needId = "Выберите потребность";
      else {
        assertEmployerOwnsNeed(db, n, req.user.id);
        needId = n;
      }
    }
    if (Object.keys(fields).length) throw httpError(400, "invalid_body", { fields });
    db.prepare(
      `UPDATE employer_tests SET title = ?, intro = ?, need_id = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(title, intro, needId, test.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete("/tests/:id", (req, res, next) => {
  try {
    const db = getDb();
    const test = assertEmployerOwnsTest(db, req.params.id, req.user.id);
    if (test.status === "archived") return res.json({ ok: true });
    db.prepare(
      `UPDATE employer_tests SET status = 'archived', updated_at = datetime('now') WHERE id = ?`
    ).run(test.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/tests/:id/publish", (req, res, next) => {
  try {
    const db = getDb();
    const test = assertEmployerOwnsTest(db, req.params.id, req.user.id);
    if (test.status === "published") return res.json({ ok: true, status: "published" });
    assertDraftEditable(test);
    const items = db
      .prepare("SELECT * FROM employer_test_items WHERE test_id = ? ORDER BY position")
      .all(test.id);
    validatePublishable(items);
    db.prepare(
      `UPDATE employer_tests SET status = 'published', updated_at = datetime('now') WHERE id = ?`
    ).run(test.id);
    res.json({ ok: true, status: "published" });
  } catch (e) {
    next(e);
  }
});

router.post("/tests/:id/clone-template", (req, res, next) => {
  try {
    const db = getDb();
    const test = assertEmployerOwnsTest(db, req.params.id, req.user.id);
    assertDraftEditable(test);
    const templateKey = String(req.body?.templateKey || "").trim();
    if (!templateKey) {
      throw httpError(400, "invalid_body", { fields: { templateKey: "Выберите шаблон" } });
    }
    cloneTemplateItems(db, test.id, templateKey);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/tests/:id/generate", async (req, res, next) => {
  try {
    if (!config.LLM_BASE_URL) {
      return res.status(501).json({
        error: "llm_not_configured",
        message: "Генерация недоступна без LLM",
      });
    }
    if (config.DEMO_MODE && req.headers["x-demo-admin"] !== "1") {
      throw httpError(403, "forbidden");
    }
    const db = getDb();
    const test = assertEmployerOwnsTest(db, req.params.id, req.user.id);
    assertDraftEditable(test);
    const need = db.prepare("SELECT * FROM employer_needs WHERE id = ?").get(test.need_id);
    const gen = await generateEmployerTestItems({
      needTitle: need.title,
      specialization: need.specialization,
      grade: need.grade,
      intro: test.intro,
    });
    if (gen.error) {
      return res.status(501).json({ error: gen.error, message: "Генерация недоступна без LLM" });
    }
    let pos = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM employer_test_items WHERE test_id = ?").get(test.id).m;
    pos += 1;
    for (const item of gen.items.slice(0, 8)) {
      try {
        insertItem(db, test.id, item, pos);
        pos += 1;
      } catch {
        /* skip invalid LLM rows */
      }
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/tests/:id/items", (req, res, next) => {
  try {
    const db = getDb();
    const test = assertEmployerOwnsTest(db, req.params.id, req.user.id);
    assertDraftEditable(test);
    const maxPos = db
      .prepare("SELECT COALESCE(MAX(position), -1) AS m FROM employer_test_items WHERE test_id = ?")
      .get(test.id).m;
    const id = insertItem(db, test.id, req.body || {}, maxPos + 1);
    const row = db.prepare("SELECT * FROM employer_test_items WHERE id = ?").get(id);
    res.status(201).json({ id, item: mapItemRow(row) });
  } catch (e) {
    next(e);
  }
});

router.put("/tests/:id/items/:itemId", (req, res, next) => {
  try {
    const db = getDb();
    const test = assertEmployerOwnsTest(db, req.params.id, req.user.id);
    assertDraftEditable(test);
    const existing = db
      .prepare("SELECT * FROM employer_test_items WHERE id = ? AND test_id = ?")
      .get(req.params.itemId, test.id);
    if (!existing) throw httpError(404, "not_found");
    const merged = {
      kind: req.body?.kind ?? existing.kind,
      prompt: req.body?.prompt ?? existing.prompt,
      options: req.body?.options ?? JSON.parse(existing.options_json || "[]"),
      answerKey: req.body?.answerKey ?? JSON.parse(existing.answer_key_json || "{}"),
      rubricKeys: req.body?.rubricKeys ?? JSON.parse(existing.rubric_keys_json || "{}"),
      timeLimitSec:
        req.body?.timeLimitSec !== undefined ? req.body.timeLimitSec : existing.time_limit_sec,
    };
    const parsed = validateItemBody(merged);
    if (!parsed.ok) throw httpError(400, "invalid_body", { fields: parsed.fields });
    const v = parsed.value;
    db.prepare(
      `UPDATE employer_test_items SET kind = ?, prompt = ?, options_json = ?, answer_key_json = ?, rubric_keys_json = ?, time_limit_sec = ?
       WHERE id = ?`
    ).run(
      v.kind,
      v.prompt,
      JSON.stringify(v.options),
      JSON.stringify(v.answerKey),
      JSON.stringify(v.rubricKeys),
      v.timeLimitSec,
      existing.id
    );
    touchTest(db, test.id);
    const row = db.prepare("SELECT * FROM employer_test_items WHERE id = ?").get(existing.id);
    res.json({ item: mapItemRow(row) });
  } catch (e) {
    next(e);
  }
});

router.delete("/tests/:id/items/:itemId", (req, res, next) => {
  try {
    const db = getDb();
    const test = assertEmployerOwnsTest(db, req.params.id, req.user.id);
    assertDraftEditable(test);
    const del = db
      .prepare("DELETE FROM employer_test_items WHERE id = ? AND test_id = ?")
      .run(req.params.itemId, test.id);
    if (!del.changes) throw httpError(404, "not_found");
    const rest = db
      .prepare("SELECT id FROM employer_test_items WHERE test_id = ? ORDER BY position ASC")
      .all(test.id);
    const upd = db.prepare("UPDATE employer_test_items SET position = ? WHERE id = ?");
    rest.forEach((r, i) => upd.run(i, r.id));
    touchTest(db, test.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/tests/:id/assign", (req, res, next) => {
  try {
    const db = getDb();
    const result = assignCompanyTest(db, req.user.id, req.params.id, {
      candidateId: req.body?.candidateId,
      invitationId: req.body?.invitationId,
      dueAt: req.body?.dueAt,
    });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

router.get("/test-assignments/:assignmentId", (req, res, next) => {
  try {
    const db = getDb();
    const assignment = loadAssignmentForEmployer(db, req.params.assignmentId, req.user.id);
    res.json(buildEmployerReview(db, assignment));
  } catch (e) {
    next(e);
  }
});

router.post("/tests/:id/items/reorder", (req, res, next) => {
  try {
    const db = getDb();
    const test = assertEmployerOwnsTest(db, req.params.id, req.user.id);
    assertDraftEditable(test);
    const order = req.body?.order;
    if (!Array.isArray(order) || !order.length) {
      throw httpError(400, "invalid_body", { fields: { order: "Передайте массив id вопросов" } });
    }
    const existing = db
      .prepare("SELECT id FROM employer_test_items WHERE test_id = ?")
      .all(test.id)
      .map((r) => r.id);
    if (order.length !== existing.length || !order.every((id) => existing.includes(id))) {
      throw httpError(400, "invalid_body", { fields: { order: "Список вопросов не совпадает с тестом" } });
    }
    const upd = db.prepare("UPDATE employer_test_items SET position = ? WHERE id = ? AND test_id = ?");
    order.forEach((id, i) => upd.run(i, id, test.id));
    touchTest(db, test.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
