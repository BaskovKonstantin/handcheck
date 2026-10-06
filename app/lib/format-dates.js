"use strict";

function normalizeIsoForMoscow(iso) {
  if (!iso) return null;
  let normalized = iso;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:/.test(iso)) {
    normalized = `${iso.replace(" ", "T")}Z`;
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(iso) && !/[zZ]$/.test(iso) && !/[+-]\d{2}:\d{2}$/.test(iso)) {
    normalized = `${iso}Z`;
  }
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatDateTimeMoscow(iso) {
  const d = normalizeIsoForMoscow(iso);
  if (!d) return "";
  return d.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRetakeDateMoscow(iso) {
  const d = normalizeIsoForMoscow(iso);
  if (!d) return "";
  return d.toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

module.exports = { normalizeIsoForMoscow, formatDateTimeMoscow, formatRetakeDateMoscow };
