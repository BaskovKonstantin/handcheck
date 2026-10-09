# Session notes

## 2026-10-09 — round 109: аудит функционала, LLM на space-bunny-free, починенный /api/assessment/generate

- LLM: `LLM_MODEL=space-bunny-free` (проверен — 2.1 с, JSON валиден), fallback `glm-5.3-flash` (сейчас отдаёт «Insufficient account funds»). Прописано в `app/config.js`, `.env`, `.env.example`.
- **Баг**: `POST /api/assessment/generate` был мёртв — `tasks/router` стоял после `assessment/router`, а тот гейтит всё под `requireRole("candidate")`, плюс у tasks `requireNotCandidate` → 403 любой ролью. Роутер заданий перенесён выше в `app/server.js`.
- Новый `scripts/functional-audit.js`: 41 проверка на чистой БД (регистрация → батарея → категория → подбор → приглашение → accept → контакты → колода → тест работодателя → MCP → LLM), режим `AUDIT_MODE=readonly` для прода (8 проверок, только чтение).
- Свежий кандидат не может «набить» категорию скриптом — ниже cutoff получается `unconfirmed`, поэтому подбор/приглашения аудит гоняет на демо-аккаунтах с подтверждённой категорией.
- Отчёты: `context/audits/2026-10-09-{full-local,prod-readonly}.{md,json}`.
- Документация: `docs/FUNCTIONAL-COVERAGE.md` (покрытие ТЗ по пунктам), `docs/PRESENTATION.md` (питч и слайды), README обновлён, из `ARCHITECTURE.md` убрана несуществующая строка `GET /api/meta`.
- Локально `npm rebuild better-sqlite3` под Node 22 (ABI 127).

## 2026-10-09 — round 108: симметричные кнопки демо-входа

- `#btn-candidate` переведён на `aw-btn aw-btn-primary` + `.aw-btn-shine` — обе кнопки быстрого входа выглядят одинаково.
- Тест: `test/round108-dark-cabinets-login.test.js` (симметрия кнопок + тёмные кабинеты).
- Локально `npm rebuild better-sqlite3` под Node 22 (ABI 127) — до этого 16 падений из-за ABI 137. Осталось 9 падений, они есть и на чистом HEAD (миграции/rubric), не регрессия.

## 2026-10-09 — full dark AlphaWave cabinets

- `body.has-cabinet-chrome` / `call-room-page`: remap CSS vars to dark paper/card + blue clay/forest.
- Atmosphere: `#cabinet-aw-bg` grid + aurora via `ensureCabinetAtmosphere()` in `app.js`.
- Bugfix: do **not** set `position: relative` on `.cabinet-aside` (broke `position: fixed` → main at y=900).
- Hot-copy path in container: `/app/app/public/*` (not `/app/public`).
- Refs: `context/design-refs/cabinet-dark-{overview,deck,today}.jpg`.

## 2026-10-08 — AlphaWave animations on login

- Ported keyframes: aurora-drift-a/b, grain-shift, ken-burns, hero-rise, hero-fade-up, hero-shine, shine-slide, marquee-x, ping (blue accents).

## 2026-10-08 — login gate (no landing) + AlphaWave blue skin

- `/` = login only; `/auth` → `/` (register stays at `/auth?mode=register`).
- Quick demo: `POST /api/auth/demo-login` `{role}` → first confirmed `@demo.local` user.
- UI inspired by alpha-wave.ai (dark grid/aurora/grain/corners/shine) with gold→blue accents.
- Refs: `context/design-refs/alpha-wave-*.jpg`, `handcheck-login-desktop.jpg`.

## 2026-10-08 — OpenCode Zen LLM wiring

- Approved scope: Zen → employer test generate, bank task drafts, call LLM summary (keyword fallback).
- Spec: `docs/superpowers/specs/2026-10-08-opencode-zen-llm-design.md`
- Plan: `docs/superpowers/plans/2026-10-08-opencode-zen-llm.md`
- Shared `app/lib/llm-client.js` (model fallbacks); server `.env` LLM_* from host secrets (not git).
- Tests: `test/opencode-zen-llm.test.js`.

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

## 2026-10-08 — round 107 recording late chunk + analysis + deploy health

- Branch: `cursor/round107-recording-regressions-c0d3`
- Bug 1: after orphan merge cleared chunks, late continuation chunk/tail got 400 — `hasRecordingContinuationContext` + merge playable final with new chunks.
- Bug 2: `queueAnalyzeCall` moved after `finalizeOrphanChunkSides`; debounce; re-queue on `POST /recording` when ended.
- Bug 3: deploy.yml health poll up to 120s with `commit` check.
- Tests: `test/round107-recording-regressions.test.js`.

## 2026-10-08 — round 106 recording finalize 502 / keep-alive

- Branch: `cursor/recording-finalize-keepalive-761a`
- Root cause: Node default `keepAliveTimeout` 5s + sync ffmpeg merge blocking event loop → Caddy pooled connection EOF mid `POST /recording`.
- Server: `keepAliveTimeout` 65s / `headersTimeout` 66s; `finalizeOrphanChunkSides` after `end` response; idempotent `writeFinalRecording` + chunk cleanup; duration-only finalize when playable file exists.
- Client: finalize retries on 502/503/504/network; tail once then duration-only; `recording-finalize-retry.js` policy module.
- Tests: `test/round106-recording-finalize.test.js`.

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

## 2026-10-09 — round 110: презентация ФСП в официальном шаблоне + документация по ТЗ

- Принят полный ТЗ ФСП-2026 (PDF оператора) → `docs/presentation/ТЗ-ФСП-2026.txt`; сжатое ТЗ в `docs/TZ.md` ему соответствует.
- Новая документация под пункты ТЗ: `docs/TESTING.md`, `docs/MATCHING.md`, `docs/FSP-INTEGRATION.md`, `docs/API.md`, `docs/DEPLOYMENT.md`, переписан `docs/VALIDATION.md`, дополнен `docs/ARCHITECTURE.md` (функциональная + компонентная архитектура), `docs/DOCUMENTATION.md` — индекс.
- Презентация: 18 слайдов в официальном шаблоне ФСП, `docs/presentation/HandCheck-ФСП-2026.{pptx,pdf}`, сборщик `scripts/build-jury-deck.py` (чистит служебные «Образец текста» из макетов, подставляет числа из `context/metrics-assessment.json`).
- Плейсхолдеры для людей оставлены: ФИО капитана, состав команды, роли, контакты (слайды 2–4).
- Новые числа: `scripts/assessment-metrics.js` — cutoff 0.55/0.68/0.78, формы A/B 0.812/0.812 (Δ=0), сильные 0.734, слабые 0.000, 9 батарей / 162 задания, 9/9 ячеек с обеими формами.
- Пробелы по полному ТЗ: автогенерация PDF-профиля кандидата, периодические короткие задания, сетевой адаптер ФСП (концепция есть), вакансии, OCR. Записаны в `docs/FUNCTIONAL-COVERAGE.md`.
- `docs/Documentation-HandCheck.pdf` (47 страниц) собирается из markdown скриптом `scripts/build-documentation-pdf.py`.
