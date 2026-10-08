"use strict";

const TOKEN_MAP = [
  { keys: ["сеньор", "senior", "синьор", "синior"], field: "grade", value: "senior" },
  { keys: ["мидл", "middle", "миддл", "мид"], field: "grade", value: "middle" },
  { keys: ["джун", "junior", "джуниор", "jun"], field: "grade", value: "junior" },
  { keys: ["фсп", "fsp"], field: "fsp", value: "1" },
  { keys: ["безфсп", "no-fsp", "без фсп"], field: "fsp", value: "0" },
  { keys: ["нода", "node", "nodejs", "node.js"], field: "stack", value: "node" },
  { keys: ["react", "реакт"], field: "stack", value: "react" },
  { keys: ["typescript", "ts", "тайпскрипт"], field: "stack", value: "typescript" },
  { keys: ["python", "питон", "пайтон"], field: "stack", value: "python" },
  { keys: ["go", "golang", "го"], field: "stack", value: "go" },
  { keys: ["java", "джава"], field: "stack", value: "java" },
  { keys: ["postgres", "postgresql", "постгрес"], field: "stack", value: "postgres" },
  { keys: ["docker", "докер"], field: "stack", value: "docker" },
  { keys: ["kubernetes", "k8s", "кубер"], field: "stack", value: "kubernetes" },
  { keys: ["тестировщик", "qa", "тест", "quality"], field: "spec", value: "qa" },
  { keys: ["фронт", "frontend", "front-end", "фронтенд"], field: "spec", value: "frontend" },
  { keys: ["бэк", "backend", "back-end", "бэкенд"], field: "spec", value: "backend" },
  { keys: ["фуллстек", "fullstack", "full-stack"], field: "spec", value: "fullstack" },
  { keys: ["devops", "девопс"], field: "spec", value: "devops" },
  { keys: ["data", "дата", "аналитик"], field: "spec", value: "data" },
];

function normalizeToken(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim();
}

/**
 * Deterministic RU/EN query parser for employer bank search.
 * @param {string} input
 * @returns {{ spec?: string, grade?: string, stack?: string, fsp?: string, text: string, chips: Array<{key:string,label:string,value:string}> }}
 */
function parseSearchQuery(input) {
  const chips = [];
  const filters = {};
  const textParts = [];
  const raw = String(input || "").trim();
  if (!raw) {
    return { text: "", chips: [] };
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const norm = normalizeToken(token);
    let matched = false;
    for (const entry of TOKEN_MAP) {
      if (entry.keys.some((k) => norm === normalizeToken(k) || norm.includes(normalizeToken(k)))) {
        filters[entry.field] = entry.value;
        chips.push({
          key: entry.field,
          label: token,
          value: entry.value,
        });
        matched = true;
        break;
      }
    }
    if (!matched) textParts.push(token);
  }
  return {
    ...filters,
    text: textParts.join(" ").trim(),
    chips,
  };
}

module.exports = { parseSearchQuery, TOKEN_MAP };
