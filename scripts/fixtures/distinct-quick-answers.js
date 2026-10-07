"use strict";

const base = require("./canonical-answer-ab.json");

const HONEST_QUICK_ANSWERS = [
  "Версионирую REST в пути /v1, пагинация cursor+limit, ошибки 400/404/409 с телом problem+json. Валидация DTO на входе, idempotency-key на платежах.",
  "Клиенту отдаю 422 с полями ошибок, 401 при протухшем JWT, 403 при нехватке роли. Логирую correlation-id, не светлю стек наружу.",
  "Повтор POST с тем же idempotency-key возвращает сохранённый ответ из Redis/Postgres, чтобы двойная оплата не прошла.",
  "Для справочников использую Redis с TTL, инвалидацию делаю через pub/sub при обновлении. Персональные данные в кэш не кладу.",
  "Access JWT короткий, refresh в httpOnly cookie, роли в claims и дублирую проверку в БД для критичных действий.",
  "Фоновые задачи в очереди (Bull/RQ): ретраи с backoff, dead-letter, воркеры горизонтально масштабируются.",
  "Миграции через Alembic/Flyway, обратно совместимые поля nullable, feature-flag на новое поведение API.",
  "Метрики Prometheus, структурные логи, алерты по SLO latency и error rate, трассировка OpenTelemetry.",
];

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
  const body = HONEST_QUICK_ANSWERS[index % HONEST_QUICK_ANSWERS.length] || HONEST_QUICK_ANSWERS[0];
  const lead = QUICK_LEADS[index % QUICK_LEADS.length] || QUICK_LEADS[0];
  return `${lead} ${body}`;
}

module.exports = {
  ...base,
  quickAnswer: HONEST_QUICK_ANSWERS[0],
  quickAnswerForIndex,
  QUICK_LEADS,
  HONEST_QUICK_ANSWERS,
};
