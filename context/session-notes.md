# Session notes

## 2026-10-07 — CI ffmpeg install (PR apt stall)

- Branch: `cursor/ci-ffmpeg-robust-2ebc`
- Problem: `apt-get install ffmpeg` stalled ~18m on ubuntu-latest (run 37660817227), job hit 25m timeout before browser regression.
- Fix: primary `FedericoCarboni/setup-ffmpeg@v3.1` (cached static binaries, step `timeout-minutes: 5`); bounded apt fallback via `nick-fields/retry` with `--no-install-recommends` and Acquire timeouts; `Verify ffmpeg` step before tests.

## 2026-10-07 — round 63 (MCP JSON-RPC errors + WS upgrade HTTP status)

- Branch: `cursor/round63-p3-mcp-ws-1bd3`
- P3-1: `/mcp` parse/size errors → JSON-RPC (`-32700` / `-32000`); REST unchanged.
- P3-2: refused `/ws/calls/:id` upgrade → HTTP 401/403/404/410 before socket close (not bare destroy).
- Tests: `test/round63-findings.test.js`.

## 2026-10-07 — round 62 (WS origin + JSON parse)

- Branch: `cursor/ws-origin-json-body-84eb`
- P3: `isForbiddenBrowserOrigin` shared by session middleware and call signaling upgrade.
- P3: `entity.parse.failed` → `400 invalid_body` with Russian `INVALID_JSON_BODY_MSG`.
- Tests: `test/round62-findings.test.js`.

## 2026-10-07 — P2-1 / P2-2 (round 61)

- Branch: `cursor/draft-origin-security-2c91`
- P2-1: `resolveDraftAnswerText` rejects non-string `answerText`; POST `/draft` parses `text/plain` JSON via route-level `express.text`.
- P2-2: `requireSessionSameOrigin` on `/api` for session cookie + unsafe methods; Bearer/MCP and no-Origin clients unchanged.
- Client `sendBeacon` uses `Blob` with `type: application/json` (see `tasks-draft-persist.js`).
