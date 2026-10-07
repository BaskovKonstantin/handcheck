"use strict";

(function (root) {
  const DRAFT_KEY_PREFIX = "handcheck:draft:v1:";
  const LOCAL_DRAFT_DEBOUNCE_MS = 1000;
  const WORK_SERVER_DRAFT_INTERVAL_MS = 10000;
  const KEEPALIVE_BODY_LIMIT = 60 * 1024;

  function draftStorageKey(attemptId) {
    return `${DRAFT_KEY_PREFIX}${attemptId}`;
  }

  function parseStoredDraft(raw) {
    if (!raw) return { text: "", at: 0 };
    try {
      const p = JSON.parse(raw);
      return {
        text: typeof p.text === "string" ? p.text : "",
        at: Number(p.at) || 0,
      };
    } catch {
      return { text: "", at: 0 };
    }
  }

  function pickRestoredDraftText(localText, serverDraft) {
    const local = localText || "";
    const server = serverDraft || "";
    if (!local && server) return server;
    if (local && server && server.length > local.length) return server;
    return local;
  }

  function writeLocalDraft(storage, key, text) {
    if (!storage) return;
    storage.setItem(key, JSON.stringify({ text, at: Date.now() }));
  }

  function bodyByteLength(body) {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(body).length;
    }
    return body.length;
  }

  function sendDraftPatchKeepalive(attemptId, text) {
    const body = JSON.stringify({ answerText: text });
    const url = `/api/assessment/tasks/${attemptId}/draft`;
    if (bodyByteLength(body) > KEEPALIVE_BODY_LIMIT) return false;
    if (root.navigator?.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      return root.navigator.sendBeacon(url, blob);
    }
    void root.fetch(url, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
    return true;
  }

  function createWorkDraftLifecycle(options) {
    const {
      attemptId,
      taskType,
      getText,
      storage,
      saveDraft,
      onInputDebounceMs = LOCAL_DRAFT_DEBOUNCE_MS,
      serverIntervalMs = WORK_SERVER_DRAFT_INTERVAL_MS,
      shouldSkip,
    } = options;

    const draftKey = draftStorageKey(attemptId);
    let localTimer = null;
    let serverTimer = null;

    const writeLocalNow = () => {
      if (shouldSkip?.()) return;
      writeLocalDraft(storage, draftKey, getText());
    };

    const persistServer = () => {
      if (shouldSkip?.()) return Promise.resolve();
      writeLocalNow();
      return saveDraft(getText());
    };

    const scheduleLocalFromInput = () => {
      if (taskType !== "work") return;
      clearTimeout(localTimer);
      localTimer = setTimeout(writeLocalNow, onInputDebounceMs);
    };

    const flushOnLifecycleHide = () => {
      if (shouldSkip?.()) return;
      clearTimeout(localTimer);
      writeLocalNow();
      if (taskType === "work") sendDraftPatchKeepalive(attemptId, getText());
    };

    const start = () => {
      if (taskType === "work") {
        serverTimer = setInterval(() => {
          void persistServer();
        }, serverIntervalMs);
      }
    };

    const stop = () => {
      clearTimeout(localTimer);
      if (serverTimer) clearInterval(serverTimer);
      localTimer = null;
      serverTimer = null;
    };

    return {
      draftKey,
      scheduleLocalFromInput,
      flushOnLifecycleHide,
      persistOnBlur: () => void persistServer(),
      start,
      stop,
    };
  }

  root.HandCheckTasksDraft = {
    draftStorageKey,
    parseStoredDraft,
    pickRestoredDraftText,
    writeLocalDraft,
    sendDraftPatchKeepalive,
    createWorkDraftLifecycle,
    LOCAL_DRAFT_DEBOUNCE_MS,
    WORK_SERVER_DRAFT_INTERVAL_MS,
  };
})(typeof window !== "undefined" ? window : globalThis);
