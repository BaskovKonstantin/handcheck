"use strict";

/** Prod round 41 keyword-list bodies (distinct per question shape). */
const KEYWORD_BLOB =
  "ошибки валидация 400 422 статус код идемпотентность повтор ключ dedup кэш redis инвалидация ttl jwt токен авторизация oauth роли очередь worker фон retry kafka rabbit postgres sql миграции метрики логи алерт монитор prometheus sentry endpoint rest http api запрос";

function rotateWords(text, shift) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return text;
  const n = shift % words.length;
  return [...words.slice(n), ...words.slice(0, n)].join(" ");
}

function trapAnswersVariantPunkt() {
  const out = [];
  for (let i = 0; i < 8; i += 1) {
    out.push(`Пункт ${i + 1}. ${KEYWORD_BLOB}`);
  }
  return out;
}

function trapAnswersVariantComma() {
  return trapAnswersVariantPunkt().map((_, i) => rotateWords(KEYWORD_BLOB, i + 1).replace(/ /g, ", "));
}

function trapAnswersVariantYaIspolzuyu() {
  return trapAnswersVariantPunkt().map((_, i) => `Я использую ${rotateWords(KEYWORD_BLOB, i + 2)}`);
}

function trapAnswersVariantBare() {
  return trapAnswersVariantPunkt().map((_, i) => rotateWords(KEYWORD_BLOB, i + 3));
}

module.exports = {
  KEYWORD_BLOB,
  trapAnswersVariantPunkt,
  trapAnswersVariantComma,
  trapAnswersVariantYaIspolzuyu,
  trapAnswersVariantBare,
};
