# Session notes

## 2026-10-07 — platform batteries 9 categories

- Branch: `cursor/nine-category-batteries-9d5e`
- `app/db/battery-catalog/*` — RU prompts/rubrics backend/frontend/qa × junior/middle/senior, forms A/B.
- `task-battery-content.js` idempotent seed/patch for all 9; seed.js demo users when categories pre-filled by migrate patch.
- `/candidate/tasks` — all chips enabled, no «скоро» / Backend-only notice.
- Tests: `test/platform-nine-batteries.test.js`.

## 2026-10-07 — post-PR48 layout fixes

## 2026-10-08 — round 93 pending company test on invitation

- Branch: `cursor/pending-company-test-invite-a3fa`
- API: `companyTests[]` pending row (`pending_accept`), candidate `pendingCompanyTestNote`; MCP `decide_candidate.employerTestId`, `list_invitations.companyTests`.
- Decline clears `pending_employer_test_id`.
- Tests: `test/round93-pending-company-test.test.js`.

## 2026-10-08 — round 94 queued test invite UI

- Branch: `cursor/queued-test-invite-ui-3f12`
- Employer pending row: title once + `status-pill waiting` (not `sent`); no `pendingMessage` in HTML.
- Candidate: `.invite-pending-test-note` info strip on card.
- Tests: extended `test/round89-ui-polish.test.js`.

## 2026-10-08 — round 89 UI polish

- Branch: `cursor/ui-polish-round89-17a0`
- Invitations: `companyTests[]` → rows (title + status pill + «Ответы»), no glued meta line.
- CSS: `button`/`.btn-*` inherit Manrope; `.invite-company-tests` layout.
- Candidates: `declined` → «Отказался», filter `status=declined` separate from `rejected`.

## 2026-10-07 — employer candidates + overview (PR #54 / #55)

### PR #54 — Кандидаты + Обзор
- Branch: `cursor/employer-candidates-search-2ec2`
- API: `GET /api/employer/candidates`, `GET /api/employer/dashboard`
- UI: `/employer/candidates`, `/employer/overview`
- Jury seed: `DEMO_MODE=1 DB_PATH=/data/handcheck.sqlite node scripts/seed-jury-pack.js`
