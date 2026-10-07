"use strict";

const { httpError } = require("../middleware/errors");
const { answerMaxForType } = require("./assessment-answer");

const DRAFT_ANSWER_TEXT_TYPE_MSG = "Текст черновика должен быть строкой";
const DRAFT_BODY_JSON_MSG = "Некорректный формат тела запроса";

function parseJsonDraftBodyString(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw httpError(400, "invalid_body", {
        fields: { answerText: DRAFT_BODY_JSON_MSG },
      });
    }
    return parsed;
  } catch (e) {
    if (e.status) throw e;
    throw httpError(400, "invalid_body", {
      fields: { answerText: DRAFT_BODY_JSON_MSG },
    });
  }
}

function bodyObjectFromRequest(req) {
  if (req.method === "POST" && typeof req.body === "string") {
    return parseJsonDraftBodyString(req.body);
  }
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    return req.body;
  }
  return {};
}

function assertDraftAnswerText(answerText, taskType) {
  if (typeof answerText !== "string") {
    throw httpError(400, "invalid_body", {
      fields: { answerText: DRAFT_ANSWER_TEXT_TYPE_MSG },
    });
  }
  const maxLen = answerMaxForType(taskType);
  if (answerText.length > maxLen) {
    throw httpError(400, "invalid_body", {
      fields: {
        answerText: `Ответ слишком длинный (максимум ${maxLen} символов)`,
      },
    });
  }
  return answerText;
}

function resolveDraftAnswerText(req, taskType) {
  const body = bodyObjectFromRequest(req);
  return assertDraftAnswerText(body.answerText, taskType);
}

module.exports = {
  DRAFT_ANSWER_TEXT_TYPE_MSG,
  DRAFT_BODY_JSON_MSG,
  resolveDraftAnswerText,
  assertDraftAnswerText,
  bodyObjectFromRequest,
};
