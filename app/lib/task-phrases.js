"use strict";

function buildTaskPhrases({ quickSubmittedCount, workSubmittedOnTime, hadDraft }) {
  const phrases = [];
  phrases.push(
    quickSubmittedCount >= 4
      ? "Короткие ответы по API сданы"
      : "Короткие ответы сданы не все"
  );
  phrases.push(
    workSubmittedOnTime
      ? "Рабочая задача доведена до конца"
      : "Рабочая задача не сдана"
  );
  phrases.push(
    hadDraft
      ? "По ходу задачи были промежуточные черновики"
      : "Задача сдана одним ответом"
  );
  return phrases;
}

module.exports = { buildTaskPhrases };
