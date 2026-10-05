# HandCheck — workspace for Grok Bot / coding agents

## Product

Skills-first IT hiring template for FSP special track:
survey + test → category (specialization × grade) → employer invites with salary range.
Contacts stay hidden until candidate accepts.

Live: https://handcheck.baski.pro

## Stack (current template)

- Node 20 + Express (`app/server.js`)
- Static stubs in `app/public/`
- Docker Compose on konBas (`127.0.0.1:8810`)
- Caddy `handcheck.baski.pro` → `127.0.0.1:8810`
- Deploy: GitHub Actions self-hosted runner labels `handcheck`, `konbas` on push to `main`

## How to extend (preferred order)

1. Keep API under `/api/*` and pages under `app/public/`
2. Replace in-memory `state` with SQLite or Postgres when persistence is needed
3. Do not put secrets in the repo; use `.env` on the server only
4. Prefer small PRs / commits; CI redeploys `main` automatically

## Do not

- Build a job-board scraper
- Rank candidates by résumé prestige
- Commit tokens, SSH keys, or production `.env`

## Local run

```bash
npm install
npm start
# http://127.0.0.1:8810
```

## Related OpenBas wiki

- `knowledge-vault/entities/fsp-spec-track-hackathon-2026.md`
- `knowledge-vault/concepts/programmer-skill-testing-approaches.md`
- `knowledge-vault/sources/fsp-ready-tech-startups-2026-10-05.md`
