"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const readPublic = (name) => fs.readFileSync(path.join(root, "app", "public", name), "utf8");

const quickBlock = (html) => {
  const start = html.indexOf('id="quick-wrap"');
  assert.notEqual(start, -1, "login gate must keep the #quick-wrap block");
  const end = html.indexOf("</div>", start);
  assert.notEqual(end, -1, "unterminated #quick-wrap block");
  return html.slice(start, end);
};

describe("round 108 login quick buttons", () => {
  const html = readPublic("index.html");
  const block = quickBlock(html);

  it("offers exactly two quick demo buttons", () => {
    const ids = [...block.matchAll(/id="(btn-(?:employer|candidate))"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ["btn-employer", "btn-candidate"]);
  });

  it("styles both quick buttons identically", () => {
    const buttonTags = [...block.matchAll(/<button[^>]*id="btn-(?:employer|candidate)"[^>]*>/g)].map(
      (m) => m[0],
    );
    assert.equal(buttonTags.length, 2);
    for (const tag of buttonTags) {
      assert.match(tag, /class="aw-btn aw-btn-primary login-gate-btn"/, tag);
    }
    assert.doesNotMatch(block, /aw-btn-ghost/, "ghost variant breaks button symmetry");
  });

  it("gives both quick buttons the shine layer", () => {
    const shines = block.match(/class="aw-btn-shine"/g) || [];
    assert.equal(shines.length, 2);
  });

  it("keeps the manual email login primary", () => {
    assert.match(html, /id="btn-login"[\s\S]{0,200}aw-btn-primary|aw-btn aw-btn-primary[^>]*id="btn-login"/);
  });
});

describe("round 108 dark AlphaWave cabinets", () => {
  const css = readPublic("styles.css");
  const js = readPublic("app.js");

  it("remaps cabinet + call-room tokens to the dark blue palette", () => {
    const dark = css.slice(css.indexOf("body.has-cabinet-chrome,"), css.indexOf("@keyframes section-in"));
    assert.match(dark, /--paper: #040405;/);
    assert.match(dark, /--card: #0c0d0e;/);
    assert.match(dark, /--clay: #5b9dff;/);
    assert.match(dark, /color-scheme: dark;/);
  });

  it("keeps the cabinet layout rules free of position overrides", () => {
    assert.doesNotMatch(css, /\.cabinet-aside\s*\{[^}]*position:\s*(relative|static|absolute)/);
  });

  it("injects the cabinet atmosphere once from JS", () => {
    assert.match(js, /function ensureCabinetAtmosphere\(\)/);
    assert.match(js, /if \(document\.getElementById\("cabinet-aw-bg"\)\) return;/);
    assert.match(js, /ensureCabinetAtmosphere\(\);/);
  });

  it("honours prefers-reduced-motion for the cabinet aurora", () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*cabinet-aw-aurora-a/);
  });
});