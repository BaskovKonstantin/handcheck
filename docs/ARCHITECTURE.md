# HandCheck — архитектура и структура репозитория

Документ для Grok Bot / coding agents. Читать вместе с `docs/TZ.md` и `AGENTS.md`.

## Зафиксированные решения (не переизобретать без запроса оператора)

| Тема | Решение | Почему |
|------|---------|--------|
| Форма | Модульный монолит Node 20 + Express | Уже задеплоен, быстрые итерации |
| UI MVP | Серверные страницы + JS в `app/public` (без SPA-фреймворка на старте) | UI весит 10%; скорость демо важнее |
| БД | SQLite (`better-sqlite3`) в volume `/data` | Один контейнер, простое демо |
| Auth | Email + magic link / одноразовый код (без Keycloak в MVP) | ТЗ: Keycloak — ориентир, не требование |
| Тест | Банк заданий + **параллельные формы** + cutoff по грейду | Устойчивее утечки и LLM-уникальности |
| Подбор | Сначала категория, потом rank(score, fspBoost) | 35% жюри |
| Деплой | Docker Compose + CI на `main` → handcheck.baski.pro | Уже работает |

Не делать: парсер HH/Avito, рейтинг по престижу резюме, секреты в git.

---

## Целевое дерево

```text
handcheck/
├── AGENTS.md                 # правила для агента
├── README.md
├── package.json
├── Dockerfile
├── docker-compose.yml
├── openapi.yaml              # контракт API (добавить в фазе API)
├── docs/
│   ├── TZ.md                 # сжатое ТЗ
│   ├── ARCHITECTURE.md       # этот файл
│   ├── DATA-MODEL.md         # сущности и поля
│   └── VALIDATION.md         # как сами проверяем качество теста/подбора
├── app/
│   ├── server.js             # bootstrap: middleware, mount routers, static
│   ├── config.js             # env: PORT, DB_PATH, GRADE_COOLDOWN_DAYS, …
│   ├── db/
│   │   ├── migrate.js
│   │   ├── schema.sql
│   │   └── seed.js           # специализации, грейды, формы теста, демо-юзеры
│   ├── middleware/
│   │   ├── auth.js
│   │   └── errors.js
│   ├── modules/
│   │   ├── auth/             # регистрация, confirm email, session
│   │   ├── candidates/       # профиль кандидата, приватность, FSP ID stub
│   │   ├── employers/        # профиль компании
│   │   ├── catalog/          # справочник specialization × grade → category
│   │   ├── assessment/       # опрос, выдача формы, submit, score, category assign
│   │   ├── matching/         # need → candidates + explanation
│   │   ├── invitations/      # invite, statuses, accept → reveal contacts
│   │   ├── vacancies/        # OPTIONAL MVP+
│   │   └── fsp/              # stub достижений + «нет истории ФСП»
│   ├── lib/
│   │   ├── ranking.js        # score + fspBoost
│   │   ├── privacy.js        # redaction контактов
│   │   └── ids.js
│   └── public/               # UI
│       ├── index.html
│       ├── candidate/
│       ├── employer/
│       ├── styles.css
│       └── app.js            # общий fetch/helpers
└── scripts/                  # ops (уже есть bootstrap/runner)
```

Пока модулей нет — **создавать по фазам ниже**, не одним коммитом «всё сразу».

---

## Домены и ответственность

### `catalog`
Справочник, который команда задаёт сама (ТЗ разрешает). MVP минимум:

- specializations: `backend`, `frontend`, `fullstack`, `qa`, `data`, `devops` (можно расширять)
- grades: `junior`, `middle`, `senior`
- `category = specialization + " × " + grade` (стабильный `category_id`)

Категория, которую видит работодатель, ставится **только** после теста, не из резюме.

### `assessment` (25% жюри)
Поток:

1. Survey: отрасль / specialization  
2. Candidate выбирает claimed grade  
3. Система выдаёт **форму** из банка для `(specialization, grade)` — случайная из ≥2 параллельных форм  
4. Submit → score → pass/fail cutoff  
5. При pass: `category_id` + `test_score`  
6. При fail: предложить форму на grade ниже (без принудительного даунгрейда текущей категории, если уже была)  
7. Смена грейда: не чаще `GRADE_COOLDOWN_DAYS`

Форматы заданий MVP: MCQ + короткие work-sample (текст/псевдокод); автопроверка по ключу/рубрике. Judge0/запуск кода — фаза позже, не блокер первого демо.

Антиутечка: несколько форм на ячейку матрицы, не один вечный квиз.

### `matching` (ядро 35%)
Вход: `employer_need` (stack[], specialization?, grade?, notes).

Выход:

