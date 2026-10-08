# OpenCode Zen LLM Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Wire HandCheck LLM hooks to OpenCode Zen for employer tests, bank drafts, and call summaries.

**Architecture:** Shared `llm-client` (chat + JSON + model fallbacks); keyword call analysis remains fallback.

**Tech Stack:** Node 20, fetch, Express, better-sqlite3, node:test

## Global Constraints

- No secrets in git
- No unique live LLM assessment as sole method
- Russian UI messages for LLM errors

## File map

- `app/config.js` — LLM_MODEL, LLM_FALLBACK_MODELS, resolve base URL
- `app/lib/llm-client.js` — shared client
- `app/lib/employer-test-llm.js` — use client
- `app/modules/calls/analyze-call.js` — async LLM summary
- `app/public/employer/tests.js` — toast API message on failure
- `.env.example` — document vars
- `test/opencode-zen-llm.test.js` — mocked fetch

## Tasks

- [x] Spec written (`docs/superpowers/specs/2026-10-08-opencode-zen-llm-design.md`)
- [ ] Config + llm-client + employer-test-llm
- [ ] Call analyze LLM path
- [ ] UI error toast
- [ ] Tests
- [ ] Server `.env` from host secrets (no commit)
- [ ] Commit
