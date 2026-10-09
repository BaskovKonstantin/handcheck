"use strict";

/**
 * Генератор публичной страницы с исходниками проекта.
 *
 *   node scripts/build-source-browser.js
 *
 * Кладёт в app/public/downloads/source/index.html статический «просмотрщик кода»:
 * дерево файлов репозитория, содержимое ключевых файлов и ссылка на архив.
 * Нужен, когда репозиторий закрыт (приватный GitHub), а жюри требует ссылку на код.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "app", "public", "downloads", "source");
const OUT = path.join(OUT_DIR, "index.html");
const ARCHIVE = "../handcheck-source.tar.gz";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".github",
  "data",
  "dist",
  ".bb",
  "downloads",
  "template-fsp-2026.pptx",
]);

const TEXT_EXT = new Set([
  ".js", ".json", ".md", ".html", ".css", ".yml", ".yaml", ".sql", ".txt", ".sh", ".py", ".mjs",
]);

const HIGHLIGHT = [
  "README.md",
  "package.json",
  "app/server.js",
  "app/config.js",
  "docs/DOCUMENTATION.md",
  "docs/FUNCTIONAL-COVERAGE.md",
  "docs/TESTING.md",
  "docs/MATCHING.md",
  "docs/VALIDATION.md",
  "docs/API.md",
  "docs/DEPLOYMENT.md",
  "docs/FSP-INTEGRATION.md",
  "openapi.yaml",
  "docker-compose.yml",
  "scripts/functional-audit.js",
  "scripts/assessment-metrics.js",
];

function walk(dir, rel = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(abs, relPath));
    else out.push(relPath);
  }
  return out;
}

function countByExt(files) {
  const map = new Map();
  for (const f of files) {
    const ext = path.extname(f) || "(без расширения)";
    map.set(ext, (map.get(ext) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function buildTree(files) {
  const root = { name: "handcheck", path: "", dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { name: parts[i], path: `${node.path ? `${node.path}/` : ""}${parts[i]}`, dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    node.files.push(f);
  }
  const render = (node, depth) => {
    const pad = "  ".repeat(depth);
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    const out = [];
    for (const d of dirs) out.push(`${pad}<details open><summary>📁 ${escapeHtml(d.name)}/</summary>${render(d, depth + 1)}</details>`);
    for (const f of node.files) {
      const base = path.basename(f);
      const read = TEXT_EXT.has(path.extname(f));
      out.push(
        `${pad}<div class="row">${read ? "📄" : "🗎"} <a href="#file-${escapeHtml(f)}">${escapeHtml(base)}</a> <span class="dim">${escapeHtml(path.dirname(f) === "." ? "" : path.dirname(f))}</span></div>`
      );
    }
    return out.join("\n");
  };
  return render(root, 0);
}

function main() {
  const files = walk(ROOT).filter((f) => f !== "app/public/downloads/source/index.html");
  const codeFiles = files.filter((f) => TEXT_EXT.has(path.extname(f)));
  const loc = files.reduce((sum, f) => {
    try {
      return sum + fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").length;
    } catch {
      return sum;
    }
  }, 0);

  const sections = HIGHLIGHT.filter((f) => files.includes(f))
    .map((f) => {
      const body = escapeHtml(fs.readFileSync(path.join(ROOT, f), "utf8"));
      const capped = body.length > 60000 ? `${body.slice(0, 60000)}\n… (файл показан частично, полный — в архиве)` : body;
      return `<section class="card" id="file-${f}">
  <h2>${f}</h2>
  <pre><code>${capped}</code></pre>
</section>`;
    })
    .join("\n");

  const extTable = countByExt(files)
    .map(([ext, n]) => `<tr><td>${ext}</td><td>${n}</td></tr>`)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HandCheck — исходный код</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: 'Montserrat', 'DejaVu Sans', system-ui, sans-serif; background: #0c0d0e; color: #e8eaec; }
  header { padding: 28px 32px 20px; border-bottom: 1px solid rgba(232,234,236,.14); }
  h1 { margin: 0 0 8px; font-size: 26px; color: #fff; }
  header p { margin: 4px 0; color: #9ba1a6; font-size: 14px; }
  .grid { display: grid; grid-template-columns: 340px 1fr; gap: 24px; padding: 24px 32px 60px; align-items: start; }
  .panel, .card { background: #14161a; border: 1px solid rgba(232,234,236,.12); border-radius: 14px; padding: 16px 18px; }
  .panel h2 { margin: 0 0 10px; font-size: 15px; color: #5b9dff; }
  .tree { max-height: 74vh; overflow: auto; font-size: 12.5px; line-height: 1.6; }
  .tree summary { cursor: pointer; color: #93c5fd; }
  .row { padding-left: 14px; }
  .row a { color: #e8eaec; text-decoration: none; }
  .row a:hover { color: #5b9dff; text-decoration: underline; }
  .dim { color: #6b7280; font-size: 11px; }
  a.dl { display: inline-block; margin-top: 10px; padding: 9px 14px; border-radius: 10px; background: #5b9dff; color: #040405; font-weight: 600; text-decoration: none; }
  table { border-collapse: collapse; font-size: 12.5px; margin-top: 10px; width: 100%; }
  th, td { border-bottom: 1px solid rgba(232,234,236,.1); padding: 4px 6px; text-align: left; }
  .card { margin-bottom: 20px; }
  .card h2 { margin: 0 0 10px; font-size: 15px; color: #93c5fd; }
  pre { margin: 0; overflow: auto; max-height: 460px; font-size: 12px; line-height: 1.5; }
  code { font-family: 'DejaVu Sans Mono', ui-monospace, monospace; color: #d7dce3; }
  .stats { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 10px; }
  .stat b { display: block; font-size: 20px; color: #fff; }
  .stat span { font-size: 12px; color: #9ba1a6; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>HandCheck — исходный код</h1>
  <p>Сайт подбора ИТ-специалистов: категорию подтверждает батарея заданий, приглашение инициирует работодатель, контакты открываются только после согласия.</p>
  <div class="stats">
    <div class="stat"><b>${files.length}</b><span>файлов</span></div>
    <div class="stat"><b>${codeFiles.length}</b><span>текстовых</span></div>
    <div class="stat"><b>${loc.toLocaleString("ru-RU")}</b><span>строк</span></div>
    <div class="stat"><b>${new Date().toISOString().slice(0, 10)}</b><span>сборка страницы</span></div>
  </div>
  <a class="dl" href="${ARCHIVE}" download>Скачать весь репозиторий (tar.gz, 19 МБ)</a>
</header>
<div class="grid">
  <aside class="panel">
    <h2>Структура проекта</h2>
    <div class="tree">
${buildTree(files)}
    </div>
    <table>
      <tr><th>Расширение</th><th>Файлов</th></tr>
      ${extTable}
    </table>
  </aside>
  <main>
${sections}
  </main>
</div>
</body>
</html>
`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log(`Собрано: ${path.relative(ROOT, OUT)} (${files.length} файлов, ${(html.length / 1024).toFixed(0)} КБ)`);
}

main();