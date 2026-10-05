# HandCheck

Skills-first IT hiring (FSP 2026 special track). Category from test battery; employers invite with salary band; contacts hidden until accept.

**Live:** https://handcheck.baski.pro

## Docs

| Doc | Purpose |
|-----|---------|
| [docs/IMPLEMENTATION-PLAN-rev5.md](./docs/IMPLEMENTATION-PLAN-rev5.md) | Canonical rev.5 spec |
| [docs/design.md](./docs/design.md) | Palette clay/forest, motion |
| [docs/UX.md](./docs/UX.md) | Routes and copy |
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
npm test
npm run validate
```

## Docker

```bash
docker compose up -d --build
```

SQLite persists in volume `/data`.

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
