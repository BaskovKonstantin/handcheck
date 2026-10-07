"use strict";

const { httpError } = require("../middleware/errors");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const { classifyRegistrationAge } = require("./registration-age");
const { registrationConsentPhrase, parentalConsentPhrase } = require("./privacy-policy");

function validateRegisterBody(body) {
  const fields = {};
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const role = String(body?.role || "").trim();
  const birthDate = String(body?.birthDate || "").trim();
  const privacyConsent = body?.privacyConsent === true;
  const parentalConsent = body?.parentalConsent === true;
  if (!email || !EMAIL_RE.test(email)) {
    fields.email = "Укажите корректный email";
  }
  if (password.length < 8) {
    fields.password = "Пароль — минимум 8 символов";
  }
  if (!["candidate", "employer"].includes(role)) {
    fields.role = "Выберите роль";
  }
  if (!birthDate) {
    fields.birthDate = "Укажите дату рождения";
  }
  if (!privacyConsent) {
    fields.privacyConsent = registrationConsentPhrase();
  }
  const ageGate = birthDate ? classifyRegistrationAge(role, birthDate) : null;
  if (birthDate && ageGate && !ageGate.ok) {
    if (ageGate.field === "birthDate") {
      fields.birthDate = "Укажите дату рождения в формате ГГГГ-ММ-ДД";
    } else if (ageGate.code === "age_too_young" || ageGate.code === "employer_age_minimum") {
      fields.birthDate = ageGate.message;
    }
  }
  if (ageGate?.ok && ageGate.needsParentalConsent && !parentalConsent) {
    fields.parentalConsent = parentalConsentPhrase();
  }
  if (Object.keys(fields).length) {
    throw httpError(400, "invalid_body", { fields });
  }
  return {
    email,
    password,
    role,
    birthDate,
    privacyConsent,
    parentalConsent,
    needsParentalConsent: Boolean(ageGate?.needsParentalConsent),
  };
}

function validateDisplayName(name) {
  const fields = {};
  const displayName = String(name ?? "").trim();
  if (!displayName) fields.displayName = "Укажите имя";
  else if (displayName.length > 80) fields.displayName = "Имя — не длиннее 80 символов";
  return { displayName, fields };
}

function validateOptionalEmail(value, fieldKey = "contactEmail") {
  const fields = {};
  const v = String(value ?? "").trim();
  if (v && !EMAIL_RE.test(v)) {
    fields[fieldKey] = "Укажите корректный email";
  }
  return { value: v, fields };
}

function validateOptionalPhone(value) {
  const fields = {};
  const phone = String(value ?? "").trim();
  if (!phone) return { phone: "", fields };
  if (phone.length > 32) {
    fields.phone = "Телефон слишком длинный";
  } else {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || !/^[\d\s+().-]+$/.test(phone)) {
      fields.phone = "Укажите корректный телефон";
    } else if (/^0+$/.test(digits) || /^(\d)\1{9,}$/.test(digits)) {
      fields.phone = "Укажите корректный телефон";
    }
  }
  return { phone, fields };
}

function validateBackgroundEpisode(body) {
  const fields = {};
  const roleTitle = String(body?.roleTitle ?? "").trim();
  const domain = String(body?.domain ?? "").trim();
  const industry = String(body?.industry ?? "").trim();
  const note = String(body?.note ?? "").trim();
  if (!roleTitle) fields.roleTitle = "Укажите роль";
  else if (roleTitle.length > 120) fields.roleTitle = "Роль — не длиннее 120 символов";
  if (!domain) fields.domain = "Укажите домен";
  else if (domain.length > 200) fields.domain = "Домен — не длиннее 200 символов";
  if (industry.length > 120) fields.industry = "Отрасль — не длиннее 120 символов";
  if (note.length > 500) fields.note = "Заметка — не длиннее 500 символов";
  if (Object.keys(fields).length) {
    throw httpError(400, "invalid_body", { fields });
  }
  return {
    roleTitle,
    domain,
    industry,
    note,
  };
}

module.exports = {
  validateRegisterBody,
  validateDisplayName,
  validateOptionalEmail,
  validateOptionalPhone,
  validateBackgroundEpisode,
};
