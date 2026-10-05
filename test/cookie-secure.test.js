"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

describe("config cookie secure", () => {
  it("enables Secure for https APP_BASE_URL", () => {
    process.env.APP_BASE_URL = "https://handcheck.baski.pro";
    delete require.cache[require.resolve("../app/config")];
    const cfg = require("../app/config");
    assert.equal(cfg.COOKIE_SECURE, true);
    process.env.APP_BASE_URL = "http://127.0.0.1:8810";
    delete require.cache[require.resolve("../app/config")];
    const local = require("../app/config");
    assert.equal(local.COOKIE_SECURE, false);
  });
});
