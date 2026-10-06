# HandCheck MCP

HandCheck exposes a **Model Context Protocol** server so AI clients (Cursor, Claude Desktop/Code, ChatGPT connectors, etc.) can read data and perform allowed actions on behalf of the logged-in user.

## Endpoint

- **Streamable HTTP:** `{APP_BASE_URL}/mcp` (production: `https://handcheck.baski.pro/mcp`)
- **Auth:** `Authorization: Bearer hc_…` (personal API token from the **Интеграции** page)

Tokens are scoped (`read`, `write`), stored as SHA-256 hashes, and tied to the user’s role (candidate or employer).

## Stdio bridge

For clients that only support stdio MCP:

```bash
export HANDCHECK_API_TOKEN=hc_…
export HANDCHECK_MCP_URL=https://handcheck.baski.pro/mcp
npx handcheck-mcp
```

Or after `npm install` in the repo: `npx handcheck-mcp`.

## Tools (by role)

| Tool | Role | Scope |
|------|------|-------|
| `whoami` | both | read |
| `get_my_profile`, `update_my_profile`, `get_my_category` | candidate | read / write |
| `list_tasks`, `get_task`, `start_assessment`, `submit_answer`, `submit_work_task` | candidate | read / write |
| `list_invitations`, `respond_invitation`, `list_calls` | candidate | read / write |
| `list_needs`, `create_need`, `update_need` | employer | read / write |
| `get_next_candidate`, `decide_candidate`, `list_shortlist` | employer | read / write |
| `list_invitations`, `list_calls`, `get_call_analysis` | employer | read |

## Resources

- `handcheck://profile`
- `handcheck://needs/{id}` (employer)
- `handcheck://tasks/{id}` (candidate attempt id)

## Prompts

- `review-deck` — разобрать колоду по `needId`
- `complete-assessment` — пройти батарею заданий

## Audit and limits

- Each tool call is logged on the **Интеграции** page (tool name, time, result summary).
- Rate limit: `MCP_RATE_LIMIT_PER_MIN` (default 120) per token.

## MCP source label

Submissions and deck decisions made via MCP are stored with `source: "mcp"`. Employers see a neutral note on the deck card when part of the candidate’s test was submitted through an integration — not a penalty.

## REST API for tokens

Session cookie auth (cabinet UI):

- `GET /api/integrations/config`
- `GET|POST /api/integrations/tokens`
- `DELETE /api/integrations/tokens/:id`
- `GET /api/integrations/audit`

## Client config snippets

See the **Интеграции** page in the candidate or employer cabinet for copy-ready Cursor, Claude Desktop, and Claude Code examples.
