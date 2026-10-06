"use strict";

const base = require("./canonical-answer-ab.json");

const QUICK_LEADS = [
  "Про HTTP API, версии и пагинацию:",
  "Про ошибки, валидацию и коды ответа:",
  "Про идемпотентность повторных запросов:",
  "Про кэширование и инвалидацию:",
  "Про аутентификацию, JWT и роли:",
  "Про фоновые задачи и очереди:",
  "Про миграции схемы и совместимость API:",
  "Про метрики, логи и алерты в проде:",
];

function quickAnswerForIndex(index) {
  const lead = QUICK_LEADS[index % QUICK_LEADS.length] || QUICK_LEADS[0];
  return `${lead} ${base.quickAnswer}`;
}

module.exports = {
  ...base,
  quickAnswerForIndex,
  QUICK_LEADS,
};
