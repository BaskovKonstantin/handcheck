"use strict";

function emailLooksLikeRoundTest(email) {
  const local = String(email || "").split("@")[0] || "";
  return /^r\d+[a-z]-\d+$/i.test(local);
}

function displayNameLooksLikeRoundTest(name) {
  return /^Тест Р\d+/i.test(String(name || "").trim());
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