```json
{
  "categories": [{ "categoryId": "...", "why": "..." }],
  "candidates": [{
    "id": "...",
    "categoryId": "...",
    "rankScore": 0.87,
    "explanation": ["совпал grade middle", "test_score 0.91", "есть FSP stub"],
    "publicProfile": { "...без email/phone..." }
  }]
}
```

Правила:

- фильтр по категории теста;
- rank = `w1 * test_score + w2 * fsp_boost` (веса в config);
- контакты только через `privacy.redact` до accept.

### `invitations`
Статусы: `sent` → `viewed` → `accepted` | `declined`.  
Обязательные поля: company name, offer text, salary_from, salary_to (₽).  
На `accepted`: работодатель получает контакты кандидата.

### `fsp`
Нет внешнего API. Stub: опциональный `fsp_id` + массив достижений или пусто.  
UI и matching **обязаны** корректно работать при пустой истории.

### `vacancies` (опционально)
Не блокирует MVP. Если делать — ЗП от–до обязательна; отклик раскрывает контакты как accept.

---

## API (черновик контракта)

Префикс `/api`. JSON. После auth — session cookie или Bearer.

| Method | Path | Модуль | Назначение |
|--------|------|--------|------------|
| POST | `/api/auth/register` | auth | email + role |
| POST | `/api/auth/confirm` | auth | token/code |
| POST | `/api/auth/login` | auth | |
| GET | `/api/me` | auth | текущий пользователь |
| GET/PUT | `/api/candidate/profile` | candidates | |
| POST | `/api/assessment/survey` | assessment | specialization |
| POST | `/api/assessment/start` | assessment | claimed grade → form |
| POST | `/api/assessment/submit` | assessment | answers → category |
| GET | `/api/candidate/category` | assessment | статус + cooldown |
| GET | `/api/candidate/invitations` | invitations | |
| POST | `/api/candidate/invitations/:id/accept` | invitations | |
| POST | `/api/candidate/invitations/:id/decline` | invitations | |
| GET/PUT | `/api/employer/profile` | employers | |
| POST | `/api/employer/needs` | matching | создать/обновить потребность |
| GET | `/api/employer/matches` | matching | подборка + why |
| GET | `/api/employer/candidates` | matching | банк + фильтры |
| POST | `/api/employer/invitations` | invitations | |
| GET | `/api/employer/invitations` | invitations | |
| GET | `/api/health` | server | уже есть |
| GET | `/api/meta` | server | уже есть |

Старые stub-роуты в `server.js` заменить модульными, сохранив `/api/health`.

---

## Фазы реализации (порядок для агента)

Делать **по одной фазе**, коммит + проверка на https://handcheck.baski.pro.

### Phase 0 — каркас (сейчас)
Шаблон UI + health. Задеплоено.

### Phase 1 — данные и auth
`db/schema`, migrate, seed справочников, register/confirm/login, `/api/me`.

### Phase 2 — assessment → category
Survey, forms bank, submit, category assign, cooldown. Кандидат видит свою категорию в UI.

### Phase 3 — matching + invitations (**ядро жюри**)
Need, matches с explanation, invite с ЗП, accept/decline, reveal contacts. Полный демо-сценарий.

### Phase 4 — polish
OpenAPI, VALIDATION.md с метриками на seed-данных, UI polish, seed демо-аккаунтов.

### Phase 5 — опционально
Vacancies/applications, PDF parse stub, short tasks, code runner.

Не начинать Phase 5, пока Phase 3 не проходит демо end-to-end.

---

## UI карта

| URL | Роль | Экраны |
|-----|------|--------|
| `/` | public | лендинг + вход в кабинеты |
| `/candidate/` | candidate | профиль, тест, категория, приглашения |
| `/employer/` | employer | компания, потребность, подборка, банк, исходящие |

Каждый экран бьёт в API выше. Не дублировать бизнес-логику в клиенте.

---

## Конфиг (env)

```text
PORT=8810
DB_PATH=/data/handcheck.sqlite
SESSION_SECRET=...
GRADE_COOLDOWN_DAYS=90
RANK_W_TEST=0.7
RANK_W_FSP=0.3
APP_BASE_URL=https://handcheck.baski.pro
```

Секреты только в `.env` на сервере / CI secrets, не в репозитории.

---

## Критерии «готово к демо»

1. Два аккаунта (кандидат, работодатель) из seed или регистрации.  
2. Кандидат получает категорию только после теста.  
3. Работодатель видит подборку с `explanation`, шлёт приглашение с вилкой.  
4. До accept email/phone кандидата не отдаются в API работодателю.  
5. После accept контакты видны.  
6. Кейс без FSP работает.  
7. `/api/health` зелёный на проде.
