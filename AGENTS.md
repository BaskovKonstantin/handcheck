# HandCheck — workspace for Grok Bot / coding agents

## Read first (in order)

1. [`docs/TZ.md`](./docs/TZ.md) — что требует ТЗ ФСП и веса жюри  
2. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — структура репо, домены, фазы  
3. [`docs/DATA-MODEL.md`](./docs/DATA-MODEL.md) — таблицы и privacy  
4. [`docs/VALIDATION.md`](./docs/VALIDATION.md) — как доказывать качество  

Live: https://handcheck.baski.pro

## Product one-liner

Опрос + тест → категория (специализация × грейд) → работодатель сам приглашает с вилкой ЗП.  
Контакты скрыты до accept. Не job-board scraper.

## Stack (locked)

- Node 20 + Express (`app/server.js` → модули в `app/modules/*`)
- SQLite (`better-sqlite3`) when persistence starts
- Static UI in `app/public/`
- Docker Compose on the server (`127.0.0.1:8810`)
- Caddy `handcheck.baski.pro`
- Deploy: push `main` → self-hosted runner with label `handcheck`

## How to implement

1. Work **one phase** from ARCHITECTURE (1 → 2 → 3 before 5).  
2. Keep business logic in `app/modules/*`, not in HTML.  
3. API under `/api/*`; update `openapi.yaml` when routes stabilize.  
4. Small commits; CI redeploys `main`.  
5. After Phase 3: verify full demo on production URL.  
6. No secrets in git — `.env` on server only.

## Do not

- Build vacancy scrapers / HH mirrors as core product  
- Rank by résumé prestige instead of test category  
- LLM-generate unique uncalibrated tests per candidate as the only method  
- Force-downgrade grade without candidate choosing a lower attempt  
- Expose candidate contacts before invite accept  
- Commit tokens, SSH keys, production `.env`

## Local run

```bash
npm install
npm start
# http://127.0.0.1:8810
```

## Related OpenBas wiki (operator machine)

- `knowledge-vault/entities/handcheck.md`
- `knowledge-vault/entities/fsp-spec-track-hackathon-2026.md`
- `knowledge-vault/concepts/programmer-skill-testing-approaches.md`
