#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "app", "public");

const USER_FIELD_RE =
  /\b(candidateName|companyName|displayName|offerText|needTitle|contactChannel|employerContactEmail|candidatePhone|candidateContactEmail|roleTitle|industry|domain|description|company_name|prompt|restored|domainText|stackStr|who|info\.needTitle|info\.analysisText|i\.companyName|i\.offerText|r\.displayName|t\.value|t\.label|t\.hint|it\.title|it\.meta)\b/;

const USER_FIELD_EXPR =
  /^(t\.value|t\.label|t\.hint|it\.title|it\.meta|restored|prompt)$/;

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
  const rel = path.relative(path.join(__dirname, ".."), file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, idx) => {
    if (!line.includes("${")) return;
    const re = /\$\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(line))) {
      const expr = m[1].trim();
      if (["offer", "channel", "contacts", "call", "meta", "aiBadge", "aiUsage"].includes(expr)) {
        continue;
      }
      const isUser =
        USER_FIELD_RE.test(expr) || USER_FIELD_EXPR.test(expr) || /\[['"]value['"]\]/.test(expr);
      if (!isUser) continue;
      if (/escapeHtml|\besc\(/.test(line)) continue;
      if (rel.endsWith("candidate/today.html") && /title:\s*`/.test(line)) continue;
      risky.push({ file: rel, line: idx + 1, expr });
    }
  });
}

const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
if (!/function statTilesHtml[\s\S]*?const esc = escapeHtml/.test(appJs)) {
  risky.push({ file: "app/public/app.js", line: 0, expr: "statTilesHtml must escape via escapeHtml" });
}
if (!/function timelineSection[\s\S]*?const esc = escapeHtml/.test(appJs)) {
  risky.push({ file: "app/public/app.js", line: 0, expr: "timelineSection must escape via escapeHtml" });
}

const tasksHtml = fs.readFileSync(path.join(ROOT, "candidate/tasks.html"), "utf8");
if (!tasksHtml.includes("escapeHtml(restored)")) {
  risky.push({ file: "app/public/candidate/tasks.html", line: 0, expr: "restored draft must use escapeHtml" });
}
if (!tasksHtml.includes("escapeHtml(t.prompt)")) {
  risky.push({ file: "app/public/candidate/tasks.html", line: 0, expr: "task prompt must use escapeHtml" });
}

if (risky.length) {
  console.error("Unescaped user-controlled template interpolations:");
  for (const r of risky) console.error(`  ${r.file}:${r.line} \${${r.expr}}`);
  process.exit(1);
}
console.log("check-public-template-escape: ok");
