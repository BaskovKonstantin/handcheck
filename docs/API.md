# Описание API

Контракт машинно-читаемый — [openapi.yaml](../openapi.yaml) (OpenAPI 3). Этот документ
объясняет логику: кто что вызывает, что скрыто от кого и где ломается контракт.

## Карта маршрутов

Все маршруты под `/api`, кроме `/mcp` (JSON-RPC для ИИ-клиентов). Аутентификация — сессия в
cookie `handcheck_sid`; для MCP — bearer-токен из раздела «Интеграции».

| Область | Методы и пути | Роль |
|---|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/confirm`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/demo-login` | все |
| Профиль кандидата | `GET|PUT /api/candidate/profile`, `GET|PUT /api/candidate/availability`, `GET|POST|DELETE /api/candidate/background` | кандидат |
| Категория и история | `GET /api/candidate/category`, `GET /api/candidate/past`, `GET /api/stats` | кандидат |
| Тест | `POST /api/assessment/battery/start`, `GET /api/assessment/battery/current`, `GET /api/assessment/tasks/:id`, `POST /api/assessment/tasks/:id/open`, `PATCH|POST /api/assessment/tasks/:id/draft`, `POST /api/assessment/tasks/:id/submit`, `POST /api/assessment/events` | кандидат |
| Генерация заданий | `POST /api/assessment/generate`, `POST /api/assessment/tasks/:id/publish` | работодатель, в `DEMO_MODE` — заголовок `x-demo-admin: 1` |
| Приглашения (кандидат) | `GET /api/candidate/invitations`, `POST /api/candidate/invitations/:id/accept`, `POST /api/candidate/invitations/:id/decline` | кандидат |
| Приглашения (работодатель) | `POST /api/employer/invitations`, `GET /api/employer/invitations`, `GET /api/employer/invitations/calls`, `GET /api/employer/candidates/:candidateId/contacts` | работодатель |
| Компания и потребность | `GET|PUT /api/employer/profile`, `GET|POST /api/employer/needs`, `PUT /api/employer/needs/:id`, `GET /api/employer/dashboard`, `GET /api/employer/overview` | работодатель |
| Подбор | `GET /api/employer/needs/:id/matches`, `GET /api/employer/candidates`, `GET /api/employer/needs/:id/deck/next`, `GET /api/employer/needs/:id/deferred`, `POST /api/employer/needs/:id/reviews`, `DELETE /api/employer/needs/:id/reviews/:candidateId` | работодатель |
| Короткие тесты | `POST|GET /api/employer/tests`, `GET|PUT|DELETE /api/employer/tests/:id`, `POST /api/employer/tests/:id/items`, `PUT|DELETE /api/employer/tests/:id/items/:itemId`, `POST /api/employer/tests/:id/items/reorder`, `POST /api/employer/tests/:id/publish`, `POST /api/employer/tests/:id/generate`, `POST /api/employer/tests/:id/assign`, `GET /api/employer/test-assignments/:id`, `GET /api/employer/company-tests` | работодатель |
| Короткие тесты (кандидат) | `GET /api/candidate/company-tests`, `GET /api/candidate/company-tests/:assignmentId`, `POST /api/candidate/company-tests/:assignmentId/start`, `POST /api/candidate/company-tests/:assignmentId/answers`, `POST /api/candidate/company-tests/:assignmentId/submit` | кандидат |
| Звонки | `POST /api/calls/:id/start`, `POST /api/calls/:id/consent`, `POST /api/calls/:id/transcript-chunk`, `POST /api/calls/:id/end`, `GET /api/calls/:id/recording`, `GET /api/calls/:id/analysis`, `GET /api/calls/for-invitation/:invitationId` | обе роли по приглашению |
| Интеграции | `GET /api/integrations/config`, `GET|POST /api/integrations/tokens`, `DELETE /api/integrations/tokens/:id`, `GET /api/integrations/audit` | работодатель |
| Приватность | `GET /api/privacy-notice` | все |
| MCP | `POST /mcp` (`tools/list`, `tools/call`) | bearer-токен |
| Служебные | `GET /api/health`, `GET /api/me` | все |

## Правила доступа

1. **Роль.** Кандидат получает 403 на `/api/employer/*`, работодатель — на кандидатские эндпоинты
   теста (кроме чтения профиля/категории там, где это нужно).
2. **Подтверждение email.** Все рабочие маршруты требуют `email_confirmed_at`.
3. **Same-origin.** Небезопасные методы с чужим `Origin` отклоняются (403) — защита от CSRF.
4. **Приватность.** Контакты кандидата не отдаются работодателю, пока нет принятого приглашения.
5. **Баллы.** `test_score`, `integrity`, `trust_ok` не появляются ни в одном публичном ответе.
6. **Токены.** API-токен действует только на `/mcp`; на REST-запрос с токеном — 403.

## Формат ошибок

```json
{ "error": "cooldown",
  "message": "Пересдача по этой специализации пока недоступна",
  "retakeAt": "2026-11-08T12:15:46.142Z" }
```

| Код | Когда |
|---|---|
| 400 `invalid_body` | не прошла валидация; в `details.fields` — что именно исправить |
| 401 `unauthorized` | нет сессии |
| 403 `forbidden` | нет роли, нет согласия, контакты до accept, токен на REST |
| 404 `not_found` | чужой объект или несуществующий маршрут |
| 409 | конфликт состояния: `cooldown`, `invitation_duplicate`, `candidate_rejected`, `not_current_task`, `deadline_passed` |
| 413 | запись звонка больше лимита (80 МБ) |
| 501 `llm_not_configured` | нет ключа LLM для генерации черновиков |
| 502 `llm_failed` | LLM недоступен или вернул невалидный JSON |

## Пример сквозного вызова

```bash
# 1. кандидат начал батарею
curl -c c.txt -X POST localhost:8810/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"anna@demo.local","password":"demo-demo-demo"}'
curl -b c.txt -X POST localhost:8810/api/assessment/battery/start \
  -H 'Content-Type: application/json' \
  -d '{"specialization":"backend","grade":"middle","privacyConsent":true}'

# 2. работодатель смотрит подборку (контактов в ней нет)
curl -c e.txt -X POST localhost:8810/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"cafe@demo.local","password":"demo-demo-demo"}'
curl -b e.txt localhost:8810/api/employer/needs/<needId>/matches

# 3. приглашение с вилкой → контакты появятся только после accept
curl -b e.txt -X POST localhost:8810/api/employer/invitations \
  -H 'Content-Type: application/json' \
  -d '{"needId":"<needId>","candidateId":"<candidateId>","salaryFrom":120000,
       "salaryTo":180000,"offerText":"Приглашаем в команду","contactChannel":"telegram"}'
```