# OpenCode Zen LLM — design (2026-10-08)

Approved in thread via AskUserQuestion: connect OpenCode Zen to all three LLM surfaces.

## Goal

Make HandCheck’s existing LLM hooks work against OpenCode Zen (OpenAI-compatible `/v1/chat/completions`) so employer test draft generation, bank task drafts, and call summaries are usable in demos — without putting secrets in git.

## Non-goals

- Unique live LLM tests as the only assessment method (forbidden by TZ)
- Separate AI worker/queue
- UX product rewrite (later pass)

## Config

| Env | Default / source | Notes |
|-----|------------------|-------|
| `LLM_BASE_URL` | `https://opencode.ai/zen/v1` when unset and key present; else empty | Trailing slash stripped |
| `LLM_API_KEY` | from server `.env` (copied from host secrets) | Never commit |
| `LLM_MODEL` | `glm-5.3-flash` | Primary |
| `LLM_FALLBACK_MODELS` | `space-bunny-free,deepseek-v4.1-flash` | Comma-separated retries on HTTP failure |

`llmConfigured` = both base URL and API key non-empty.

## Architecture

Single module `app/lib/llm-client.js`:

- `isLlmConfigured()`
- `chatCompletions({ messages, json })` — tries primary then fallbacks
- `chatJson({ messages })` — parse JSON (strip fences if needed)
- `generateTask(...)` — bank drafts
- helpers used by employer-test and call analysis

Call sites:

1. `app/lib/employer-test-llm.js` → `chatJson`
2. `app/modules/tasks/router.js` → `generateTask`
3. `app/modules/calls/analyze-call.js` — keyword summary always computed; if LLM configured and transcript non-empty, replace `summary_text` with LLM RU summary (≤3 sentences); keep `domain_hits` / `consistency_note` from keyword path

## Errors

- Missing config → `501` `{ error: "llm_not_configured", message: "…" }` (unchanged contract)
- Upstream failure after fallbacks → `502` `{ error: "llm_failed", message: "…" }` where routes catch it
- UI toast uses API `message` when present

## Secrets

- Local/prod `.env` only; `docker-compose` already uses `env_file: .env`
- Spec/plan/docs mention paths, never key values

## Tests

Unit tests with mocked `fetch`: model fallback, JSON parse, `generateTask`, call analyze prefers LLM summary when mock returns text.
