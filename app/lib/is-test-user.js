"use strict";

function emailLooksLikeRoundTest(email) {
  const local = String(email || "").split("@")[0] || "";
  return /^r1\d[a-z]-\d+$/i.test(local);
}

function displayNameLooksLikeRoundTest(name) {
  return String(name || "").trim().startsWith("Тест Р1");
}

function shouldMarkUserAsTest(email, displayName) {
  if (!String(email || "").endsWith("@demo.local")) return false;
  return emailLooksLikeRoundTest(email) || displayNameLooksLikeRoundTest(displayName);
}

module.exports = {
  emailLooksLikeRoundTest,
  displayNameLooksLikeRoundTest,
  shouldMarkUserAsTest,
};
