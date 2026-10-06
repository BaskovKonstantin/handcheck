"use strict";

const WORK_ANSWER_MIN = 50;
const QUICK_ANSWER_MAX = 4000;
const WORK_ANSWER_MAX = 12000;

function answerMaxForType(taskType) {
  return taskType === "work" ? WORK_ANSWER_MAX : QUICK_ANSWER_MAX;
}

function validateAnswerText(text, taskType) {
  const fields = {};
  const trimmed = String(text ?? "").trim();
  const maxLen = answerMaxForType(taskType);
  if (!trimmed) {
    fields.answerText = "Напишите ответ";
    return { ok: false, fields, value: trimmed };
  }
  if (trimmed.length > maxLen) {
    fields.answerText = `Ответ слишком длинный (максимум ${maxLen} символов)`;
    return { ok: false, fields, value: trimmed };
  }
  if (taskType === "work" && trimmed.length < WORK_ANSWER_MIN) {
    fields.answerText = "Ответ слишком короткий";
    return { ok: false, fields, value: trimmed };
  }
  return { ok: true, fields: {}, value: trimmed };
}

module.exports = {
  validateAnswerText,
  WORK_ANSWER_MIN,
  QUICK_ANSWER_MAX,
  WORK_ANSWER_MAX,
  answerMaxForType,
};
