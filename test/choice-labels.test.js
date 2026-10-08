"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { choiceLabelsFromOptions } = require("../app/lib/choice-labels");

describe("choice-labels", () => {
  it("maps option ids to labels", () => {
    const options = [{ id: "a", label: "GET" }, { id: "b", label: "POST" }];
    assert.deepEqual(choiceLabelsFromOptions(options, ["a"]), ["GET"]);
  });
});
