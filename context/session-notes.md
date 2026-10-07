# Session notes

## 2026-10-07 — round 66 (cabinet UI polish)

- Branch: `cursor/round66-design-polish-ec59`
- Mobile deck: safe padding under floating actions + tab bar; deck-wrap overflow visible.
- Desktop: full-width cabinet heroes; deck need stats panel; employer list grouped by match tier with collapse + «Показать ещё»; quieter list secondary actions; amber paste chip; candidate today zero-states + profile/integration steps + cooldown copy.
- Sidebar tagline removed; screenshots in `handcheck-ui/round66/{before,after}/`.
- Tests: `npm test`, `test/round66-design.test.js`.
- Mobile list: stack actions under `.list-row-main` ≤640px; Playwright asserts `.list-row-main` width >200px at 360–430.
- Merged `origin/main` (P2-1 grade mismatch labels): `gradeRelation` on pills + grouping.
- Palette refresh: ocean slate + teal brand + rose CTA (`--forest`/`--clay` tokens); Golos Text body + Unbounded display (self-hosted woff2); iOS-like motion + `prefers-reduced-motion`.

## 2026-10-07 — round 66 P2-1 (off-grade confirmed pool labels)

- Branch: `cursor/round66-p2-1-grade-mismatch-dd1a`
- Fix: same-spec confirmed Junior/Senior in Middle need pool keep real `categoryLabel` + `categoryStatus: confirmed`; `gradeRelation` + honest Russian `explanation`; rank exact → off-grade → unconfirmed.
- UI: amber `.category-pill-grade-mismatch`; MCP `getDeckNext` passes `categoryStatus` / `gradeRelation`.
- Tests: `test/round66-findings.test.js`.

## 2026-10-07 — CI ffmpeg install (PR apt stall)

- Branch: `cursor/ci-ffmpeg-robust-2ebc`
- Problem: `apt-get install ffmpeg` stalled ~18m on ubuntu-latest (run 37660817227), job hit 25m timeout before browser regression.
- Fix: primary `FedericoCarboni/setup-ffmpeg@v3.1` (cached static binaries, step `timeout-minutes: 5`); bounded apt fallback via `nick-fields/retry` with `--no-install-recommends` and Acquire timeouts; `Verify ffmpeg` step before tests.

## 2026-10-07 — employer paste indicator

- Branch: `cursor/employer-paste-indicator-fa54`
- Threshold: sum(paste chars) / sum(quick answer chars) > 0.5, min 24 chars total on latest completed battery.
- Employer API field `pasteInputMark.label`; deck + list UI; not on candidate APIs.

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
