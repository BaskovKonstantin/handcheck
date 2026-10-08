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
- [x] Config + llm-client + employer-test-llm
- [x] Call analyze LLM path
- [x] UI error toast
- [x] Tests (`test/opencode-zen-llm.test.js` 5/5)
- [x] Server `.env` from host secrets (no commit)
- [x] Commit `0036f92` (local docker rebuilt; push for CI if needed)
