# HandCheck MCP

HandCheck exposes a [Model Context Protocol](https://modelcontextprotocol.io) server at **`/mcp`** (Streamable HTTP). Personal API tokens authenticate requests; each token inherits the owner’s role (candidate or employer) and chosen scopes.

## Quick start

1. Open **Интеграции** in your cabinet (`/candidate/integrations` or `/employer/integrations`).
2. Create a token with **Чтение** and, if needed, **Запись**. Copy the `hc_…` value — it is shown once.
3. Point your AI client at `https://handcheck.baski.pro/mcp` (or your local `http://127.0.0.1:8810/mcp`) with header `Authorization: Bearer hc_…`.

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "handcheck": {
      "url": "https://handcheck.baski.pro/mcp",
      "headers": {
        "Authorization": "Bearer hc_YOUR_TOKEN"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport http handcheck https://handcheck.baski.pro/mcp \
  --header "Authorization: Bearer hc_YOUR_TOKEN"
```

### Clients without HTTP MCP

```bash
export HANDCHECK_URL=https://handcheck.baski.pro
export HANDCHECK_TOKEN=hc_YOUR_TOKEN
node bin/handcheck-mcp.js
```

Register the command as a stdio MCP server in Claude Desktop or other tools.

## Scopes

| Scope | Meaning |
|-------|---------|
| `read` | List/read tools, resources, prompts; no mutations |
| `write` | Includes read; allows profile updates, assessment submit, deck decisions, invitations |

## Tools by role

**Common:** `whoami`

**Candidate:** `get_my_profile`, `update_my_profile`, `get_my_category`, `list_tasks`, `get_task`, `start_assessment`, `submit_answer`, `submit_work_task`, `list_invitations`, `respond_invitation`, `list_calls`

**Employer:** `list_needs`, `create_need`, `update_need`, `get_next_candidate`, `decide_candidate`, `list_shortlist`, `list_invitations`, `list_calls`, `get_call_analysis`

## Resources & prompts

- `handcheck://profile`
- `handcheck://needs/{id}` (employer)
- `handcheck://tasks/{id}` (candidate, attempt id)
- Prompts: `candidate-next-steps`, `employer-hiring-flow`

## Privacy & product rules

- No numeric test scores or integrity in tool results intended for candidates.
- Contacts stay hidden until invitation accept (same as the web app).
- Actions via MCP are stored with `source: mcp`; employers see **«через ИИ-клиент»** on invitations created by MCP.
- MCP calls are rate-limited and logged in **Журнал MCP** on the Integrations page.

## Audit

Each tool invocation writes one row: tool name, success/failure, short summary. Revoked tokens stop working immediately.
