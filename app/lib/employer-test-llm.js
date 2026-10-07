"use strict";

const config = require("../config");

async function generateEmployerTestItems({ needTitle, specialization, grade, intro }) {
  if (!config.LLM_BASE_URL) {
    return { error: "llm_not_configured" };
  }
  const system =
    "Ты составитель коротких тестов для найма IT-специалистов. Язык: русский. Верни JSON: { items: [{ kind: text|single|multi|code, prompt, options?, answerKey?, rubricKeys?, timeLimitSec }] }. 4-5 вопросов. Без секретов.";
  const user = `Потребность: ${needTitle}. Специализация: ${specialization}, грейд: ${grade}. Контекст: ${intro || ""}`;
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
  const parsed = JSON.parse(text);
  return { items: Array.isArray(parsed.items) ? parsed.items : [] };
}

module.exports = { generateEmployerTestItems };
