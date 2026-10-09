# HandCheck

Skills-first IT hiring (FSP 2026 special track). Category from test battery; employers invite with salary band; contacts hidden until accept.

**Live:** https://handcheck.baski.pro · Git: `git@github.com-handcheck:BaskovKonstantin/handcheck.git` · Деплой: push в `main` → self-hosted runner → Docker Compose

## Что это

Опрос + тест → категория (специализация × грейд) → работодатель сам приглашает кандидата
с вилкой ЗП. Контакты кандидата скрыты до `accept`. Не витрина вакансий.

## Docs

| Doc | Purpose |
|-----|---------|
| [docs/DOCUMENTATION.md](./docs/DOCUMENTATION.md) | Индекс документации — с чего начать |
| [docs/TZ.md](./docs/TZ.md) | Сжатое ТЗ ФСП (источник требований) |
| [docs/FUNCTIONAL-COVERAGE.md](./docs/FUNCTIONAL-COVERAGE.md) | Покрытие ТЗ по пунктам + функциональный аудит |
| [docs/TESTING.md](./docs/TESTING.md) | Механика тестирования и устойчивость подхода |
| [docs/MATCHING.md](./docs/MATCHING.md) | Механика подбора и логика категоризации |
| [docs/VALIDATION.md](./docs/VALIDATION.md) | Процедура валидации и её результаты |
| [docs/FSP-INTEGRATION.md](./docs/FSP-INTEGRATION.md) | Схема интеграции с реестром ФСП |
| [docs/API.md](./docs/API.md) | Описание API (плюс [openapi.yaml](./openapi.yaml)) |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Сборка, развёртывание, запуск, библиотеки |
| [docs/PRESENTATION.md](./docs/PRESENTATION.md) | Презентация проекта и тезисы питча |
| [docs/presentation/](./docs/presentation) | Презентация ФСП в pptx и pdf |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Структура репо, домены, фазы |
| [docs/DATA-MODEL.md](./docs/DATA-MODEL.md) | Таблицы и приватность |
| [docs/MCP.md](./docs/MCP.md) | MCP-интеграция для ИИ-клиентов |
| [docs/design.md](./docs/design.md) | Palette clay/forest, motion |
| [docs/UX.md](./docs/UX.md) | Routes and copy |
| [docs/JURY-DEMO.md](./docs/JURY-DEMO.md) | Jury click-path and ranking checks |
| [AGENTS.md](./AGENTS.md) | Agent rules |

## Local

```bash
cp .env.example .env
npm install
npm start
```

Demo logins (when `DEMO_MODE=1`, password from `.env.example`):

- `anna@demo.local` / `boris@demo.local` — candidates
- `cafe@demo.local` — employer (café need)

## Quality gates

```bash
npm test          # unit + integration tests
npm run validate  # quality of assessment, matching and privacy on seed data
```

Functional audit against a running instance (writes only to its own DB — run it against
a throwaway `DB_PATH`, not the jury database):

```bash
# full mode on a clean local DB
PORT=8899 DB_PATH=/tmp/hc-audit.sqlite DEMO_MODE=1 npm start &
BASE_URL=http://127.0.0.1:8899 node scripts/functional-audit.js

# read-only mode against production
BASE_URL=https://handcheck.baski.pro AUDIT_MODE=readonly node scripts/functional-audit.js
```

Latest reports live in [`context/audits/`](./context/audits).

## Docker

```bash
docker compose up -d --build
```

SQLite persists in volume `/data`.

For FSP jury evaluation, target **~32–64 GB RAM**, **4–16 CPU**, **no GPU** (see `docker-compose.yml` and [docs/JURY-DEMO.md](./docs/JURY-DEMO.md)).

## Operations (konBas)

From the server itself, use the loopback health URL — the public hostname often **hairpin-times out** when curled from konBas:

```bash
curl -fsS http://127.0.0.1:8810/api/health
```

Deploy workflow (`.github/workflows/deploy.yml`) uses the same check after `docker compose up`.

### Large call recordings (>80 MB)

The app rejects uploads when `Content-Length` exceeds 80 MB **before** multer buffers the body, so clients get **413** quickly even behind Caddy.

Optional Caddy hardening (not applied in this repo; add on the operator host if desired):

```caddy
# inside handcheck.baski.pro site block
request_body {
  max_size 85MB
}
```
