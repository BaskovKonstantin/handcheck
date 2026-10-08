"use strict";

const backend = require("./backend");
const frontend = require("./frontend");
const qa = require("./qa");
const {
  SPECS,
  GRADES,
  categoryKey,
  categoryLabel,
  quickRubricFromItem,
  ensureCategories,
} = require("./helpers");

const DEFINITIONS = {
  ...backend,
  ...frontend,
  ...qa,
};

function getBatteryDefinition(specialization, grade) {
  const spec = DEFINITIONS[specialization];
  if (!spec) return null;
  return spec[grade] || null;
}

function listPlatformCategories() {
  const out = [];
  for (const specialization of SPECS) {
    for (const grade of GRADES) {
      out.push({ specialization, grade, key: categoryKey(specialization, grade), label: categoryLabel(specialization, grade) });
    }
  }
  return out;
}

/** Build synthetic honest answers for scoring tests (distinct per question). */
function honestAnswersForDefinition(def, grade) {
  const angles = [
    "Сначала согласую с продуктом ожидаемое поведение и критерии приёмки.",
    "Дальше разбиваю задачу на шаги и фиксирую риски в коротком чеклисте.",
    "На стенде воспроизвожу сценарий и сравниваю с требованиями из тикета.",
    "В коде или тестах добавляю проверки граничных случаев и понятные сообщения об ошибках.",
    "После выкладки смотрю метрики и логи, чтобы убедиться, что регрессии нет.",
    "Документирую решение для команды: что изменилось и как откатить при необходимости.",
    "Если вижу техдолг, завожу отдельную задачу, а не смешиваю с текущим фиксом.",
    "Для безопасности проверяю права доступа и не храню секреты в репозитории.",
  ];
  const quickAnswers = def.quick.map((item, index) => {
    const keys = (item.keys || []).flat();
    const breadth = (item.breadthKeys || []).flat();
    const unique = [...new Set([...keys, ...breadth])];
    const prose =
      `${angles[index % angles.length]} ` +
      `Ключевые темы здесь: ${unique.join(", ")}. ` +
      `Привожу пример из недавнего проекта и объясняю, почему выбрал именно такой подход. ` +
      `Вопрос ${index + 1} из восьми — ответ самодостаточный и не копирует другие пункты.`;
    const pad = ` Контекст ${index + 1}: сроки, стейкхолдеры и критерий готовности описаны отдельно.`;
    return `${prose}${pad}${" ".repeat(index * 3)}`;
  });
  const workKeys = (def.work.rubric.keys || []).flat();
  const workItems = (def.work.rubric.workItems || []).flatMap((w) => w.phrases || []);
  const workBreadth = (def.work.rubric.breadthKeys || []).flat();
  const workAnswer =
    `Архитектурное описание: ${workKeys.join(", ")}. ` +
    `Реализация включает ${workItems.join(", ")} и учитывает ${workBreadth.join(", ")}. ` +
    `План на неделю: день 1 контракт и модель данных, дни 2-4 реализация и тесты, день 5 hardening и README. ` +
    `${"Подробности по безопасности, отказоустойчивости и наблюдаемости. ".repeat(6)}`;
  return { quickAnswers, workAnswer };
}

/** Keyword-only trap answers for a category (distinct shapes). */
function keywordTrapQuickAnswers(def) {
  const blob = def.quick
    .flatMap((item) => (item.keys || []).flat())
    .concat(def.quick.flatMap((item) => (item.breadthKeys || []).flat()))
    .join(" ");
  const variants = [
    (i) => `Пункт ${i + 1}. ${blob}`,
    (i) => blob.split(" ").slice(i).concat(blob.split(" ").slice(0, i)).join(", "),
    (i) => `Я использую ${blob}`,
    (i) => blob,
  ];
  return def.quick.map((_, i) => variants[i % variants.length](i));
}

module.exports = {
  SPECS,
  GRADES,
  DEFINITIONS,
  getBatteryDefinition,
  listPlatformCategories,
  quickRubricFromItem,
  ensureCategories,
  categoryKey,
  categoryLabel,
  honestAnswersForDefinition,
  keywordTrapQuickAnswers,
};
