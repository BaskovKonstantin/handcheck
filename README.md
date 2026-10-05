# HandCheck

Skills-first IT hiring template under FSP 2026 special-track TZ.

**Live:** https://handcheck.baski.pro

## Docs for agents / implementers

| Doc | Purpose |
|-----|---------|
| [AGENTS.md](./AGENTS.md) | Rules for coding agents |
| [docs/TZ.md](./docs/TZ.md) | Condensed TZ + jury weights |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Repo structure, domains, phases |
| [docs/DATA-MODEL.md](./docs/DATA-MODEL.md) | Schema + privacy |
| [docs/VALIDATION.md](./docs/VALIDATION.md) | Self-evaluation procedure |

## What works now (Phase 0)

- Landing + candidate/employer stubs
- API: `/api/health`, `/api/meta`, in-memory stubs
- Docker + auto-deploy on push to `main`

## Local

```bash
npm install
npm start
```

http://127.0.0.1:8810

## Docker

```bash
docker compose up -d --build
```

## Implementation order

Phase 1 auth/db → Phase 2 assessment/category → Phase 3 matching/invitations → Phase 4 polish → Phase 5 optional.
