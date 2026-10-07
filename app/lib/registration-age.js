"use strict";

/** Parse YYYY-MM-DD; returns { y, m, d } or null. */
function parseBirthDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, mo, d };
}

const MAX_REGISTRATION_AGE_YEARS = 100;

/** Full years on reference date (UTC calendar). */
function ageYearsOnDate(birth, ref = new Date()) {
  const ry = ref.getUTCFullYear();
  const rm = ref.getUTCMonth() + 1;
  const rd = ref.getUTCDate();
  let age = ry - birth.y;
  if (rm < birth.mo || (rm === birth.mo && rd < birth.d)) age -= 1;
  return age;
}

/**
 * Registration age gate (152-ФЗ + parental consent for 15–17).
 * Employers: 18+ only.
 */
function classifyRegistrationAge(role, birthDateIso) {
  const birth = parseBirthDate(birthDateIso);
  if (!birth) {
    return { ok: false, code: "invalid_birth_date", field: "birthDate" };
  }
  const age = ageYearsOnDate(birth);
  if (age < 0) {
    return {
      ok: false,
      code: "birth_date_in_future",
      message: "Дата рождения не может быть в будущем.",
    };
  }
  if (age > MAX_REGISTRATION_AGE_YEARS) {
    return {
      ok: false,
      code: "birth_date_too_old",
      message: `Укажите реалистичную дату рождения (не старше ${MAX_REGISTRATION_AGE_YEARS} лет).`,
    };
  }
  if (age < 15) {
    return {
      ok: false,
      code: "age_too_young",
      message: "Регистрация доступна с 15 лет. Если вам меньше 15 лет, воспользуйтесь аккаунтом законного представителя.",
    };
  }
  if (role === "employer" && age < 18) {
    return {
      ok: false,
      code: "employer_age_minimum",
      message: "Для роли работодателя требуется возраст 18 лет и старше.",
    };
  }
  const needsParentalConsent = role === "candidate" && age >= 15 && age < 18;
  return { ok: true, age, needsParentalConsent };
}

module.exports = {
  parseBirthDate,
  ageYearsOnDate,
  classifyRegistrationAge,
  MAX_REGISTRATION_AGE_YEARS,
};
