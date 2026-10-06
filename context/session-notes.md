# HandCheck session notes

## Round 33 fixes (branch cursor/round33-findings-f12b)

- **P0-1 recordings:** removed keepalive on large chunk/final uploads; continuation WebM chunks accepted; no minimalWebm stub; merge strips duplicate EBML; playable-only `hasRecording` / `recordingSides` (≥4 KB); upload before `/end` to avoid race with broadcast ENDED.
- **P1-1 timeout UI:** direct timeout submit (not disabled `.click()`); reload auto-submit when deadline passed; empty submit after 60s server timeout path.
- **P1-2:** PATCH draft rejected after quick/work deadline.
- **P1-3:** `bootPublicPage` for `/privacy`; no auth redirect when role is null; links on landing/auth.
- **P1-4:** transactional battery start returns existing open battery.
- **P1-5:** WebRTC signalingState guards + ignore duplicate ENDED.
- **P1-6:** login wait timeouts increased in cabinet browser tests.
- **P2:** typing batches / excludes paste chars; mobile test layout; lowercase ended pill; sidebar full-height background; test completion after last answer; honest recording upload label.
