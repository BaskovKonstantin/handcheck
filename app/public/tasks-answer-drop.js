"use strict";

(function (root) {
  function clampOffset(maxLen, offset) {
    const n = Number(offset);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(maxLen, Math.floor(n)));
  }

  function caretOffsetFromPoint(textarea, clientX, clientY, doc) {
    if (!textarea) return 0;
    const documentRef = doc || root.document;
    if (!documentRef) {
      return textarea.selectionStart ?? textarea.value.length;
    }
    if (typeof documentRef.caretPositionFromPoint === "function") {
      const pos = documentRef.caretPositionFromPoint(clientX, clientY);
      if (pos && pos.offsetNode === textarea) {
        return clampOffset(textarea.value.length, pos.offset);
      }
    }
    if (typeof documentRef.caretRangeFromPoint === "function") {
      const range = documentRef.caretRangeFromPoint(clientX, clientY);
      if (range && range.startContainer === textarea) {
        return clampOffset(textarea.value.length, range.startOffset);
      }
    }
    return textarea.selectionStart ?? textarea.value.length;
  }

  function applyTextDrop({
    value,
    dropOffset,
    text,
    moveFrom = null,
    replaceStart = null,
    replaceEnd = null,
  }) {
    let v = value ?? "";
    let insertAt = clampOffset(v.length, dropOffset);
    let removedLen = 0;

    if (
      moveFrom &&
      moveFrom.text === text &&
      moveFrom.start < moveFrom.end &&
      v.slice(moveFrom.start, moveFrom.end) === text
    ) {
      removedLen = moveFrom.end - moveFrom.start;
      v = v.slice(0, moveFrom.start) + v.slice(moveFrom.end);
      if (insertAt > moveFrom.end) insertAt -= removedLen;
      else if (insertAt > moveFrom.start) insertAt = moveFrom.start;
    } else if (
      replaceStart != null &&
      replaceEnd != null &&
      replaceStart < replaceEnd
    ) {
      removedLen = replaceEnd - replaceStart;
      v = v.slice(0, replaceStart) + v.slice(replaceEnd);
      if (insertAt > replaceEnd) insertAt -= removedLen;
      else if (insertAt > replaceStart) insertAt = replaceStart;
    }

    insertAt = clampOffset(v.length, insertAt);
    const newValue = v.slice(0, insertAt) + text + v.slice(insertAt);
    const caret = insertAt + text.length;
    return {
      value: newValue,
      selectionStart: caret,
      selectionEnd: caret,
      insertedChars: text.length,
    };
  }

  root.HandCheckTasksAnswerDrop = {
    caretOffsetFromPoint,
    applyTextDrop,
  };
})(typeof window !== "undefined" ? window : globalThis);
