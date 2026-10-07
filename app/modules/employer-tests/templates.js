"use strict";

/** Built-in templates employers can clone into a draft test. */
const EMPLOYER_TEST_TEMPLATES = {
  "backend-api-basics": {
    title: "Backend: базовые вопросы по API",
    intro:
      "Короткий скрининг по REST, HTTP и контрактам API. Ответы кандидат видит без правильных вариантов.",
    items: [
      {
        kind: "single",
        prompt: "Какой HTTP-метод обычно используют для безопасного чтения ресурса без изменения состояния?",
        options: [
          { id: "a", label: "GET" },
          { id: "b", label: "POST" },
          { id: "c", label: "DELETE" },
          { id: "d", label: "PATCH" },
        ],
        answerKey: { correctIds: ["a"] },
        timeLimitSec: 90,
      },
      {
        kind: "multi",
        prompt: "Что из перечисленного чаще относят к идемпотентным методам HTTP?",
        options: [
          { id: "a", label: "PUT" },
          { id: "b", label: "POST" },
          { id: "c", label: "DELETE" },
          { id: "d", label: "GET" },
        ],
        answerKey: { correctIds: ["a", "c", "d"] },
        timeLimitSec: 120,
      },
      {
        kind: "text",
        prompt: "Что такое код ответа 409 Conflict и в какой ситуации его уместно вернуть?",
        rubricKeys: { keywords: ["конфликт", "версия", "состояние", "дубликат", "409"] },
        timeLimitSec: 180,
      },
      {
        kind: "code",
        prompt: "Напишите псевдокод или фрагмент на любом языке: эндпоинт GET /users/{id} с проверкой 404.",
        rubricKeys: { keywords: ["404", "not found", "id", "return", "status"] },
        timeLimitSec: 300,
      },
    ],
  },
  "qa-test-design": {
    title: "QA: тест-дизайн",
    intro: "Проверка мышления тестировщика: граничные случаи, приоритеты, артефакты.",
    items: [
      {
        kind: "single",
        prompt: "Что из перечисленного ближе к технике тест-дизайна «граничные значения»?",
        options: [
          { id: "a", label: "Проверка min, max и соседних значений" },
          { id: "b", label: "Случайный выбор 10% полей формы" },
          { id: "c", label: "Повтор одного сценария 100 раз" },
          { id: "d", label: "Сравнение с эталонным скриншотом без критериев" },
        ],
        answerKey: { correctIds: ["a"] },
        timeLimitSec: 90,
      },
      {
        kind: "multi",
        prompt: "Что полезно зафиксировать в баг-репорте перед передачей в разработку?",
        options: [
          { id: "a", label: "Шаги воспроизведения" },
          { id: "b", label: "Ожидаемый и фактический результат" },
          { id: "c", label: "Окружение и версия сборки" },
          { id: "d", label: "Личное мнение о виновном разработчике" },
        ],
        answerKey: { correctIds: ["a", "b", "c"] },
        timeLimitSec: 120,
      },
      {
        kind: "text",
        prompt: "Опишите три негативных сценария для поля «email» при регистрации.",
        rubricKeys: { keywords: ["пусто", "формат", "дубликат", "длина", "спецсимвол"] },
        timeLimitSec: 240,
      },
      {
        kind: "text",
        prompt: "Как бы вы приоритизировали тестирование релиза при нехватке времени?",
        rubricKeys: { keywords: ["риск", "критич", "smoke", "регресс", "пользовател"] },
        timeLimitSec: 240,
      },
    ],
  },
};

function listTemplateMeta() {
  return Object.entries(EMPLOYER_TEST_TEMPLATES).map(([key, t]) => ({
    key,
    title: t.title,
    intro: t.intro,
    itemCount: t.items.length,
  }));
}

function getTemplate(key) {
  return EMPLOYER_TEST_TEMPLATES[key] || null;
}

module.exports = { EMPLOYER_TEST_TEMPLATES, listTemplateMeta, getTemplate };
