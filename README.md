# HandCheck

Шаблон skills-first платформы подбора IT (ТЗ ФСП спец. трек).

**Live:** https://handcheck.baski.pro

## Что есть сейчас

- Лендинг + два кабинета-заглушки (кандидат / работодатель)
- API: `/api/health`, `/api/meta`, `/api/candidates`, `/api/invitations` (in-memory)
- Docker Compose + автодеплой на konBas при push в `main`

## Локально

```bash
npm install
npm start
```

Откройте http://127.0.0.1:8810

## Docker

```bash
docker compose up -d --build
```

## Для агентов

См. [AGENTS.md](./AGENTS.md).
