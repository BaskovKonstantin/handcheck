"use strict";

const { newId } = require("../../lib/ids");
const { httpError } = require("../../middleware/errors");
const { getTemplate } = require("./templates");
const { validateItemBody } = require("./validation");

function assertEmployerOwnsTest(db, testId, employerUserId) {
  const row = db
    .prepare("SELECT * FROM employer_tests WHERE id = ? AND employer_user_id = ?")
    .get(testId, employerUserId);
  if (!row) throw httpError(404, "not_found");
  return row;
}

function assertEmployerOwnsNeed(db, needId, employerUserId) {
  const need = db
    .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
    .get(needId, employerUserId);
  if (!need) throw httpError(404, "not_found");
  return need;
}

function mapItemRow(r) {
  return {
    id: r.id,
    position: r.position,
    kind: r.kind,
    prompt: r.prompt,
    options: JSON.parse(r.options_json || "[]"),
    answerKey: JSON.parse(r.answer_key_json || "{}"),
    rubricKeys: JSON.parse(r.rubric_keys_json || "{}"),
    timeLimitSec: r.time_limit_sec,
  };
}

function mapTestRow(r, needTitle) {
  return {
    id: r.id,
    needId: r.need_id,
    needTitle: needTitle || null,
    title: r.title,
    intro: r.intro,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function loadTestWithItems(db, testId, employerUserId) {
  const test = assertEmployerOwnsTest(db, testId, employerUserId);
  const need = db.prepare("SELECT title FROM employer_needs WHERE id = ?").get(test.need_id);
  const items = db
    .prepare("SELECT * FROM employer_test_items WHERE test_id = ? ORDER BY position ASC")
    .all(testId)
    .map(mapItemRow);
  return { test: mapTestRow(test, need?.title), items };
}

function touchTest(db, testId) {
  db.prepare("UPDATE employer_tests SET updated_at = datetime('now') WHERE id = ?").run(testId);
}

function insertItem(db, testId, body, position) {
  const parsed = validateItemBody(body);
  if (!parsed.ok) throw httpError(400, "invalid_body", { fields: parsed.fields });
  const v = parsed.value;
  const id = newId();
  db.prepare(
    `INSERT INTO employer_test_items (id, test_id, position, kind, prompt, options_json, answer_key_json, rubric_keys_json, time_limit_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    testId,
    position,
    v.kind,
    v.prompt,
    JSON.stringify(v.options),
    JSON.stringify(v.answerKey),
    JSON.stringify(v.rubricKeys),
    v.timeLimitSec
  );
  touchTest(db, testId);
  return id;
}

function assertDraftEditable(test) {
  if (test.status !== "draft") {
    throw httpError(409, "test_not_editable", {
      message: "Редактировать можно только черновик",
    });
  }
}

function validatePublishable(items) {
  if (!items.length) {
    throw httpError(400, "invalid_body", {
      fields: { items: "Добавьте хотя бы один вопрос перед публикацией" },
    });
  }
  for (const it of items) {
    const parsed = validateItemBody({
      kind: it.kind,
      prompt: it.prompt,
      options: JSON.parse(it.options_json || "[]"),
      answerKey: JSON.parse(it.answer_key_json || "{}"),
      rubricKeys: JSON.parse(it.rubric_keys_json || "{}"),
      timeLimitSec: it.time_limit_sec,
    });
    if (!parsed.ok) {
      throw httpError(400, "invalid_body", {
        fields: { items: "Исправьте вопросы перед публикацией" },
        itemId: it.id,
        itemFields: parsed.fields,
      });
    }
  }
}

function cloneTemplateItems(db, testId, templateKey) {
  const tpl = getTemplate(templateKey);
  if (!tpl) throw httpError(400, "invalid_body", { fields: { templateKey: "Неизвестный шаблон" } });
  let pos = db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM employer_test_items WHERE test_id = ?").get(testId).m;
  pos += 1;
  for (const item of tpl.items) {
    insertItem(
      db,
      testId,
      {
        kind: item.kind,
        prompt: item.prompt,
        options: item.options || [],
        answerKey: item.answerKey || {},
        rubricKeys: item.rubricKeys || {},
        timeLimitSec: item.timeLimitSec,
      },
      pos
    );
    pos += 1;
  }
}

function candidateHasConfirmedCategory(db, candidateUserId) {
  const cat = db
    .prepare("SELECT 1 FROM candidate_categories WHERE candidate_user_id = ? LIMIT 1")
    .get(candidateUserId);
  return Boolean(cat);
}

function gradeChoiceAnswer(kind, answerKey, choiceIds) {
  const correct = new Set((answerKey?.correctIds || []).map(String));
  const chosen = new Set((choiceIds || []).map(String));
  if (kind === "single") {
    const ok = chosen.size === 1 && correct.size === 1 && chosen.has([...correct][0]);
    return ok;
  }
  if (kind === "multi") {
    if (correct.size !== chosen.size) return false;
    for (const id of correct) {
      if (!chosen.has(id)) return false;
    }
    return true;
  }
  return null;
}

const { keywordHits } = require("../../lib/russian-keyword-match");

function mostlyPasted(pasteChars, typedChars) {
  const p = Number(pasteChars) || 0;
  const t = Number(typedChars) || 0;
  const total = p + t;
  if (total < 24) return false;
  return p / total > 0.5;
}

module.exports = {
  assertEmployerOwnsTest,
  assertEmployerOwnsNeed,
  mapItemRow,
  mapTestRow,
  loadTestWithItems,
  touchTest,
  insertItem,
  assertDraftEditable,
  validatePublishable,
  cloneTemplateItems,
  candidateHasConfirmedCategory,
  gradeChoiceAnswer,
  keywordHits,
  mostlyPasted,
};
