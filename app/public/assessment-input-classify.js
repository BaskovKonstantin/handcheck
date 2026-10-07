"use strict";

(function (root) {
  const KEYBOARD_INPUT_TYPES = new Set(["insertText", "insertCompositionText"]);
  const PASTE_INPUT_TYPES = new Set(["insertFromPaste", "insertFromPasteAsQuotation"]);
  const OTHER_INPUT_TYPES = new Set([
    "insertFromDrop",
    "insertReplacementText",
    "insertFromYank",
  ]);
  const BULK_INSERT_CHAR_THRESHOLD = 3;

  function classifyLengthIncrease(delta, inputType, pendingPasteChars) {
    const pending = pendingPasteChars || 0;
    if (delta <= 0) {
      return { paste: 0, typing: 0, other: 0 };
    }
    let remaining = delta;
    let paste = 0;
    if (pending > 0) {
      paste = Math.min(remaining, pending);
      remaining -= paste;
    }
    if (remaining <= 0) {
      return { paste, typing: 0, other: 0 };
    }
    const it = inputType ? String(inputType) : "";
    if (it && PASTE_INPUT_TYPES.has(it)) {
      return { paste: paste + remaining, typing: 0, other: 0 };
    }
    if (it === "insertCompositionText") {
      return { paste, typing: remaining, other: 0 };
    }
    if (it === "insertText" && remaining > BULK_INSERT_CHAR_THRESHOLD) {
      return { paste, typing: 0, other: remaining };
    }
    if (it === "insertText") {
      return { paste, typing: remaining, other: 0 };
    }
    if (it === "unknown") {
      return { paste, typing: 0, other: remaining };
    }
    if (it && OTHER_INPUT_TYPES.has(it)) {
      return { paste, typing: 0, other: remaining };
    }
    if (it) {
      return { paste, typing: 0, other: remaining };
    }
    if (remaining > BULK_INSERT_CHAR_THRESHOLD) {
      return { paste, typing: 0, other: remaining };
    }
    return { paste, typing: remaining, other: 0 };
  }

  root.HandCheckInputClassify = {
    classifyLengthIncrease,
    BULK_INSERT_CHAR_THRESHOLD,
  };
})(typeof window !== "undefined" ? window : globalThis);
