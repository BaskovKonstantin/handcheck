"use strict";

/** Bump when policy text changes materially. */
const PRIVACY_POLICY_VERSION = "2026-10-07";

const PRIVACY_POLICY_PATH = "/privacy";

// Данные оператора задаются только через переменные окружения
// (PRIVACY_OPERATOR_NAME / PRIVACY_OPERATOR_INN / PRIVACY_OPERATOR_EMAIL).
// В исходниках их нет намеренно: репозиторий публичный.
const DEFAULT_OPERATOR_NAME = "";
const DEFAULT_OPERATOR_INN = "";
const DEFAULT_OPERATOR_EMAIL = "";

function operatorName() {
  const v = String(process.env.PRIVACY_OPERATOR_NAME || "").trim();
  return v || DEFAULT_OPERATOR_NAME;
}

function operatorInn() {
  const v = String(process.env.PRIVACY_OPERATOR_INN || "").trim();
  return v || DEFAULT_OPERATOR_INN;
}

function operatorEmail() {
  const v = String(process.env.PRIVACY_OPERATOR_EMAIL || "").trim();
  return v || DEFAULT_OPERATOR_EMAIL;
}

function privacyNoticeShort() {
  return (
    "Обработка персональных данных осуществляется на основании согласия субъекта (ст. 9 152-ФЗ). " +
    `Подробности: ${PRIVACY_POLICY_PATH}. ` +
    `Оператор: ${operatorName()}, ИНН ${operatorInn()}, ${operatorEmail()}.`
  );
}

function registrationConsentPhrase() {
  return "Регистрируясь, я даю согласие на обработку персональных данных в соответствии с Уведомлением по 152-ФЗ.";
}

function assessmentConsentPhrase() {
  return "Начиная тест, я даю согласие на обработку персональных данных в соответствии с Уведомлением по 152-ФЗ.";
}

function parentalConsentPhrase() {
  return (
    "Я подтверждаю, что являюсь законным представителем несовершеннолетнего (15–17 лет) и даю согласие " +
    "на обработку его персональных данных в соответствии с Уведомлением по 152-ФЗ."
  );
}

function privacyNoticeDocument() {
  return {
    version: PRIVACY_POLICY_VERSION,
    operatorName: operatorName(),
    operatorInn: operatorInn(),
    operatorEmail: operatorEmail(),
    purposes: [
      "Регистрация и ведение учётной записи на платформе HandCheck.",
      "Проведение навыкового теста, формирование категории кандидата и пересдача.",
      "Организация видеозвонков с работодателем, запись и хранение материалов разговора.",
      "Подбор и обмен приглашениями между кандидатом и работодателем.",
      "Учёт использования ИИ-клиентов (MCP): имя клиента, вызовы инструментов, краткое описание запроса.",
    ],
    personalDataCategories: [
      "ФИО или псевдоним, email, телефон, дата рождения, роль на платформе.",
      "Ответы на задания теста, черновики, события ввода (фокус, ввод, вставка).",
      "Запись звонка: видео, аудио, расшифровка, метаданные сессии.",
      "Для MCP: хэш IP, user-agent, аргументы вызовов (без секретов), намерение запроса.",
    ],
    processingActions: [
      "Сбор, запись, систематизация, накопление, хранение, уточнение (обновление), использование, передача работодателю в рамках подбора, обезличивание, удаление.",
    ],
    storageTerm:
      "До отзыва согласия или удаления аккаунта, если иной срок не предусмотрен договором с работодателем. Записи звонков — в рамках срока действия аккаунта и договора.",
    withdrawal:
      "Вы можете отозвать согласие или запросить уточнение, блокирование или удаление данных — направьте обращение на контакт оператора.",
    registrationConsentPhrase: registrationConsentPhrase(),
    assessmentConsentPhrase: assessmentConsentPhrase(),
    parentalConsentPhrase: parentalConsentPhrase(),
  };
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
  DEFAULT_OPERATOR_NAME,
  DEFAULT_OPERATOR_INN,
  DEFAULT_OPERATOR_EMAIL,
  privacyNoticeShort,
  privacyNoticeDocument,
  registrationConsentPhrase,
  assessmentConsentPhrase,
  parentalConsentPhrase,
  operatorName,
  operatorInn,
  operatorEmail,
  recordDataConsent,
};
