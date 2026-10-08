"use strict";

function choiceLabelsFromOptions(options, choiceIds) {
  const byId = new Map((options || []).map((o) => [String(o.id), o.label || String(o.id)]));
  return (choiceIds || []).map((id) => byId.get(String(id)) || String(id));
}

module.exports = { choiceLabelsFromOptions };
