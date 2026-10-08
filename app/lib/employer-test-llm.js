"use strict";

const { chatJson, isLlmConfigured } = require("./llm-client");

async function generateEmployerTestItems({ needTitle, specialization, grade, intro, fetchImpl }) {
  if (!isLlmConfigured()) {
    return { error: "llm_not_configured" };
  }
  const system =
    "Ты составитель коротких тестов для найма IT-специалистов. Язык: русский. Верни JSON: { items: [{ kind: text|single|multi|code, prompt, options?, answerKey?, rubricKeys?, timeLimitSec }] }. 4-5 вопросов. Без секретов.";
  const user = `Потребность: ${needTitle}. Специализация: ${specialization}, грейд: ${grade}. Контекст: ${intro || ""}`;
  const parsed = await chatJson({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    fetchImpl,
  });
  if (parsed.error) return parsed;
  const items = Array.isArray(parsed.data?.items) ? parsed.data.items : [];
  return { items, model: parsed.model };
}

module.exports = { generateEmployerTestItems };
