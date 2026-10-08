"use strict";

function pluralRu(n, one, few, many) {
  const abs = Math.abs(Number(n)) % 100;
  const rem = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (rem === 1) return one;
  if (rem >= 2 && rem <= 4) return few;
  return many;
}

function formatQuestionsRu(count) {
  const n = Number(count) || 0;
  return `${n} ${pluralRu(n, "вопрос", "вопроса", "вопросов")}`;
}

module.exports = {
  pluralRu,
  formatQuestionsRu,
};
