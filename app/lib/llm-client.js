"use strict";

const config = require("../config");

async function generateTask({ specialization, grade, type }) {
  if (!config.LLM_BASE_URL) {
    return { error: "llm_not_configured" };
  }
  const system =
    "Ты составитель рабочих задач для оценки разработчиков. Язык: русский. Верни JSON: prompt, rubric: { keys: [], workItems: [] }. Без секретов, без ссылок на внешние API keys.";
  const user = `specialization=${specialization}, grade=${grade}, type=${type}`;
  const res = await fetch(`${config.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: config.LLM_API_KEY ? `Bearer ${config.LLM_API_KEY}` : "",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error("llm_failed");
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "{}";
  return JSON.parse(text);
}

module.exports = { generateTask };
