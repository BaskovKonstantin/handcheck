"use strict";

const WORK_ANSWER_MIN = 50;

function validateAnswerText(text, taskType) {
  const fields = {};
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    fields.answerText = "Напишите ответ";
    return { ok: false, fields, value: trimmed };
  }
  if (taskType === "work" && trimmed.length < WORK_ANSWER_MIN) {
    fields.answerText = "Ответ слишком короткий";
    return { ok: false, fields, value: trimmed };
  }
  return { ok: true, fields: {}, value: trimmed };
}

module.exports = { validateAnswerText, WORK_ANSWER_MIN };
