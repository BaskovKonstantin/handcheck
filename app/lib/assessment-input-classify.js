"use strict";

const KEYBOARD_INPUT_TYPES = new Set(["insertText", "insertCompositionText"]);
const PASTE_INPUT_TYPES = new Set(["insertFromPaste", "insertFromPasteAsQuotation"]);
const OTHER_INPUT_TYPES = new Set([
  "insertFromDrop",
  "insertReplacementText",
  "insertFromYank",
]);

/** One-shot insert without a keyboard inputType above this size → other_insert. */
const BULK_INSERT_CHAR_THRESHOLD = 8;

/**
 * @param {number} delta chars added since last length snapshot
 * @param {string|undefined|null} inputType InputEvent.inputType
 * @param {number} pendingPasteChars chars not yet consumed from paste handler
 * @returns {{ paste: number, typing: number, other: number }}
 */
function classifyLengthIncrease(delta, inputType, pendingPasteChars = 0) {
  if (delta <= 0) {
    return { paste: 0, typing: 0, other: 0 };
  }

  let remaining = delta;
  let paste = 0;
  if (pendingPasteChars > 0) {
    paste = Math.min(remaining, pendingPasteChars);
    remaining -= paste;
  }
  if (remaining <= 0) {
    return { paste, typing: 0, other: 0 };
  }

  const it = inputType ? String(inputType) : "";

  if (it && PASTE_INPUT_TYPES.has(it)) {
    return { paste: paste + remaining, typing: 0, other: 0 };
  }
  if (it && KEYBOARD_INPUT_TYPES.has(it)) {
    return { paste, typing: remaining, other: 0 };
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

module.exports = {
  KEYBOARD_INPUT_TYPES,
  PASTE_INPUT_TYPES,
  OTHER_INPUT_TYPES,
  BULK_INSERT_CHAR_THRESHOLD,
  classifyLengthIncrease,
};
