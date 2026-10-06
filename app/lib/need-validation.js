"use strict";

const VALID_SPECIALIZATIONS = new Set(["backend", "frontend", "qa"]);
const VALID_GRADES = new Set(["junior", "middle", "senior"]);

const TITLE_MAX = 120;
const DOMAIN_MAX = 1000;
const STACK_MAX_ITEMS = 20;
const STACK_ITEM_MAX = 40;

function normalizeStackInput(stack) {
  if (stack === undefined || stack === null) return { stack: undefined, fields: {} };
  const fields = {};
  let items = stack;
  if (typeof stack === "string") {
    items = stack
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(items)) {
    fields.stack = "Стек должен быть списком технологий";
    return { stack: null, fields };
  }
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const piece = String(raw || "").trim();
    if (!piece) continue;
    if (piece.length > STACK_ITEM_MAX) {
      fields.stack = `Каждая технология — не длиннее ${STACK_ITEM_MAX} символов`;
      break;
    }
    const key = piece.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(piece);
    if (out.length > STACK_MAX_ITEMS) {
      fields.stack = `Не больше ${STACK_MAX_ITEMS} технологий в стеке`;
      break;
    }
  }
  return { stack: out, fields };
}

function validateNeedBody(body, { requireTitle = true } = {}) {
  const fields = {};
  const b = body || {};

  let title = b.title !== undefined ? String(b.title).trim() : undefined;
  if (requireTitle || b.title !== undefined) {
    if (!title) fields.title = "Укажите название потребности";
    else if (title.length > TITLE_MAX) fields.title = `Название — не длиннее ${TITLE_MAX} символов`;
  }

  let specialization = b.specialization;
  if (specialization !== undefined) {
    specialization = String(specialization || "").trim().toLowerCase();
    if (!VALID_SPECIALIZATIONS.has(specialization)) {
      fields.specialization = "Выберите специализацию";
    }
  }

  let grade = b.grade;
  if (grade !== undefined) {
    grade = String(grade || "").trim().toLowerCase();
    if (!VALID_GRADES.has(grade)) {
      fields.grade = "Выберите грейд";
    }
  }

  let domainText = b.domainText;
  if (domainText !== undefined) {
    domainText = String(domainText || "");
    if (domainText.length > DOMAIN_MAX) {
      fields.domainText = `Описание домена — не длиннее ${DOMAIN_MAX} символов`;
    }
  }

  const stackNorm = normalizeStackInput(b.stack);
  Object.assign(fields, stackNorm.fields);

  const value = {
    title,
    specialization,
    grade,
    domainText,
    stack: stackNorm.stack,
    notes: b.notes !== undefined ? String(b.notes || "") : undefined,
    active: b.active,
  };

  return { ok: Object.keys(fields).length === 0, fields, value };
}

module.exports = {
  validateNeedBody,
  normalizeStackInput,
  VALID_SPECIALIZATIONS,
  VALID_GRADES,
};
