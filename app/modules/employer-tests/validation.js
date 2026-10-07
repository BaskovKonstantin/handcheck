"use strict";

const KINDS = new Set(["text", "single", "multi", "code"]);

function trimStr(v, max) {
  const s = String(v ?? "").trim();
  if (!s) return { ok: false, msg: "Поле обязательно" };
  if (s.length > max) return { ok: false, msg: `Не длиннее ${max} символов` };
  return { ok: true, value: s };
}

function validateOptions(kind, options) {
  if (kind !== "single" && kind !== "multi") return { ok: true, value: [] };
  if (!Array.isArray(options) || options.length < 2) {
    return { ok: false, fields: { options: "Добавьте минимум два варианта ответа" } };
  }
  const out = [];
  const ids = new Set();
  for (let i = 0; i < options.length; i += 1) {
    const o = options[i] || {};
    const id = String(o.id ?? "").trim() || `opt${i + 1}`;
    if (ids.has(id)) {
      return { ok: false, fields: { options: "Идентификаторы вариантов должны быть уникальными" } };
    }
    ids.add(id);
    const label = String(o.label ?? "").trim();
    if (!label) {
      return { ok: false, fields: { options: `Текст варианта ${i + 1} обязателен` } };
    }
    if (label.length > 500) {
      return { ok: false, fields: { options: "Текст варианта — не длиннее 500 символов" } };
    }
    out.push({ id, label });
  }
  return { ok: true, value: out };
}

function validateAnswerKey(kind, answerKey, optionIds) {
  if (kind === "text" || kind === "code") return { ok: true, value: {} };
  const ids = Array.isArray(answerKey?.correctIds)
    ? answerKey.correctIds.map((x) => String(x).trim()).filter(Boolean)
    : [];
  if (!ids.length) {
    return { ok: false, fields: { answerKey: "Укажите хотя бы один правильный вариант" } };
  }
  if (kind === "single" && ids.length !== 1) {
    return { ok: false, fields: { answerKey: "Для одиночного выбора — ровно один правильный вариант" } };
  }
  for (const id of ids) {
    if (!optionIds.includes(id)) {
      return { ok: false, fields: { answerKey: "Правильный вариант не найден среди ответов" } };
    }
  }
  return { ok: true, value: { correctIds: ids } };
}

function validateRubricKeys(kind, rubricKeys) {
  if (kind !== "text" && kind !== "code") return { ok: true, value: {} };
  const keys = Array.isArray(rubricKeys?.keywords)
    ? rubricKeys.keywords.map((k) => String(k).trim()).filter(Boolean)
    : [];
  if (!keys.length) {
    return { ok: false, fields: { rubricKeys: "Добавьте хотя бы одно ключевое слово для автопроверки" } };
  }
  if (keys.length > 40) {
    return { ok: false, fields: { rubricKeys: "Не больше 40 ключевых слов" } };
  }
  return { ok: true, value: { keywords: keys } };
}

function validateItemBody(body, { partial } = {}) {
  const fields = {};
  let kind = body.kind;
  if (body.kind !== undefined) {
    kind = String(body.kind || "").trim();
    if (!KINDS.has(kind)) fields.kind = "Тип вопроса: text, single, multi или code";
  } else if (!partial) {
    fields.kind = "Укажите тип вопроса";
  }

  let prompt;
  if (body.prompt !== undefined) {
    const p = trimStr(body.prompt, 8000);
    if (!p.ok) fields.prompt = p.msg;
    else prompt = p.value;
  } else if (!partial) {
    fields.prompt = "Введите текст вопроса";
  }

  let timeLimitSec = body.timeLimitSec;
  if (body.timeLimitSec !== undefined && body.timeLimitSec !== null && body.timeLimitSec !== "") {
    const n = Number(body.timeLimitSec);
    if (!Number.isFinite(n) || n < 30 || n > 3600) {
      fields.timeLimitSec = "Лимит времени — от 30 секунд до 1 часа";
    } else {
      timeLimitSec = Math.round(n);
    }
  }

  if (Object.keys(fields).length) return { ok: false, fields };

  const optionsParsed = validateOptions(kind || "text", body.options);
  if (!optionsParsed.ok) return optionsParsed;
  const optionIds = optionsParsed.value.map((o) => o.id);

  const answerParsed = validateAnswerKey(kind || "text", body.answerKey, optionIds);
  if (!answerParsed.ok) return answerParsed;

  const rubricParsed = validateRubricKeys(kind || "text", body.rubricKeys);
  if (!rubricParsed.ok) return rubricParsed;

  return {
    ok: true,
    value: {
      kind,
      prompt,
      timeLimitSec: timeLimitSec === undefined ? null : timeLimitSec,
      options: optionsParsed.value,
      answerKey: answerParsed.value,
      rubricKeys: rubricParsed.value,
    },
  };
}

function validateTestMeta(body) {
  const fields = {};
  const title = trimStr(body.title, 200);
  if (!title.ok) fields.title = title.msg;
  const intro = body.intro !== undefined ? String(body.intro) : "";
  if (intro.length > 4000) fields.intro = "Вступление — не длиннее 4000 символов";
  const needId = String(body.needId || "").trim();
  if (!needId) fields.needId = "Выберите потребность";
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: { title: title.value, intro, needId } };
}

module.exports = {
  validateItemBody,
  validateTestMeta,
  KINDS,
};
