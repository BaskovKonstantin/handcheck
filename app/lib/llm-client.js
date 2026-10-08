"use strict";

const config = require("../config");

function isLlmConfigured() {
  return Boolean(config.LLM_BASE_URL && config.LLM_API_KEY);
}

function modelCandidates() {
  const primary = String(config.LLM_MODEL || "").trim() || "glm-5.3-flash";
  const fallbacks = Array.isArray(config.LLM_FALLBACK_MODELS)
    ? config.LLM_FALLBACK_MODELS
    : [];
  const out = [];
  for (const m of [primary, ...fallbacks]) {
    const id = String(m || "").trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function extractJsonText(raw) {
  const text = String(raw || "").trim();
  if (!text) return "{}";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text;
}

/**
 * @param {{ messages: object[], json?: boolean, fetchImpl?: typeof fetch }} opts
 */
async function chatCompletions({ messages, json = false, fetchImpl } = {}) {
  if (!isLlmConfigured()) {
    return { error: "llm_not_configured" };
  }
  const doFetch = fetchImpl || globalThis.fetch;
  const base = String(config.LLM_BASE_URL).replace(/\/+$/, "");
  const models = modelCandidates();
  let lastErr = null;
  for (const model of models) {
    try {
      const body = {
        model,
        messages,
      };
      if (json) {
        body.response_format = { type: "json_object" };
      }
      const res = await doFetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.LLM_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        lastErr = new Error(`llm_http_${res.status}`);
        continue;
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      return { content, model, raw: data };
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error("llm_failed");
  err.cause = lastErr;
  throw err;
}

async function chatJson({ messages, fetchImpl } = {}) {
  const result = await chatCompletions({ messages, json: true, fetchImpl });
  if (result.error) return result;
  try {
    return { ...result, data: JSON.parse(extractJsonText(result.content)) };
  } catch (e) {
    const err = new Error("llm_invalid_json");
    err.cause = e;
    throw err;
  }
}

async function generateTask({ specialization, grade, type, fetchImpl } = {}) {
  if (!isLlmConfigured()) {
    return { error: "llm_not_configured" };
  }
  const system =
    "Ты составитель рабочих задач для оценки разработчиков. Язык: русский. Верни JSON: prompt, rubric: { keys: [], workItems: [] }. Без секретов, без ссылок на внешние API keys.";
  const user = `specialization=${specialization}, grade=${grade}, type=${type}`;
  const parsed = await chatJson({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    fetchImpl,
  });
  if (parsed.error) return parsed;
  const data = parsed.data || {};
  return {
    prompt: data.prompt || "Задача",
    rubric: data.rubric || { keys: [], workItems: [] },
    model: parsed.model,
  };
}

async function summarizeCallTranscript({ needDomainText, transcript, fetchImpl } = {}) {
  if (!isLlmConfigured()) {
    return { error: "llm_not_configured" };
  }
  const system =
    "Ты аналитик интервью для IT-найма. Язык: русский. Верни JSON: { summary: string }. summary — ровно до трёх коротких предложений: о чём говорили, соответствие домену потребности, участие сторон. Без секретов и контактов.";
  const user = `Домен потребности: ${needDomainText || "—"}\n\nРасшифровка:\n${String(transcript || "").slice(0, 12000)}`;
  const parsed = await chatJson({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    fetchImpl,
  });
  if (parsed.error) return parsed;
  const summary = String(parsed.data?.summary || "").trim();
  if (!summary) {
    return { error: "llm_empty_summary" };
  }
  return { summary, model: parsed.model };
}

module.exports = {
  isLlmConfigured,
  modelCandidates,
  extractJsonText,
  chatCompletions,
  chatJson,
  generateTask,
  summarizeCallTranscript,
};
