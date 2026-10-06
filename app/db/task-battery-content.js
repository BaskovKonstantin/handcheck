"use strict";

const { newId } = require("../lib/ids");

/** Published backend × middle battery copy (forms A and B). */
const QUICK_PROMPTS = [
  "Как вы спроектируете HTTP API для мобильного клиента: версии, ошибки, пагинация?",
  "Как обрабатываете ошибки и валидацию входных данных на сервере?",
  "Что такое идемпотентность и как обеспечить её для повторных запросов оплаты?",
  "Как кэшируете ответы и когда инвалидируете кэш при изменении данных?",
];

const WORK_PROMPT =
  "Спроектируйте сервис бронирования столиков: API, хранение, конкурентные брони, уведомления и безопасность.";

const QUICK_RUBRIC = {
  keys: [
    ["api", "http", "rest", "endpoint", "запрос"],
    ["ошиб", "валидац", "400", "422", "статус", "код"],
    ["идемпот", "повтор", "ключ", "dedup"],
    ["кэш", "redis", "инвалида", "ttl"],
  ],
  breadthKeys: [["транзак", "блокиров", "очеред", "postgres", "sql"]],
  minLength: 80,
};

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

function applyBatteryContentPatch(db) {
  const legacy = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tasks WHERE prompt LIKE 'QuickProbe%' OR prompt LIKE 'WorkSim%'`
    )
    .get().c;
  if (!legacy) return;

  const upd = db.prepare(`UPDATE tasks SET prompt = ?, rubric_json = ? WHERE id = ?`);
  for (const form of ["A", "B"]) {
    const quickRows = db
      .prepare(
        `SELECT id FROM tasks WHERE type = 'quick' AND specialization = 'backend' AND grade = 'middle' AND form_key = ? AND status = 'published' ORDER BY rowid`
      )
      .all(form);
    quickRows.forEach((row, idx) => {
      if (idx < QUICK_PROMPTS.length) {
        upd.run(QUICK_PROMPTS[idx], JSON.stringify(QUICK_RUBRIC), row.id);
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
    QUICK_PROMPTS.forEach((prompt) => {
      ins.run(newId(), "quick", form, prompt, JSON.stringify(QUICK_RUBRIC));
    });
    ins.run(newId(), "work", form, WORK_PROMPT, JSON.stringify(WORK_RUBRIC));
  }
}

module.exports = {
  QUICK_PROMPTS,
  WORK_PROMPT,
  QUICK_RUBRIC,
  WORK_RUBRIC,
  applyBatteryContentPatch,
  seedBatteryTasks,
};
