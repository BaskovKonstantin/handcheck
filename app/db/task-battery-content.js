"use strict";

const { newId } = require("../lib/ids");
const {
  SPECS,
  GRADES,
  getBatteryDefinition,
  listPlatformCategories,
  quickRubricFromItem,
  ensureCategories,
} = require("./battery-catalog");

const backendMiddleDef = getBatteryDefinition("backend", "middle");
const QUICK_PROMPTS = backendMiddleDef.quick.map((q) => q.promptA);
const QUICK_PROMPTS_FORM_B = backendMiddleDef.quick.map((q) => q.promptB);
const WORK_PROMPT = backendMiddleDef.work.promptA;
const WORK_PROMPT_FORM_B = backendMiddleDef.work.promptB;
const QUICK_RUBRIC = {
  keys: backendMiddleDef.quick.map((q) => q.keys[0]),
  breadthKeys: backendMiddleDef.quick[0]?.breadthKeys || [],
  minLength: 80,
};
const WORK_RUBRIC = backendMiddleDef.work.rubric;

function quickPromptsForForm(def, form) {
  return def.quick.map((q) => (form === "B" ? q.promptB : q.promptA));
}

function workPromptForForm(def, form) {
  return form === "B" ? def.work.promptB : def.work.promptA;
}

function quickRubricForIndex(def, grade, index) {
  const item = def.quick[index];
  if (!item) {
    return { keys: [], breadthKeys: [], minLength: 80, questionIndex: index };
  }
  return quickRubricFromItem(item, grade, index);
}

function countPublishedQuick(db, specialization, grade, form) {
  return db
    .prepare(
      `SELECT COUNT(*) AS c FROM tasks WHERE type = 'quick' AND specialization = ? AND grade = ? AND form_key = ? AND status = 'published'`
    )
    .get(specialization, grade, form).c;
}

function ensureEightQuickTasksForForm(db, specialization, grade, form, def) {
  const prompts = quickPromptsForForm(def, form);
  const ins = db.prepare(
    `INSERT INTO tasks (id, type, specialization, grade, form_key, prompt, rubric_json, status, origin)
     VALUES (?, 'quick', ?, ?, ?, ?, ?, 'published', 'manual')`
  );
  const count = countPublishedQuick(db, specialization, grade, form);
  for (let i = count; i < prompts.length; i += 1) {
    ins.run(
      newId(),
      specialization,
      grade,
      form,
      prompts[i],
      JSON.stringify(quickRubricForIndex(def, grade, i))
    );
  }
}

function ensureWorkTaskForForm(db, specialization, grade, form, def) {
  const existing = db
    .prepare(
      `SELECT id FROM tasks WHERE type = 'work' AND specialization = ? AND grade = ? AND form_key = ? AND status = 'published'`
    )
    .get(specialization, grade, form);
  if (existing) return;
  db.prepare(
    `INSERT INTO tasks (id, type, specialization, grade, form_key, prompt, rubric_json, status, origin)
     VALUES (?, 'work', ?, ?, ?, ?, ?, 'published', 'manual')`
  ).run(
    newId(),
    specialization,
    grade,
    form,
    workPromptForForm(def, form),
    JSON.stringify(def.work.rubric)
  );
}

function ensureBatteryForCategory(db, specialization, grade) {
  const def = getBatteryDefinition(specialization, grade);
  if (!def) return;
  for (const form of ["A", "B"]) {
    ensureEightQuickTasksForForm(db, specialization, grade, form, def);
    ensureWorkTaskForForm(db, specialization, grade, form, def);
  }
}

function formsHaveIdenticalPrompts(db, specialization, grade) {
  const rowsA = db
    .prepare(
      `SELECT prompt FROM tasks WHERE type IN ('quick','work') AND specialization = ? AND grade = ? AND form_key = 'A' AND status = 'published' ORDER BY type, rowid`
    )
    .all(specialization, grade)
    .map((r) => r.prompt);
  const rowsB = db
    .prepare(
      `SELECT prompt FROM tasks WHERE type IN ('quick','work') AND specialization = ? AND grade = ? AND form_key = 'B' AND status = 'published' ORDER BY type, rowid`
    )
    .all(specialization, grade)
    .map((r) => r.prompt);
  if (rowsA.length === 0 || rowsA.length !== rowsB.length) return false;
  return rowsA.every((p, i) => p === rowsB[i]);
}

function needsPerQuestionRubricPatch(db, specialization, grade) {
  const row = db
    .prepare(
      `SELECT rubric_json FROM tasks WHERE type = 'quick' AND specialization = ? AND grade = ? AND status = 'published' LIMIT 1`
    )
    .get(specialization, grade);
  if (!row?.rubric_json) return false;
  try {
    const rubric = JSON.parse(row.rubric_json);
    const keys = rubric.keys;
    return Array.isArray(keys) && keys.length > 1 && Array.isArray(keys[0]);
  } catch {
    return false;
  }
}

