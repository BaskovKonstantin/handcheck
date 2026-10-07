"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const PUBLIC = path.join(__dirname, "..", "app", "public");

const CABINET_PAGES = [
  {
    file: "employer/deck.js",
    apis: ["/api/employer/needs"],
    role: "employer",
  },
  {
    file: "employer/invitations.html",
    apis: ["/api/employer/invitations"],
    role: "employer",
  },
  {
    file: "employer/candidates.js",
    apis: ["/api/employer/candidates"],
    role: "employer",
  },
  {
    file: "employer/overview.js",
    apis: ["/api/employer/dashboard"],
    role: "employer",
  },
  {
    file: "employer/deferred.html",
    apis: ["/api/employer/needs"],
    role: "employer",
  },
  {
    file: "employer/calls.html",
    apis: ["/api/employer/calls"],
    role: "employer",
  },
  {
    file: "employer/need.html",
    apis: ["/api/employer/needs"],
    role: "employer",
  },
  {
    file: "candidate/calls.html",
    apis: ["/api/candidate/calls"],
    role: "candidate",
  },
  {
    file: "candidate/tasks.html",
    apis: ["/api/assessment/battery/current"],
    role: "candidate",
  },
  {
    file: "candidate/invitations.html",
    apis: ["/api/candidate/invitations"],
    role: "candidate",
  },
  {
    file: "candidate/today.html",
    apis: ["/api/candidate/category"],
    role: "candidate",
  },
  {
    file: "candidate/profile.html",
    apis: ["/api/candidate/profile"],
    role: "candidate",
  },
  {
    file: "candidate/integrations.html",
    apis: ["/api/integrations/config"],
    role: "candidate",
    alsoCheck: "integrations.js",
  },
];

function readPublic(rel) {
  return fs.readFileSync(path.join(PUBLIC, rel), "utf8");
}

describe("cabinet page data loading", () => {
  it("app.js exposes bootCabinetPage for parallel nav + data", () => {
    const app = readPublic("app.js");
    assert.match(app, /function bootCabinetPage\(/);
    assert.match(app, /bootCabinetPage,/);
    assert.match(app, /mountCabinetChromeSync/);
    assert.match(app, /nextCabinetPageLoad/);
    assert.doesNotMatch(app, /cabinetNavMounted/);
  });

  for (const page of CABINET_PAGES) {
    it(`${page.file} references its API and does not block on nav().then only`, () => {
      const src = readPublic(page.file);
      const extra = page.alsoCheck ? readPublic(page.alsoCheck) : "";
      for (const api of page.apis) {
        assert.ok(src.includes(api) || extra.includes(api), `expected ${api} in ${page.file}`);
      }
      const blocksOnNav = new RegExp(
        `${page.role}Nav\\(\\)\\s*\\.then\\(\\s*(?:async\\s*)?\\(\\)\\s*=>\\s*\\{[^}]*${page.apis[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "s"
      );
      assert.ok(
        !blocksOnNav.test(src),
        `${page.file} must not fetch ${page.apis[0]} only inside ${page.role}Nav().then`
      );
    });
  }

  it("deck.js starts loadNeed via bootCabinetPage before UI bindings", () => {
    const deck = readPublic("employer/deck.js");
    assert.match(deck, /bootCabinetPage\(\s*["']employer["']/);
    const bootIdx = deck.indexOf("HandCheck.bootCabinetPage");
    const bindCallIdx = deck.lastIndexOf("bindDeckUi();");
    assert.ok(bootIdx >= 0 && bindCallIdx > bootIdx, "bootCabinetPage must run before bindDeckUi()");
    assert.doesNotMatch(deck, /HandCheck\.employerNav\(\)\s*;\s*\n\s*loadNeed/);
  });

  it("candidate/profile.html bootCabinetPage script is valid", () => {
    const src = readPublic("candidate/profile.html");
    assert.match(src, /HandCheck\.bootCabinetPage\("candidate"/);
    assert.match(src, /\)\s*;\s*\n\s*<\/script>/);
  });

  it("deck.js toggles hidden on deck-card (regression guard)", () => {
    const deck = readPublic("employer/deck.js");
    assert.match(deck, /deck-card/);
    assert.match(deck, /\.hidden\s*=\s*false/);
    assert.match(deck, /loadNeed|loadCard/);
  });
});
