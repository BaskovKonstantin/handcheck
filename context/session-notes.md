# HandCheck session notes

## Round 41 CI fix (PR #31, branch cursor/round41-prod-findings-01e9)

- **round34 browser:** после «Завершить» убран `location.href` reload — `renderEndedView` in-place (гонка `page.evaluate` с навигацией); тест ждёт `.call-result-card`.
- **round41 mobile:** класс `assessment-question-active`, hero скрыт на вопросе, sticky compact progress, `cabinet-mobile-nav` на таб-баре.

## Round 38 (branch cursor/round38-findings-0d57)

- **P0-1 recordings:** server-side ffmpeg remux (`webm-ffmpeg.js`), session grouping on EBML boundaries, duration patch via `-t`; client serialised chunk queue (`recording-chunk-queue.js`), no wholesale `recorderChunks` clear; cumulative `durationMs` via sessionStorage; removed broken `fix-webm-duration` in Node.
- **P2:** keyword-list / duplicate-body traps in `rubric-score.js`; honest per-question fixture answers; mobile test step strip; privacy operator from env + `/api/privacy-notice`; telemetry flush on pagehide; copy fixes (duration label, minutes plural, Today dedupe, peer left, «Есть запись»).
- **CI:** ffmpeg in Dockerfile and GitHub Actions.
