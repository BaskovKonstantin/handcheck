"use strict";

/** SQLite `datetime('now')` and legacy rows store UTC without a suffix. */
function dbDateToIso(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    if (/[zZ]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) return new Date(s).toISOString();
    return new Date(`${s}Z`).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    return new Date(`${s.replace(" ", "T")}Z`).toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatRuDateTime(iso, timeZone = "Europe/Moscow") {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

module.exports = { dbDateToIso, formatRuDateTime };
