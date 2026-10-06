"use strict";

const express = require("express");
const { getDb } = require("../../db");
const { newId } = require("../../lib/ids");
const { requireAuth, requireConfirmedEmail } = require("../../middleware/auth");
const { requireNotCandidate } = require("../../middleware/require-role");
const { httpError } = require("../../middleware/errors");
const config = require("../../config");
const { generateTask } = require("../../lib/llm-client");

const router = express.Router();

router.post("/generate", requireAuth, requireConfirmedEmail, requireNotCandidate, async (req, res, next) => {
  try {
    if (config.DEMO_MODE && req.headers["x-demo-admin"] !== "1") {
      throw httpError(403, "forbidden");
    }
    if (!config.LLM_BASE_URL) return res.status(501).json({ error: "llm_not_configured" });
    const specialization = String(req.body?.specialization || "");
    const grade = String(req.body?.grade || "");
    const type = req.body?.type === "work" ? "work" : "quick";
    const count = Math.min(10, Math.max(1, Number(req.body?.count) || 1));
    const created = [];
    for (let i = 0; i < count; i++) {
      const gen = await generateTask({ specialization, grade, type });
      const id = newId();
      getDb()
        .prepare(
          `INSERT INTO tasks (id, type, specialization, grade, form_key, prompt, rubric_json, status, origin)
           VALUES (?, ?, ?, ?, NULL, ?, ?, 'draft', 'llm')`
        )
        .run(
          id,
          type,
          specialization,
          grade,
          gen.prompt || "Задача",
          JSON.stringify(gen.rubric || { keys: [] })
        );
      created.push(id);
    }
    res.status(201).json({ ids: created });
  } catch (e) {
    next(e);
  }
});

router.post("/tasks/:id/publish", requireAuth, requireConfirmedEmail, requireNotCandidate, (req, res, next) => {
  const form_key = req.body?.form_key;
  if (!["A", "B"].includes(form_key)) return next(httpError(400, "invalid_form"));
  const db = getDb();
  const t = db.prepare("SELECT id FROM tasks WHERE id = ?").get(req.params.id);
  if (!t) return next(httpError(404, "not_found"));
  db.prepare("UPDATE tasks SET status = 'published', form_key = ? WHERE id = ?").run(form_key, t.id);
  res.json({ ok: true });
});

module.exports = router;
