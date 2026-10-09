# Сборка, развёртывание и локальный запуск

Требование ТЗ: «Пошаговая инструкция сборки, развёртывания и локального запуска».

## 1. Требования к машине

| Параметр | Значение |
|---|---|
| CPU | 4–16 vCPU |
| RAM | 2–8 ГБ (рекомендуется 32–64 ГБ, если жюри гоняет нагрузочные сценарии) |
| GPU | не требуется |
| Диск | 5 ГБ + том для SQLite |
| ПО | Docker 24+ и Docker Compose v2 (или Node.js 20+ для локального запуска) |

ffmpeg нужен только для склейки записей звонков; без него остальная система работает.

## 2. Локальный запуск из исходников

```bash
git clone git@github.com-handcheck:BaskovKonstantin/handcheck.git
cd handcheck
cp .env.example .env
npm install
npm start            # http://127.0.0.1:8810
```

Ключевые переменные `.env`:

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `PORT` | порт приложения | 8810 |
| `DB_PATH` | путь к SQLite | `/data/handcheck.sqlite` |
| `SESSION_SECRET` | подпись сессий | обязательна в проде |
| `GRADE_COOLDOWN_DAYS` | лимит пересдачи | 30 |
| `APP_BASE_URL` | внешний адрес для ссылок | `http://127.0.0.1:8810` |
| `DEMO_MODE` | демо-аккаунты и код подтверждения `000000` | 1 |
| `LLM_BASE_URL`, `LLM_API_KEY` | генерация черновиков заданий | Zen (`space-bunny-free` → `glm-5.3-flash`) |

Секреты в репозиторий не попадают: `.env` в `.gitignore`, наружу отдаётся только `.env.example`.

## 3. Docker Compose (рекомендуемый способ)

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:8810/api/health
```

- Секреты берутся из `.env` через `env_file`, БД живёт в томе `handcheck-data:/data`.
- Контейер публикует только `127.0.0.1:8810`; внешний адрес закрывает Caddy.

## 4. Развёртывание

```text
push в main → self-hosted runner (метки handcheck, konbas) → docker compose up -d --build
            → health-опрос до 120 с с проверкой GIT_COMMIT
```

Состав деплоя — [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).
Проверка после раскатки:

```bash
curl -fsS http://127.0.0.1:8810/api/health          # с самого сервера (hairpin по домену может не работать)
BASE_URL=https://handcheck.baski.pro AUDIT_MODE=readonly node scripts/functional-audit.js
```

## 5. Демо-данные и сценарий для жюри

```bash
DEMO_MODE=1 DB_PATH=/data/handcheck.sqlite node scripts/seed-jury-pack.js
```

| Email | Роль | Состояние |
|---|---|---|
| `anna@demo.local` | кандидат | подтверждённая категория Backend × Middle |
| `boris@demo.local` | кандидат | та же категория, часто «отложен» в колоде |
| `demo3@demo.local` … `demo8@demo.local` | кандидаты | разный `test_score`, разный порядок в колоде |
| `demo-unconf@demo.local` | кандидат | тест не проходил — видно, как категория не выдаётся |
| `cafe@demo.local` | работодатель | потребность «Автоматизация работы официанта» |

Пароль — из `.env.example`, код подтверждения — `000000`. Клик-маршрут: [docs/JURY-DEMO.md](./JURY-DEMO.md).

## 6. Библиотеки и версии

| Пакет | Версия | Зачем |
|---|---|---|
| `express` | ^4.21.2 | HTTP-сервер и маршрутизация |
| `better-sqlite3` | ^11.8.1 | синхронный SQLite в одном процессе |
| `bcryptjs` | ^2.4.3 | хеширование паролей |
| `zod` | ^3.25.76 | валидация тела запросов и MCP-инструментов |
| `ws` | ^8.18.1 | сигналинг комнаты звонка |
| `multer` | ^2.0.2 | приём записей звонков (чанки) |
| `@modelcontextprotocol/sdk` | ^1.32.1 | MCP-сервер для ИИ-клиентов |
| `@fontsource-variable/manrope`, `onest` | ^5.3.0/^5.3.1 | шрифты интерфейса без внешних CDN |
| `playwright` | ^1.49.1 (dev) | функциональные и UI-проверки |
| `supertest` | ^7.1.0 (dev) | HTTP-тесты API |

Системные: Node.js ≥ 20, ffmpeg (записи звонков), Docker Compose (деплой).

## 7. Проверки перед сдачей

```bash
npm test                 # 347 проходят; 9 известных падений есть и на чистом HEAD
npm run validate         # качество теста, подбора и приватности
node scripts/functional-audit.js                                        # 41 проверка на стенде
BASE_URL=https://handcheck.baski.pro AUDIT_MODE=readonly node scripts/functional-audit.js   # 8 проверок на проде
METRICS_JSON=context/metrics-assessment.json node scripts/assessment-metrics.js            # числа для отчёта
```