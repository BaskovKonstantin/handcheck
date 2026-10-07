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

/** Parallel form B — same rubric, different wording. */
const QUICK_PROMPTS_FORM_B = [
  "Опишите дизайн REST API для мобильного приложения: версионирование, коды ошибок, постраничная выдача.",
  "Расскажите, как на бэкенде валидируете вход и возвращаете понятные ошибки клиенту.",
  "Объясните идемпотентность на примере повторного запроса оплаты — что храните и как отвечаете.",
  "Как устроите кэш ответов и сброс кэша, когда данные в источнике меняются?",
  "Как выдаёте и проверяете токены доступа, разграничиваете роли в сервисном API?",
  "Как вынесете долгие операции в фон: очередь, воркеры, повтор при сбоях?",
  "Как безопасно меняете схему БД и не ломаете старых клиентов API?",
  "Какие метрики и логи смотрите в проде и как реагируете на инцидент?",
];

const WORK_PROMPT =
  "Спроектируйте сервис бронирования столиков: API, хранение, конкурентные брони, уведомления и безопасность.";

const WORK_PROMPT_FORM_B =
  "Опишите архитектуру сервиса бронирования столиков: контракт API, хранение, гонки за слот, уведомления и защита.";

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

function quickPromptsForForm(form) {
  return form === "B" ? QUICK_PROMPTS_FORM_B : QUICK_PROMPTS;
}

function workPromptForForm(form) {
  return form === "B" ? WORK_PROMPT_FORM_B : WORK_PROMPT;
}

function ensureEightQuickTasksForForm(db, form) {
  const prompts = quickPromptsForForm(form);
  const ins = db.prepare(
    `INSERT INTO tasks (id, type, specialization, grade, form_key, prompt, rubric_json, status, origin)
     VALUES (?, 'quick', 'backend', 'middle', ?, ?, ?, 'published', 'manual')`
  );
  const count = db
    .prepare(
      `SELECT COUNT(*) AS c FROM tasks WHERE type = 'quick' AND specialization = 'backend' AND grade = 'middle' AND form_key = ? AND status = 'published'`
    )
    .get(form).c;
  for (let i = count; i < prompts.length; i += 1) {
    ins.run(newId(), form, prompts[i], JSON.stringify(quickRubricForIndex(i)));
  }
}

function formsHaveIdenticalPrompts(db) {
  const rowsA = db
    .prepare(
      `SELECT prompt FROM tasks WHERE type IN ('quick','work') AND specialization = 'backend' AND grade = 'middle' AND form_key = 'A' AND status = 'published' ORDER BY type, rowid`
    )
    .all()
    .map((r) => r.prompt);
  const rowsB = db
    .prepare(
      `SELECT prompt FROM tasks WHERE type IN ('quick','work') AND specialization = 'backend' AND grade = 'middle' AND form_key = 'B' AND status = 'published' ORDER BY type, rowid`
    )
    .all()
    .map((r) => r.prompt);
  if (rowsA.length === 0 || rowsA.length !== rowsB.length) return false;
  return rowsA.every((p, i) => p === rowsB[i]);
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
    legacy > 0 ||
    totalQuick < QUICK_PROMPTS.length * 2 ||
    needsPerQuestionRubricPatch(db) ||
    formsHaveIdenticalPrompts(db);
  if (!needsContent) return;

  const upd = db.prepare(`UPDATE tasks SET prompt = ?, rubric_json = ? WHERE id = ?`);
  for (const form of ["A", "B"]) {
    const prompts = quickPromptsForForm(form);
    ensureEightQuickTasksForForm(db, form);
    const quickRows = db
      .prepare(
        `SELECT id FROM tasks WHERE type = 'quick' AND specialization = 'backend' AND grade = 'middle' AND form_key = ? AND status = 'published' ORDER BY rowid`
      )
      .all(form);
    quickRows.forEach((row, idx) => {
      if (idx < prompts.length) {
        upd.run(prompts[idx], JSON.stringify(quickRubricForIndex(idx)), row.id);
      }
    });
    const work = db
      .prepare(
        `SELECT id FROM tasks WHERE type = 'work' AND specialization = 'backend' AND grade = 'middle' AND form_key = ? AND status = 'published'`
      )
      .get(form);
    if (work) {
      upd.run(workPromptForForm(form), JSON.stringify(WORK_RUBRIC), work.id);
    }
  }
}

function seedBatteryTasks(db, ins) {
  for (const form of ["A", "B"]) {
    quickPromptsForForm(form).forEach((prompt, idx) => {
      ins.run(newId(), "quick", form, prompt, JSON.stringify(quickRubricForIndex(idx)));
    });
    ins.run(newId(), "work", form, workPromptForForm(form), JSON.stringify(WORK_RUBRIC));
  }
}

module.exports = {
  QUICK_PROMPTS,
  QUICK_PROMPTS_FORM_B,
  WORK_PROMPT,
  WORK_PROMPT_FORM_B,
  QUICK_RUBRIC,
  WORK_RUBRIC,
  quickRubricForIndex,
  applyBatteryContentPatch,
  seedBatteryTasks,
};
