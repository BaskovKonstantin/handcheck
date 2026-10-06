"use strict";

const { formatRetakeDateMoscow } = require("./format-dates");

function formatCooldownUserMessage(retakeAtIso) {
  const when = formatRetakeDateMoscow(retakeAtIso);
  const base = "Пересдача по этой специализации пока недоступна";
  return when ? `${base}. Повторная попытка с ${when}` : base;
}

module.exports = { formatCooldownUserMessage };
