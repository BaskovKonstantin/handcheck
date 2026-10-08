"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { formatQuestionsRu, pluralRu } = require("../app/lib/plural-ru");

describe("plural-ru", () => {
  it("formats question counts in Russian", () => {
    assert.equal(formatQuestionsRu(1), "1 вопрос");
    assert.equal(formatQuestionsRu(4), "4 вопроса");
    assert.equal(formatQuestionsRu(5), "5 вопросов");
    assert.equal(formatQuestionsRu(21), "21 вопрос");
  });

  it("pluralRu handles teens", () => {
    assert.equal(pluralRu(11, "вопрос", "вопроса", "вопросов"), "вопросов");
  });
});
