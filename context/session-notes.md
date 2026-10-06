# HandCheck session notes

## Round 27 fixes (branch cursor/round27-findings-9bcf)

- Call room: `call-room-webrtc.js` — WebRTC over `/ws/calls/:callId`, MediaRecorder upload, Web Speech transcript chunks, honest recording labels, camera before `/start`, end propagation via WS + polling + `broadcastCallEnded`.
- P1 end flow: redirect to ended `/call/:id`, RU errors on `/end` failure.
- Need titles: collapse whitespace, ё→е in `normalizeNeedTitle`.
- JSON 404 for unknown `/api/*` and candidate sub-router fallthrough.
- MCP employer `list_invitations` / `list_calls` parity with REST.
- Audit log client label via `formatClientDescriptor` (em dash).
- Candidate calls: auto-expand ended section when no active calls.
- Mobile stat tiles: 3-up compact for today + employer invitations.

## Round 31 fixes (branch cursor/round31-findings-b461)

- WebRTC: HELLO renegotiation, connectionState-gated UI, chunk recording upload, /end before upload, fix-webm duration.
- Assessment: explicit question open, 60s server enforcement, typing vs paste telemetry allowlist, 152-FZ notices.
- MCP/REST call parity, candidate recording access fix, layout polish.

## Round 28 fixes (branch cursor/round28-webrtc-fixes-5553)

- Signaling: relay WS messages as UTF-8 text (fixes Blob JSON.parse in browsers); reject ended calls; replace duplicate tab per user.
- Recording: WebM mimetype with codecs; capped MediaRecorder bitrate for 60 min / 80 MB; upload errors surfaced in RU.
- Call room: waiting state until both consented + live; «Выйти» without 409; transcript `{ text, at }` + SR restart; hero «Звонок: …»; layout 1280/390; ended view missing-recording note.
