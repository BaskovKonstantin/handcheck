"use strict";

const VALID_SPECIALIZATIONS = new Set(["backend", "frontend", "qa"]);
const VALID_GRADES = new Set(["junior", "middle", "senior"]);

const TITLE_MAX = 120;
const DOMAIN_MAX = 1000;
const STACK_MAX_ITEMS = 20;
const STACK_ITEM_MAX = 40;
const NOTES_MAX = 2000;

function parseActiveFlag(value) {
  if (value === undefined) return undefined;
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return null;
}

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

function collapseInnerWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validateNeedBody(body, { requireTitle = true } = {}) {
  const fields = {};
  const b = body || {};

  let title = b.title !== undefined ? collapseInnerWhitespace(b.title) : undefined;
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

  let notes = b.notes !== undefined ? String(b.notes || "") : undefined;
  if (notes !== undefined && notes.length > NOTES_MAX) {
    fields.notes = `Заметки — не длиннее ${NOTES_MAX} символов`;
  }

  let active = parseActiveFlag(b.active);
  if (b.active !== undefined && active === null) {
    fields.active = "Укажите, активна ли потребность (да или нет)";
  }

  const value = {
    title,
    specialization,
    grade,
    domainText,
    stack: stackNorm.stack,
    notes,
    active: active === undefined ? undefined : active,
  };

  return { ok: Object.keys(fields).length === 0, fields, value };
}

function normalizeNeedTitle(title) {
  return collapseInnerWhitespace(title).toLowerCase().replace(/ё/g, "е");
}

function employerNeedTitleTaken(db, employerUserId, title, excludeNeedId = null) {
  const normalized = normalizeNeedTitle(title);
  if (!normalized) return false;
  const rows = db
    .prepare(`SELECT id, title FROM employer_needs WHERE employer_user_id = ?`)
    .all(employerUserId);
  return rows.some((r) => r.id !== excludeNeedId && normalizeNeedTitle(r.title) === normalized);
}

module.exports = {
  validateNeedBody,
  collapseInnerWhitespace,
  normalizeStackInput,
  parseActiveFlag,
  normalizeNeedTitle,
  employerNeedTitleTaken,
  VALID_SPECIALIZATIONS,
  VALID_GRADES,
  NOTES_MAX,
};
