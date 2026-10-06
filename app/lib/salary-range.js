"use strict";

function parseSalaryRange(salaryFrom, salaryTo) {
  const fields = {};
  const fromMissing =
    salaryFrom === "" || salaryFrom === null || salaryFrom === undefined;
  const toMissing = salaryTo === "" || salaryTo === null || salaryTo === undefined;
  if (fromMissing || toMissing) {
    fields.salaryRange = "Укажите вилку зарплаты";
    return { fields, from: null, to: null };
  }
  const from = Number(salaryFrom);
  const to = Number(salaryTo);
  if (!Number.isInteger(from)) {
    fields.salaryRange = "Укажите целое число в поле «От»";
  } else if (from < 0) {
    fields.salaryRange = "Вилка не может быть отрицательной";
  }
  if (!Number.isInteger(to)) {
    fields.salaryRange = fields.salaryRange || "Укажите целое число в поле «До»";
  } else if (to < 0) {
    fields.salaryRange = fields.salaryRange || "Вилка не может быть отрицательной";
  }
  if (Number.isInteger(from) && from === 0 && Number.isInteger(to) && to === 0) {
    fields.salaryRange = "Укажите вилку зарплаты";
  }
  if (Number.isInteger(from) && Number.isInteger(to) && from > to) {
    if (!fields.salaryRange) {
      fields.salaryRange = "Вилка зарплаты: «От» не может быть больше «До»";
    }
  }
  const SALARY_MAX = 100_000_000;
  if (Number.isInteger(from) && from > SALARY_MAX) {
    fields.salaryRange = "Слишком большая сумма в поле «От»";
  }
  if (Number.isInteger(to) && to > SALARY_MAX) {
    fields.salaryRange = fields.salaryRange || "Слишком большая сумма в поле «До»";
  }
  const SALARY_MIN = 10_000;
  if (Number.isInteger(from) && from > 0 && from < SALARY_MIN) {
    fields.salaryRange = `Минимальная сумма в поле «От» — ${SALARY_MIN.toLocaleString("ru-RU")} ₽`;
  }
  if (Number.isInteger(to) && to > 0 && to < SALARY_MIN) {
    fields.salaryRange =
      fields.salaryRange ||
      `Минимальная сумма в поле «До» — ${SALARY_MIN.toLocaleString("ru-RU")} ₽`;
  }
  return { fields, from, to };
}

module.exports = { parseSalaryRange };
