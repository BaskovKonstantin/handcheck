"use strict";

function intentField(z) {
  return {
    intent: z.preprocess(
      (val) => (typeof val === "string" ? val.slice(0, 200) : val),
      z.string().optional()
    ).describe("Кратко: что попросил пользователь у ассистента"),
  };
}

function mergeSchema(z, fields) {
  return { ...fields, ...intentField(z) };
}

function readToolExtra(z) {
  return {
    inputSchema: mergeSchema(z, {}),
    annotations: { readOnlyHint: true },
  };
}

function writeToolExtra(z, fields, { destructive = true, idempotent = false } = {}) {
  const annotations = {};
  if (destructive) annotations.destructiveHint = true;
  if (idempotent) annotations.idempotentHint = true;
  return {
    inputSchema: mergeSchema(z, fields),
    annotations,
  };
}

const SCOPE_ERR_WRITE =
  "Недостаточно прав: токену нужно право «Запись».";
const SCOPE_ERR_READ = "Недостаточно прав: токену нужно право «Чтение».";

module.exports = {
  intentField,
  mergeSchema,
  readToolExtra,
  writeToolExtra,
  SCOPE_ERR_WRITE,
  SCOPE_ERR_READ,
};
