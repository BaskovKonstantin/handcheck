# Session notes

## 2026-10-07 — P2-1 / P2-2 (round 61)

- Branch: `cursor/draft-origin-security-2c91`
- P2-1: `resolveDraftAnswerText` rejects non-string `answerText`; POST `/draft` parses `text/plain` JSON via route-level `express.text`.
- P2-2: `requireSessionSameOrigin` on `/api` for session cookie + unsafe methods; Bearer/MCP and no-Origin clients unchanged.
- Client `sendBeacon` uses `Blob` with `type: application/json` (see `tasks-draft-persist.js`).
