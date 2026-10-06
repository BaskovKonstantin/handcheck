# HandCheck session notes

## Round 28 fixes (branch cursor/round28-webrtc-recording-7fc1)

- WS signaling: relay JSON as UTF-8 text frames (was binary Buffer → browsers ignored).
- Recording upload: accept `video/webm;codecs=…` MIME + EBML sniff when multipart mislabels as text/plain.
- Call room UI: «В эфире» only after `peerConnected`; «Запись активна» only after first MediaRecorder chunk; removed post-join label reset.
- Transcript: surface speech/transcript API errors in UI (RU).

## Round 27 fixes (branch cursor/round27-findings-9bcf)

- Call room: `call-room-webrtc.js` — WebRTC over `/ws/calls/:callId`, MediaRecorder upload, Web Speech transcript chunks, honest recording labels, camera before `/start`, end propagation via WS + polling + `broadcastCallEnded`.
- P1 end flow: redirect to ended `/call/:id`, RU errors on `/end` failure.
- Need titles: collapse whitespace, ё→е in `normalizeNeedTitle`.
- JSON 404 for unknown `/api/*` and candidate sub-router fallthrough.
- MCP employer `list_invitations` / `list_calls` parity with REST.
- Audit log client label via `formatClientDescriptor` (em dash).
- Candidate calls: auto-expand ended section when no active calls.
- Mobile stat tiles: 3-up compact for today + employer invitations.
