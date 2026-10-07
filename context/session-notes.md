# Session notes (round 58 fixes)

## P1 pool gate
- `employer-pool-eligibility.js`: `email_confirmed_at` + display name (sanitized) or non-empty stack.
- `matching/pool.js`: SQL `email_confirmed_at IS NOT NULL` + JS gate on confirmed/unconfirmed rows.

## P3 birth dates
- `registration-age.js`: fix `birth.d` in age calc; reject future DOB and age > 100.

## P3 today copy
- Untested: visible as «неподтверждён», ranked lower — not «не появится в подборе».

---

# Session notes (round 57 fixes)

## P2 keepalive
- Routine `uploadRecordingChunk` → `postMultipart(..., { keepalive: false })`; emergency `uploadKeepaliveBatch` only path with `keepalive: true` when blob ≤ limit.

## P3 call-room warning
- `recordingUploadDegraded` persisted on every `emit()`; `onUploadRecovered` clears chunk upload banner in `call.js`.

## P3 tasks drop
- `tasks-answer-drop.js`: caret from pointer, internal move; removed `suppressNextInputClassify` (was swallowing first keystroke).

---

# Session notes (round 55 P2 fixes)

## P2-1 recording chunk queue
- `flushChain` восстанавливается через `.catch(() => {})`; `flushOnce` не бросает — re-queue + backoff retry.
- `push()` вызывает `void flush().catch(() => {})`.
- Колбэки `onUploadFailure` / `onUploadSuccess` в `call-room-webrtc.js` для degraded notice.

## P2-2 assessment input
- `BULK_INSERT_CHAR_THRESHOLD = 3`; bulk `insertText` → `other_insert`; `unknown` для plain `Event('input')`.
- `tasks.html`: dragover/drop с ручной вставкой, `flushTelemetry` после batch/drop, `flushOther` на pagehide.

## Owner decisions FSP (branch cursor/owner-decisions-fsp-496e)
- Cooldown 30d; short-question timer `serverNow` + `remainingMs`; 152-FZ + parental register; operator defaults Басков/INN/email.
- `categoryStatus` confirmed/unconfirmed in pool/deck/API; unconfirmed visible, ranked lower; fail battery keeps category.
- `docs/JURY-DEMO.md`, demo-unconf seed, varied demo3–8 scores.

## Round 54 (branch cursor/integrity-input-telemetry-23b5)
- **P1-1:** `computeAttemptIntegrity` — учёт typed/paste/other_insert по символам, unattributed, open→submit и chars/sec; MCP без unattributed; метрики в `attempts.integrity_metrics_json`; агрегация батареи через `Math.max`.
- **P1-2:** `assessment-input-classify.js` + `tasks.html` — `InputEvent.inputType`, `other_insert`, `drop`; сервер принимает новые типы событий.

## Round 41 CI fix (PR #31, branch cursor/round41-prod-findings-01e9)
- **round34 browser:** после «Завершить» убран `location.href` reload — `renderEndedView` in-place (гонка `page.evaluate` с навигацией); тест ждёт `.call-result-card`.
- **round41 mobile:** класс `assessment-question-active`, hero скрыт на вопросе, sticky compact progress, `cabinet-mobile-nav` на таб-баре.

## Round 38 (branch cursor/round38-findings-0d57)
- **P0-1 recordings:** server-side ffmpeg remux (`webm-ffmpeg.js`), session grouping on EBML boundaries, duration patch via `-t`; client serialised chunk queue (`recording-chunk-queue.js`), no wholesale `recorderChunks` clear; cumulative `durationMs` via sessionStorage; removed broken `fix-webm-duration` in Node.
- **P2:** keyword-list / duplicate-body traps in `rubric-score.js`; honest per-question fixture answers; mobile test step strip; privacy operator from env + `/api/privacy-notice`; telemetry flush on pagehide; copy fixes (duration label, minutes plural, Today dedupe, peer left, «Есть запись»).
- **CI:** ffmpeg in Dockerfile and GitHub Actions.
