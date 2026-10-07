"use strict";

/** Bump when policy text changes materially. */
const PRIVACY_POLICY_VERSION = "2026-10-06";

const PRIVACY_POLICY_PATH = "/privacy";

function operatorName() {
  const v = String(process.env.PRIVACY_OPERATOR_NAME || "").trim();
  return v || "оператор платформы HandCheck";
}

function operatorInn() {
  const v = String(process.env.PRIVACY_OPERATOR_INN || "").trim();
  return v || "не указан";
}

function operatorEmail() {
  const v = String(process.env.PRIVACY_OPERATOR_EMAIL || "").trim();
  return v || "support@handcheck.local";
}

function privacyNoticeShort() {
  return (
    "Обработка персональных данных — по 152-ФЗ. " +
    `Подробности и ваши права: ${PRIVACY_POLICY_PATH}. ` +
    `Оператор: ${operatorName()}. ИНН: ${operatorInn()}. Контакт: ${operatorEmail()}.`
  );
}

function recordDataConsent(db, userId, context, meta = {}) {
  const { newId } = require("./ids");
  const id = newId();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO data_processing_consents (id, user_id, context, policy_version, consented_at, meta_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, context, PRIVACY_POLICY_VERSION, now, JSON.stringify(meta || {}));
  return { id, consentedAt: now, policyVersion: PRIVACY_POLICY_VERSION };
}

module.exports = {
  PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_PATH,
  privacyNoticeShort,
  operatorName,
  operatorInn,
  operatorEmail,
  recordDataConsent,
};
