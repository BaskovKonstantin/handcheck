#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "app", "public");
const SKIP_FILES = new Set(["app.js", "integrations.js", "call.js"]);

const FIELD_RE =
  /\.(candidateName|companyName|displayName|offerText|needTitle|contactChannel|employerContactEmail|candidatePhone|candidateContactEmail|roleTitle|industry|domain|description|company_name)\b/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith(".html") || name.endsWith(".js")) out.push(full);
  }
  return out;
}

const risky = [];
for (const file of walk(ROOT)) {
  if (SKIP_FILES.has(path.basename(file))) continue;
  const rel = path.relative(path.join(__dirname, ".."), file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, idx) => {
    if (!line.includes("${")) return;
    const re = /\$\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(line))) {
      const expr = m[1];
      if (!FIELD_RE.test(expr)) continue;
      if (/escapeHtml|\besc\(/.test(line)) continue;
      if (rel.endsWith("candidate/today.html") && line.includes("title:")) continue;
      risky.push({ file: rel, line: idx + 1, expr: expr.trim() });
    }
  });
}

if (risky.length) {
  console.error("Unescaped user-controlled template interpolations (per line):");
  for (const r of risky) console.error(`  ${r.file}:${r.line} \${${r.expr}}`);
  process.exit(1);
}
console.log("check-public-template-escape: ok");