function patchBackendMiddleContentIfNeeded(db) {
  const specialization = "backend";
  const grade = "middle";
  const def = getBatteryDefinition(specialization, grade);
  if (!def) return;

  const totalQuick = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tasks WHERE type = 'quick' AND specialization = ? AND grade = ? AND status = 'published'`
    )
    .get(specialization, grade).c;
  if (totalQuick === 0) return;

  const legacy = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tasks WHERE prompt LIKE 'QuickProbe%' OR prompt LIKE 'WorkSim%'`
    )
    .get().c;
  const needsContent =
    legacy > 0 ||
    totalQuick < def.quick.length * 2 ||
    needsPerQuestionRubricPatch(db, specialization, grade) ||
    formsHaveIdenticalPrompts(db, specialization, grade);
  if (!needsContent) return;

  const upd = db.prepare(`UPDATE tasks SET prompt = ?, rubric_json = ? WHERE id = ?`);
  for (const form of ["A", "B"]) {
    const prompts = quickPromptsForForm(def, form);
    ensureEightQuickTasksForForm(db, specialization, grade, form, def);
    const quickRows = db
      .prepare(
        `SELECT id FROM tasks WHERE type = 'quick' AND specialization = ? AND grade = ? AND form_key = ? AND status = 'published' ORDER BY rowid`
      )
      .all(specialization, grade, form);
    quickRows.forEach((row, idx) => {
      if (idx < prompts.length) {
        upd.run(prompts[idx], JSON.stringify(quickRubricForIndex(def, grade, idx)), row.id);
      }
    });
    const work = db
      .prepare(
        `SELECT id FROM tasks WHERE type = 'work' AND specialization = ? AND grade = ? AND form_key = ? AND status = 'published'`
      )
      .get(specialization, grade, form);
    if (work) {
      upd.run(workPromptForForm(def, form), JSON.stringify(def.work.rubric), work.id);
    } else {
      ensureWorkTaskForForm(db, specialization, grade, form, def);
    }
  }
}

function flattenNestedQuickRubrics(db) {
  const rows = db
    .prepare(`SELECT id, rubric_json FROM tasks WHERE type = 'quick' AND status = 'published'`)
    .all();
  const upd = db.prepare(`UPDATE tasks SET rubric_json = ? WHERE id = ?`);
  for (const row of rows) {
    try {
      const rubric = JSON.parse(row.rubric_json);
      if (
        Array.isArray(rubric.keys) &&
        rubric.keys.length > 0 &&
        Array.isArray(rubric.keys[0])
      ) {
        rubric.keys = rubric.keys.length === 1 ? rubric.keys[0] : rubric.keys.flat();
        upd.run(JSON.stringify(rubric), row.id);
      }
    } catch {
      /* ignore */
    }
  }
}

function applyBatteryContentPatch(db) {
  ensureCategories(db);
  for (const { specialization, grade } of listPlatformCategories()) {
    ensureBatteryForCategory(db, specialization, grade);
  }
  patchBackendMiddleContentIfNeeded(db);
  flattenNestedQuickRubrics(db);
}

function seedBatteryTasks(db, ins, specialization, grade) {
  const def = getBatteryDefinition(specialization, grade);
  if (!def) return;
  for (const form of ["A", "B"]) {
    quickPromptsForForm(def, form).forEach((prompt, idx) => {
      ins.run(
        newId(),
        "quick",
        specialization,
        grade,
        form,
        prompt,
        JSON.stringify(quickRubricForIndex(def, grade, idx))
      );
    });
    ins.run(
      newId(),
      "work",
      specialization,
      grade,
      form,
      workPromptForForm(def, form),
      JSON.stringify(def.work.rubric)
    );
  }
}

function seedAllPlatformBatteries(db) {
  const ins = db.prepare(
    `INSERT INTO tasks (id, type, specialization, grade, form_key, prompt, rubric_json, status, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'published', 'manual')`
  );
  for (const specialization of SPECS) {
    for (const grade of GRADES) {
      seedBatteryTasks(db, ins, specialization, grade);
    }
  }
}

module.exports = {
  QUICK_PROMPTS,
  QUICK_PROMPTS_FORM_B,
  WORK_PROMPT,
  WORK_PROMPT_FORM_B,
  QUICK_RUBRIC,
  WORK_RUBRIC,
  quickRubricForIndex: (index) => quickRubricForIndex(backendMiddleDef, "middle", index),
  applyBatteryContentPatch,
  seedBatteryTasks,
  seedAllPlatformBatteries,
  ensureBatteryForCategory,
  SPECS,
  GRADES,
};
