# HandCheck session notes

## Round 26 fixes (branch cursor/round26-findings-fe17)

- Duplicate need titles: Unicode case fold in JS (`normalizeNeedTitle`), check on PUT/MCP `update_need`.
- Answer limits: quick 4000 / work 12000 chars; RU field errors; UI counter + maxlength; `payload_too_large` for JSON 413.
- AI usage UI: `clientLabel` chip, dash for `client_where`, post-test lines with accept/decline verbs.
- REST `GET /api/calls/:id/analysis` adds `summaryText` (keeps `summary_text`).
- Recording after end: one upload per side within grace window.
- Audit log times: `formatAuditLogTime` (today / yesterday / date).
