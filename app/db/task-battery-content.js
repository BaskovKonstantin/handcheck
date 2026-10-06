"use strict";

const { newId } = require("../lib/ids");

/** Published backend × middle battery copy (forms A and B). */
const QUICK_PROMPTS = [
  "Как вы спроектируете HTTP API для мобильного клиента: версии, ошибки, пагинация?",
  "Как обрабатываете ошибки и валидацию входных данных на сервере?",
  "Что такое идемпотентность и как обеспечить её для повторных запросов оплаты?",
  "Как кэшируете ответы и когда инвалидируете кэш при изменении данных?",
  "Как организуете аутентификацию и авторизацию в сервисном API (токены, роли, срок жизни)?",
  "Как проектируете фоновые задачи и очереди для тяжёлых операций?",
  "Какие подходы к миграциям схемы БД и обратной совместимости API вы применяете?",
  "Как мониторите продакшен: метрики, логи, алерты и расследование инцидентов?",
];

const WORK_PROMPT =
  "Спроектируйте сервис бронирования столиков: API, хранение, конкурентные брони, уведомления и безопасность.";

const QUICK_RUBRIC = {
  keys: [
    ["api", "http", "rest", "endpoint", "запрос"],
    ["ошиб", "валидац", "400", "422", "статус", "код"],
    ["идемпот", "повтор", "ключ", "dedup"],
    ["кэш", "redis", "инвалида", "ttl"],
    ["jwt", "токен", "авторизац", "oauth", "рол"],
    ["очеред", "worker", "фон", "retry", "kafka", "rabbit"],
    ["миграц", "схем", "верси", "совместим"],
    ["метрик", "лог", "алерт", "монитор", "sentry", "prometheus"],
  ],
  breadthKeys: [["транзак", "блокиров", "очеред", "postgres", "sql"]],
  minLength: 80,
};

function quickRubricForIndex(index) {
  const group = QUICK_RUBRIC.keys[index];
  const keys = Array.isArray(group) ? group : group ? [group] : [];
  return {
    keys,
    breadthKeys: QUICK_RUBRIC.breadthKeys,
    minLength: QUICK_RUBRIC.minLength,
    questionIndex: index,
  };
}

const WORK_RUBRIC = {
  keys: [
    ["api", "http", "rest", "endpoint"],
    ["авторизац", "токен", "jwt", "безопас"],
  ],
  breadthKeys: [["брон", "слот", "конкур", "транзак", "очеред", "уведом"]],
  workItems: [
    { id: "storage", phrases: ["postgres", "sql", "баз", "хран"] },
    { id: "concurrency", phrases: ["блокиров", "транзак", "race", "конкур"] },
  ],
  minLength: 200,
};

function ensureEightQuickTasksForForm(db, form) {
  const ins = db.prepare(
    `INSERT INTO tasks (id, type, specialization, grade, form_key, prompt, rubric_json, status, origin)
     VALUES (?, 'quick', 'backend', 'middle', ?, ?, ?, 'published', 'manual')`
  );
  const count = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tasks WHERE type = 'quick' AND specialization = 'backend' AND grade = 'middle' AND form_key = ? AND status = 'published'`
    )
    .get(form).c;
  for (let i = count; i < QUICK_PROMPTS.length; i += 1) {
    ins.run(newId(), form, QUICK_PROMPTS[i], JSON.stringify(quickRubricForIndex(i)));
  }
}

function needsPerQuestionRubricPatch(db) {
  const row = db
    .prepare(
      `SELECT rubric_json FROM tasks WHERE type = 'quick' AND specialization = 'backend' AND grade = 'middle' AND status = 'published' LIMIT 1`
    )
    .get();
  if (!row?.rubric_json) return false;
  try {
    const rubric = JSON.parse(row.rubric_json);
    const keys = rubric.keys;
    return Array.isArray(keys) && keys.length > 1 && Array.isArray(keys[0]);
  } catch {
    return false;
  }
}

function applyBatteryContentPatch(db) {
  const totalQuick = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tasks WHERE type = 'quick' AND specialization = 'backend' AND grade = 'middle' AND status = 'published'`
    )
    .get().c;
  if (totalQuick === 0) return;

  const legacy = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tasks WHERE prompt LIKE 'QuickProbe%' OR prompt LIKE 'WorkSim%'`
    )
    .get().c;
  const needsContent =
    legacy > 0 || totalQuick < QUICK_PROMPTS.length * 2 || needsPerQuestionRubricPatch(db);
  if (!needsContent) return;

  const upd = db.prepare(`UPDATE tasks SET prompt = ?, rubric_json = ? WHERE id = ?`);
  for (const form of ["A", "B"]) {
    ensureEightQuickTasksForForm(db, form);
    const quickRows = db
      .prepare(
        `SELECT id FROM tasks WHERE type = 'quick' AND specialization = 'backend' AND grade = 'middle' AND form_key = ? AND status = 'published' ORDER BY rowid`
      )
      .all(form);
    quickRows.forEach((row, idx) => {
      if (idx < QUICK_PROMPTS.length) {
        upd.run(QUICK_PROMPTS[idx], JSON.stringify(quickRubricForIndex(idx)), row.id);
      }
    });
    const work = db
      .prepare(
        `SELECT id FROM tasks WHERE type = 'work' AND specialization = 'backend' AND grade = 'middle' AND form_key = ? AND status = 'published'`
      )
      .get(form);
    if (work) {
      upd.run(WORK_PROMPT, JSON.stringify(WORK_RUBRIC), work.id);
    }
  }
}

function seedBatteryTasks(db, ins) {
  for (const form of ["A", "B"]) {
    QUICK_PROMPTS.forEach((prompt, idx) => {
      ins.run(newId(), "quick", form, prompt, JSON.stringify(quickRubricForIndex(idx)));
    });
    ins.run(newId(), "work", form, WORK_PROMPT, JSON.stringify(WORK_RUBRIC));
  }
}

module.exports = {
  QUICK_PROMPTS,
  WORK_PROMPT,
  QUICK_RUBRIC,
  WORK_RUBRIC,
  quickRubricForIndex,
  applyBatteryContentPatch,
  seedBatteryTasks,
};
