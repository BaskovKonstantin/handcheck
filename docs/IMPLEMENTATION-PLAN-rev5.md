# HandCheck rev.5 — полный план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Шаги помечены `- [ ]`.

**Goal:** Довести HandCheck от Phase 0 до end-to-end демо: категория по батарее QuickProbe+WorkSim, подбор и колода без фото, мультиинвайты, видеозвонок с записью и внутренним разбором для работодателя, UI на палитре clay/forest по композиции Mercor.

**Architecture:** Модульный монолит Node 20 + Express; SQLite в `/data`; бизнес-логика в `app/modules/*`; статический UI в `app/public/`; WebSocket на том же процессе для WebRTC-сигналинга; фоновые задачи (analyzeCall) — in-process queue после `ended`.

**Tech Stack:** express, better-sqlite3, bcryptjs (чистый JS, без второго native-модуля), ws, `crypto.randomUUID`. Сессия — строка в `sessions` и httpOnly-cookie с id, не cookie-session. Опциональный fetch к `LLM_BASE_URL`.

**Ревизия 2026-10-06:** формулы ниже — канон. Не возвращать произвольные веса 0.4/0.6 между Quick и Work, `fsp_boost = 0.15`, путь `/api/admin/tasks/*`, один общий `recording.webm` и seed, где Борис слабее Анны по тесту.

---

## Global Constraints (locked — не менять без оператора)

- Палитра HandCheck: paper `#F7F4EE`, card `#FFFCF8`, ink `#1A2332`, muted `#5E6A7A`, line `#E4DDD2`, clay `#C2410C`, clay-hover `#9A3412`, forest `#1F4D3A`, forest-soft `#E5F0EA`, danger `#9F2D2D`, on-clay `#FFFFFF`. **Не** индиго Mercor `#4F46E5`.
- Композиция UI — референс Mercor (шапка, герой, метрики, row-link, три шага), копирайт **русский**.
- Категория только после теста; UI **не показывает** score, integrity, test_score, rank, числовой рейтинг.
- Батарея: 4× QuickProbe + 1× WorkSim, форма A или B случайно из **published** tasks.
- Повтор той же specialization — cooldown `GRADE_COOLDOWN_DAYS=90`. Смена грейда — отдельная попытка, **без** принудительного даунгрейда текущей категории при fail.
- Rank внутри категории: `0.60*test_score + 0.15*motivation + 0.10*fsp_boost + 0.15*domain_boost`.
- Контакты и комната звонка — только после `invitation.status=accepted`.
- `candidate_private.integrity` / `trust_ok` — **никогда** в API кандидата и работодателя.
- `call_analyses` — только работодателю, только `summary_text` после `calls.status=ended`; кандидату не отдавать.
- LLM: генерация tasks → `draft`, в батарею не попадает; без `LLM_BASE_URL` → 501 на generate, не crash.
- Демо: `DEMO_MODE=1`, код email `000000` принимается **только** при `DEMO_MODE=1` (рядом со случайным кодом). Пароль seed — `DEMO_PASSWORD` из `.env.example`.
- Seed: `test_score` Анны и Бориса **равны**. Порядок на потребности кафе доказывает `domain_boost`, а не разницу теста.
- Запреты: лидерборд, грейд из резюме, Judge0 в MVP, эксклюзив после accept, живой уникальный LLM-тест на старте, показ integrity, палитра indigo, vacancy-scraper как ядро, фото и аватар-заглушка лица в колоде.
- `server.js` экспортирует `createApp()`. `listen` только при `require.main === module`, чтобы validators не занимали порт 8810.
- Движение интерфейса — CSS, без библиотеки анимаций. Один направленный жест на колоде, остальное короткое. Бесконечный пульс, bounce, градиент и тень не входят. `prefers-reduced-motion: reduce` оставляет экран мгновенным.

---

## 1. Карта системы (разделы и ответственность)

```text
┌─────────────────────────────────────────────────────────────────┐
│  Public: /  (лендинг)  │  Auth: register / confirm / login       │
└────────────┬──────────────────────────────────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
 Candidate cabinet   Employer cabinet
 (5 nav items)       (5 nav items)
    │                 │
    ├─ assessment     ├─ needs
    ├─ invitations    ├─ matching + deck + deferred
    └─ calls          ├─ invitations
                      └─ calls (+ internal analysis view)
             │
    ┌────────┴────────────────────────────────────────┐
    │ SQLite + modules                                 │
    │ auth │ profiles │ background │ catalog │ tasks   │
    │ assessment │ matching │ reviews │ invitations    │
    │ calls │ signaling(ws) │ media upload │ analysis  │
    └──────────────────────────────────────────────────┘
```

| Раздел | Модуль(и) | Ключевые таблицы |
|--------|-----------|------------------|
| Вход и сессии | `modules/auth` | users, sessions, email_tokens |
| Профили | `modules/candidates`, `modules/employers` | candidate_profiles, employer_profiles, background_episodes |
| Справочник категорий | `modules/catalog` | categories |
| Банк заданий | `modules/tasks` | tasks |
| Тест и категория | `modules/assessment` | attempts, attempt_events, candidate_categories, candidate_private |
| ФСП (stub) | `modules/fsp` | fsp_achievements |
| Потребность | `modules/needs` | employer_needs |
| Подбор | `modules/matching` | (read-only join) |
| Колода | `modules/deck` | need_reviews |
| Приглашения | `modules/invitations` | invitations |
| Звонки | `modules/calls` | calls, call_analyses |
| Приватность | `lib/privacy.js` | — |
| Ранжирование | `lib/ranking.js`, `lib/domain-boost.js` | — |
| Скоринг текста | `lib/rubric-score.js`, `lib/motivation.js`, `lib/integrity.js` | — |

---

## 2. Целевое дерево файлов (delta от Phase 0)

```text
handcheck/
├── .env.example
├── openapi.yaml
├── package.json                    # + deps, validate scripts
├── docker-compose.yml              # + volume /data, env file
├── docs/
│   ├── design.md                   # NEW
│   ├── UX.md                       # NEW
│   ├── IMPLEMENTATION-PLAN-rev5.md # этот файл
│   ├── TZ.md, ARCHITECTURE.md, DATA-MODEL.md, VALIDATION.md  # sync rev.5
├── app/
│   ├── server.js                   # mount routers, ws, migrate on boot
│   ├── config.js
│   ├── db/
│   │   ├── schema.sql
│   │   ├── migrate.js
│   │   └── seed.js
│   ├── middleware/auth.js, errors.js, require-role.js
│   ├── lib/
│   │   ├── ids.js, tokens.js
│   │   ├── rubric-score.js
│   │   ├── motivation.js
│   │   ├── integrity.js
│   │   ├── ranking.js
│   │   ├── domain-boost.js
│   │   ├── privacy.js
│   │   ├── task-phrases.js         # словесные итоги для колоды
│   │   └── llm-client.js           # optional generate/analyze
│   ├── modules/
│   │   auth/router.js
│   │   candidates/router.js
│   │   employers/router.js
│   │   needs/router.js
│   │   tasks/router.js             # POST /api/assessment/generate и publish
│   │   assessment/router.js
│   │   matching/router.js
│   │   deck/router.js
│   │   invitations/router.js
│   │   calls/router.js, signaling.js, analyze-call.js
│   │   stats/router.js             # landing counters
│   └── public/
│       ├── styles.css              # design tokens
│       ├── app.js                  # fetch, nav shell
│       ├── index.html
│       ├── auth.html               # login/register
│       ├── candidate/*.html + candidate.js
│       ├── employer/*.html + employer.js
│       ├── employer/deck.html + deck.js
│       └── call.html + call.js     # страница комнаты, URL /call/:invitationId
├── scripts/
│   ├── validate-assessment.js
│   ├── validate-matching.js
│   ├── validate-privacy.js
│   └── fixtures/
│       ├── backend-middle-strong.json
│       ├── backend-middle-weak.json
│       └── canonical-answer-ab.json
└── test/                           # node:test чистых функций, рядом с коммитом формулы
    ├── rubric-score.test.js
    ├── domain-boost.test.js
    └── privacy.test.js
```

---

## 3. Модель данных (rev.5 — канон для schema.sql)

Полная таблица полей — в `docs/DATA-MODEL.md` после синхронизации. Здесь — инварианты и связи.

### 3.1 Пользователи и auth

- `users`: email UNIQUE, `email_confirmed_at`, role `candidate|employer`, `password_hash`.
- `sessions`: id, user_id, expires_at.
- `email_tokens`: user_id, code_hash, purpose `confirm`, expires_at, used_at.

**Правило:** любой `/api/candidate/*`, `/api/employer/*` (кроме auth) → 403 если `email_confirmed_at` NULL.

### 3.2 Профили и бэкграунд

- `candidate_profiles`: display_name, stack_json, phone, contact_email, consent_at, fsp_id NULL, **availability** `open|paused`.
- Полей `headline` и `privacy_json` из старого DATA-MODEL **нет**.
- `background_episodes`: candidate_user_id, role_title, domain, industry, note. Это домен для boost, не престиж резюме.
- `employer_profiles`: company_name, description, industry, contact_email.

### 3.3 Каталог и tasks

- `categories`: specialization, grade, label («Backend × Middle»). Отдельных таблиц `specializations` / `grades` и `assessment_forms` нет: форма — это набор строк `tasks`.
- Seed-специализации: `backend`, `frontend`, `qa`. Грейды: `junior`, `middle`, `senior`. Девять категорий.
- `tasks`: type `quick|work`, specialization, grade, form_key `A|B` NULL у draft, prompt, rubric_json, status `draft|published`, origin `manual|llm`.

**Seed backend × middle, формы A и B, обе published:** ровно **4** QuickProbe и **1** WorkSim на форму. Минимум спецификации — 2 quick; батарея требует 4, поэтому seed сразу полный. Если у формы меньше 4 published quick или нет work, `battery/start` отвечает **409** `battery_incomplete`.

`rubric_json`:

```json
{
  "keys": ["rest", "статус"],
  "breadthKeys": ["идемпотентность"],
  "workItems": [{ "id": "auth", "phrases": ["авторизац", "токен"] }]
}
```

Quick использует `keys` и `breadthKeys`. Work использует `keys` и `workItems`.

### 3.4 Попытки и телеметрия

- `attempts`: candidate_user_id, task_id, battery_id, form_key, answer_text, knowledge, breadth, started_at, submitted_at.
- `attempt_events`: append-only. Клиент шлёт `first_input`, `paste`, `blur`, `focus`, `draft`, `submit`. Сервер сам пишет `opened_at` при выдаче задания. Чужой `opened_at` от клиента — 400.
- Ответ `POST /api/assessment/events` — только `{ "ok": true }`. В ответах кабинета нет events, knowledge, breadth, test_score, integrity.

### 3.5 Категория и приватный слой

- `candidate_categories`: одна текущая строка на кандидата: category_id, test_score, knowledge, breadth, motivation, assigned_at, grade_changed_at.
- `candidate_private`: integrity 0..1, trust_ok 0/1. При integrity ≥ 0.85 → trust_ok=0 **без UI**.

### 3.6 Подбор и колода

- `employer_needs`: title, specialization, grade, stack_json, **domain_text**, notes, active.
- `need_reviews`: UNIQUE(employer_user_id, need_id, candidate_user_id), decision `rejected|later|invited`, updated_at.
- `invitations`: salary_from/to, offer_text, contact_channel, status `sent|viewed|accepted|declined`.

### 3.7 Звонки

- `calls`: invitation_id UNIQUE, status `ready|live|ended`, started_at, ended_at, recording_path (каталог, не один файл), transcript_text, consent_at_candidate, consent_at_employer.
- Файлы: `/data/calls/{callId}/candidate.webm` и `employer.webm`.
- `call_analyses`: call_id, summary_text (ровно 3 фразы), domain_hits_json, consistency_note. Кандидату не отдавать. В rank не входит.

---

## 4. Как работает оценка (assessment)

### 4.1 Поток батареи

1. Кандидат выбирает specialization + claimed grade.
2. Cooldown на **всю специализацию**, не на пару specialization+grade. Пока не прошло `GRADE_COOLDOWN_DAYS` от последнего `submitted_at` этой специализации, новая батарея того же направления — **409**, даже если заявлен другой грейд.
3. `form_key` A или B выбирается один раз на батарею. Все пять заданий — published и этой формы.
4. QuickProbe: ориентир 90 секунд только в UI. Сервер по таймеру не обрывает.
5. WorkSim: дедлайн 60 минут от серверного `opened_at`. Черновик каждые 10 секунд и по blur.
6. Submit WorkSim после дедлайна — **409**. `finish_bonus = 0`. Если дедлайн вышел и work не сдан, батарея закрывается как «не подтверждено». Старая категория остаётся.
7. Pass записывает новую категорию. Fail **не** понижает уже записанную категорию. После cooldown успешный другой грейд заменяет категорию и ставит `grade_changed_at`.

### 4.2 Rubric → knowledge и breadth

Нормализация ответа и ключа: lower, `ё→е`, схлопнуть пробелы, убрать пунктуацию. Ключ засчитан, если нормализованная подстрока входит в нормализованный ответ. Другого fuzzy-match нет.

- Quick `knowledge` = доля `rubric.keys`, которые нашлись.
- Quick `breadth` = доля `rubric.breadthKeys`. Если список пуст, breadth = knowledge этого пункта.
- Work `knowledge` = доля `rubric.keys`.
- Work `breadth` = доля `workItems`, у которых нашлась хотя бы одна фраза.

Агрегация батареи (это не веса жюри, а фиксированный микс «блок коротких» и «рабочая задача», чтобы четыре short не затёрли work и наоборот):

- `knowledge = 0.5 * mean(quick.knowledge) + 0.5 * work.knowledge`
- `breadth = 0.5 * mean(quick.breadth) + 0.5 * work.breadth`
- `test_score = 0.6 * knowledge + 0.4 * breadth` — единственные веса, которые заданы спецификацией. В UI не показывать.

Cutoff по claimed grade:

| grade | cutoff |
|-------|--------|
| junior | 0.55 |
| middle | 0.68 |
| senior | 0.78 |

Pass: `test_score >= cutoff` → upsert `candidate_categories` с grade = claimed, specialization из батареи.

Fail: ответ API — «не подтверждено» + дата пересдачи; **не** понижать существующую category row.

### 4.3 Motivation (не WPM)

Три сигнала WorkSim, равный вес. Скорость печати не используется. Медиану seed не считать.

- `start_bonus`: нет `first_input` → 0. Иначе минуты от `opened_at` до первого `first_input`: ≤ 3 → 1; ≥ 15 → 0; между ними `(15 - minutes) / 12`.
- `finish_bonus`: 1, если work сдан до дедлайна, иначе 0.
- `draft_bonus`: 1, если до submit был хотя бы один `draft`, иначе 0.

`motivation = (start_bonus + finish_bonus + draft_bonus) / 3`.

### 4.4 Integrity (только candidate_private)

Три сигнала спецификации, равный вес:

- `paste_ratio` = `paste / max(1, paste + first_input)`.
- `jump_flag` = 1, если длина ответа выросла больше чем в 2 раза между соседними draft/submit **и** в этом промежутке был `paste`. Иначе 0.
- `blur_ratio` = `min(1, blur_count / 12)`.

`integrity = (paste_ratio + jump_flag + blur_ratio) / 3`.

Порог `>= 0.85` ставит `trust_ok = 0`. Обычный набор blur сам по себе порог не берёт: даже `blur_ratio = 1` без paste и скачка даёт 0.33. Сообщение пользователю не показывать.

### 4.5 Словесные фразы для колоды (task-phrases)

Ровно три фразы, без процентов и без порога «высокий knowledge»:

1. Все 4 quick сданы → «Короткие ответы по API сданы». Иначе → «Короткие ответы сданы не все».
2. Work сдан до дедлайна → «Рабочая задача доведена до конца». Иначе → «Рабочая задача не сдана».
3. Был draft → «По ходу задачи были промежуточные черновики». Иначе → «Задача сдана одним ответом».

Считать при выдаче карточки, в БД не хранить.

### 4.6 Эквивалентность форм A/B (validation)

На **одном** эталонном тексте ответов прогнать все quick+work A и B backend×middle:

- `|score_A - score_B| < 0.15` по сумме knowledge+breadth.

---

## 5. Как работает рекомендательная система (matching)

### 5.1 Воронка (жёсткие фильтры)

Кандидат попадает в пул need только если **все**:

1. `candidate_categories.specialization = need.specialization` AND `grade = need.grade`
2. `candidate_profiles.availability = 'open'`
3. `candidate_private.trust_ok = 1`
4. Нет `need_reviews.decision = 'rejected'` для (employer, need, candidate)
5. В колоде нет и `rejected`, и `later`. `later` живёт только в «Отложенных».

### 5.2 domain_boost

Токены: lower, `ё→е`, резать по не-буквам, длина ≥ 3. Поля эпизода: `role_title`, `domain`, `industry`. Поле потребности: `domain_text`.

Закрытый словарь, без самовольных добавлений:

```javascript
const SYNONYM_GROUPS = [
  ["официант", "зал", "horeca", "ресторан", "гость"],
];
```

Перед сравнением леммы демо-форм (иначе «официанта» не совпадёт с «официант», а «гостей» — с «гость»):

```javascript
const LEMMA = {
  официанта: "официант",
  официантов: "официант",
  официанты: "официант",
  гостей: "гость",
  гостя: "гость",
  ресторана: "ресторан",
  ресторане: "ресторан",
};
```

`HoReCa` после lower становится `horeca` и попадает в группу.

Если токен после леммы входит в группу, в множество добавляется **вся** группа.  
`domain_boost = |need ∩ episodes| / max(1, |need|)`, затем clamp 0..1.  
Пустой бэкграунд → 0, это не штраф.

**Демо:** у Анны и Бориса одинаковые `test_score` и `motivation`, ФСП нет. Эпизод Анны: роль «официант», домен «обслуживание гостей», отрасль HoReCa. У Бориса такого эпизода нет. На потребности «автоматизация работы официанта» Анна выше.

### 5.3 fsp_boost

Вес в rank уже `0.10`, поэтому буст не сжимают второй раз.

- Нет строк в `fsp_achievements` → `0`.
- Есть хотя бы одна → `1`.

### 5.4 Rank

```text
rank = 0.60 * test_score
     + 0.15 * motivation
     + 0.10 * fsp_boost
     + 0.15 * domain_boost
```

Сортировка по `rank` DESC, tie-breaker: `assigned_at` ASC (раньше подтвердил — выше).

Ответ `GET .../matches` — массив объектов только с полями: `id`, `categoryLabel`, `stack`, `backgroundDomains`, `explanation` (2–3 русские фразы). Нет `score`, `rank`, `test_score`, `motivation`, `integrity`, `phone`, `contact_email`. Порядок массива — это rank, число наружу не кладётся.

### 5.5 Explanation (2–3 русские фразы)

Без цифр. Взять первые подходящие, не больше трёх:

- «Категория совпадает с потребностью: Backend × Middle»
- Если `domain_boost > 0`: «Прошлый опыт пересекается с доменом задачи»
- Если `fsp_boost = 1`: «Есть достижения ФСП в профиле»
- Если work сдан: «Рабочую задачу в тесте довёл до конца»
- Если стеки пересеклись: «Совпадает стек: node» (имена стека, не проценты)

На карточке колоды — первые две фразы «почему в этой потребности».

### 5.6 Фильтры UI (не ломают базовый список)

Фильтры стек и ФСП (да/нет) — только query этой выдачи. Отфильтрованный набор **не записывается** как новый состав потребности.

- `GET` без query возвращает полный ranked-список в исходном порядке.
- `?stack=node` и `?fsp=1|0` сужают уже отсортированный список, порядок оставшихся не пересчитывают заново другим правилом.

### 5.7 Колода vs список

Переключатель «Колода / Список» на обоих видах. Это одна подборка.

- Список: строки `.row-link`, вилка здесь не нужна, есть «почему» и фильтры.
- Колода `/employer/deck`: одна карточка, без фото и без портретной заглушки. Имя, pill категории, домены (роль и отрасль), стек, три фразы заданий, две строки «почему».
- Влево / «Отказать» → `rejected`. Приглашения нет, кандидат ничего не получает, в эту колоду больше не попадает.
- Вниз / «Отложить» → `later`. Приглашения нет. Виден в «Отложенных».
- Вправо / «Пригласить» → лист вилки и текста, затем invitation и `decision=invited`.
- Вернуть можно только `later`: `DELETE /api/employer/needs/:needId/reviews/:candidateId`. `rejected` в этой поставке не возвращают.

### 5.8 Влияние call_analyses на подбор

Запрос rank **не делает** join на `call_analyses`. Итог звонка не меняет порядок текущей колоды.

Пометка «Созвон подтвердил домен» появляется при следующем открытии подборки, если `domain_hits_json` не пустой. Это текст на карточке, не слагаемое rank.

---

## 6. Генерация тестов (LLM bank)

### 6.1 Контракт

- `POST /api/assessment/generate` body: `{ specialization, grade, type: 'quick'|'work', count }`.
- Роль не `candidate`. В демо достаточно `DEMO_MODE=1` и заголовка `X-Demo-Admin: 1`.
- Нет `LLM_BASE_URL` → **501** `{ error: 'llm_not_configured' }`. Процесс не падает.

### 6.2 Промпт (шаблон в `llm-client.js`)

System: «Ты составитель рабочих задач для оценки разработчиков. Язык: русский. Верни JSON: prompt, rubric: { keys: [], workItems: [] }. Без секретов, без ссылок на внешние API keys.»

User: specialization, grade, type, ограничение длины quick ≤ 500 символов, work ≤ 2000.

### 6.3 Persist

Insert `tasks` status `draft`, origin `llm`, **без** form_key.

### 6.4 Публикация

- `POST /api/assessment/tasks/:id/publish` body `{ form_key: 'A'|'B' }` → `status=published`.
- В `battery/start` условие `status='published'`. Draft в батарею не попадает.

### 6.5 Ручной seed — primary path для жюри

LLM — дополнение; seed backend×middle A/B обязателен для validators.

---

## 7. Приглашения и приватность

### 7.1 POST invite

**400**, если нарушено любое правило: `salary_from` и `salary_to` — целые числа и `from <= to`; `offer_text` не пустой; `contact_channel` — непустая строка до 64 символов (свободный текст, не enum).

Новый инвайт при `availability=paused` → **409**. Уже отправленные приглашения кандидат принять может.

Несколько работодателей могут пригласить одного кандидата.

### 7.2 Accept

- status → accepted
- Employer GET candidate/contacts для **этого** invitation — phone, contact_email
- **Не** ставить availability paused
- **Не** отменять другие invitations

### 7.3 privacy.js

```javascript
function employerCandidateView(viewerEmployerId, candidate, invitation) {
  const base = { id, displayName, categoryLabel, stack, backgroundDomains, explanation, taskPhrases };
  if (invitation?.status === 'accepted' && invitation.employer_user_id === viewerEmployerId) {
    return { ...base, phone: candidate.phone, contact_email: candidate.contact_email };
  }
  return base;
}
```

Ни кандидат, ни работодатель не получают: `integrity`, `trust_ok`, `test_score`, `motivation`, `rank`, `attempt_events`, `call_analyses`, `transcript_text`. Контакты — только у работодателя с accepted-инвайтом именно к этому кандидату.

---

## 8. Видеозвонки и разбор

### 8.1 Доступ

- `GET /api/calls/for-invitation/:id` → 403 если invitation не accepted или user не участник.

### 8.2 Consent

Текст галочки, дословно: «Разговор сохранится и будет использован, чтобы оценить соответствие задаче.» Формулу скоринга на экране не объяснять.

- `POST /api/calls/:id/consent` body `{ accepted: true }`. Роль берётся из сессии, не из тела.
- Кнопка «Войти» в UI неактивна без галочки.
- `POST /api/calls/:id/start` без согласия **этой** стороны — **400**. В `live` звонок переходит, когда согласились оба.

### 8.3 WebRTC

- HTTP-сервер создаётся через `http.createServer(app)`, на него вешается `WebSocketServer`.
- Путь `/ws/calls/:callId`. На upgrade проверяется cookie сессии и участие в этом приглашении. Комната — два участника.
- Caddy `reverse_proxy` WebSocket уже пропускает, отдельный location не нужен.
- UI `/call/:invitationId`: видео 16:9, таймер, «Завершить».

### 8.4 Запись

- У каждой стороны свой `MediaRecorder`.
- `POST /api/calls/:id/recording` — multipart, поле `side` = `candidate|employer`, файл webm. Лимит этого маршрута 80 МБ. Общий `express.json` остаётся 256 КБ и запись не принимает.
- `callId` только UUID. Писать можно лишь в `/data/calls/{callId}/candidate.webm` или `employer.webm`.
- `recording_path` = каталог `/data/calls/{callId}`.
- Скачивание только участнику этого приглашения. Статикой из `/data` файлы не раздаются.

### 8.5 Transcript

- Client Web Speech API → `POST /api/calls/:id/transcript-chunk` `{ text, at }`
- Server append в `transcript_text` с пробелом
- Нет speech → transcript пустой, analysis note «нет реплик»

### 8.6 End и analyzeCall

- `POST /api/calls/:id/end` → status ended, ended_at
- Queue `analyzeCall(callId)`:
  - if LLM: prompt transcript + need.domain_text → summary 3 предложения рус
  - else: keyword match domain_text + duration + completed → шаблон 3 фразы
- Insert `call_analyses`
- Employer: `GET /api/calls/:id/analysis` → `{ summary_text }` only if ended

Запись: `GET /api/calls/:id/recording` stream с session check, не static public.

---

## 9. API (полный список для openapi.yaml)

| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | /api/health | public | |
| GET | /api/stats | public | counters landing |
| POST | /api/auth/register | public | |
| POST | /api/auth/confirm | public | code; demo 000000 |
| POST | /api/auth/login | public | session cookie |
| POST | /api/auth/logout | auth | |
| GET | /api/me | auth | |
| GET/PUT | /api/candidate/profile | candidate | |
| GET/POST/DELETE | /api/candidate/background | candidate | episodes |
| PUT | /api/candidate/availability | candidate | open/paused |
| POST | /api/assessment/battery/start | candidate | spec+grade |
| GET | /api/assessment/battery/current | candidate | |
| GET | /api/assessment/tasks/:attemptId | candidate | prompt only |
| PATCH | /api/assessment/tasks/:attemptId/draft | candidate | |
| POST | /api/assessment/tasks/:attemptId/submit | candidate | |
| POST | /api/assessment/events | candidate | telemetry batch |
| GET | /api/candidate/category | candidate | label + retake_at |
| GET | /api/candidate/invitations | candidate | |
| POST | /api/candidate/invitations/:id/accept | candidate | |
| POST | /api/candidate/invitations/:id/decline | candidate | |
| GET/PUT | /api/employer/profile | employer | |
| GET/POST/PUT | /api/employer/needs | employer | |
| GET | /api/employer/needs/:id/matches | employer | ranked |
| GET | /api/employer/needs/:id/deck/next | employer | one card |
| POST | /api/employer/needs/:id/reviews | employer | rejected или later |
| DELETE | /api/employer/needs/:id/reviews/:candidateId | employer | вернуть later в колоду |
| GET | /api/employer/needs/:id/deferred | employer | later |
| POST | /api/employer/invitations | employer | |
| GET | /api/employer/invitations | employer | |
| GET | /api/calls/for-invitation/:invitationId | both | |
| POST | /api/calls/:id/consent | both | |
| POST | /api/calls/:id/start | both | |
| POST | /api/calls/:id/end | both | |
| POST | /api/calls/:id/recording | both | multipart |
| POST | /api/calls/:id/transcript-chunk | both | |
| GET | /api/calls/:id/analysis | employer | ended only |
| GET | /api/calls/:id/recording | participant | stream, query `side` |
| POST | /api/assessment/generate | не candidate | 501 без LLM |
| POST | /api/assessment/tasks/:id/publish | не candidate | ставит form_key |

Страницы регистрируются в `server.js` до catch-all. Иначе `/call/:id` откроет лендинг.

Удалить stub `POST/GET /api/candidates` и `/api/invitations` в коммите matching, когда их заменят настоящие роуты.

---

## 10. UI маршруты

| URL | Файл | Описание |
|-----|------|----------|
| `/` | `public/index.html` | Лендинг |
| `/auth` | `public/auth.html` | Вход и регистрация |
| `/candidate/today` | `public/candidate/today.html` | Сегодня |
| `/candidate/past` | `public/candidate/past.html` | Прошлое |
| `/candidate/tasks` | `public/candidate/tasks.html` | Батарея |
| `/candidate/invitations` | `public/candidate/invitations.html` | Приглашения |
| `/candidate/calls` | `public/candidate/calls.html` | Звонки, без разбора и транскрипта |
| `/employer/need` | `public/employer/need.html` | Потребность |
| `/employer/deck` | `public/employer/deck.html` | Колода |
| `/employer/list` | `public/employer/list.html` | Тот же пул строками |
| `/employer/deferred` | `public/employer/deferred.html` | Отложенные |
| `/employer/invitations` | `public/employer/invitations.html` | Исходящие |
| `/employer/calls` | `public/employer/calls.html` | Звонки и 3 фразы разбора |
| `/call/:invitationId` | `public/call.html` | Комната |

Общий shell: шапка HandCheck, 5 пунктов, имя и выход. Колонка 880px. Карточка колоды до 640px по центру.

Лендинг, копирайт зафиксирован: заголовок «Категория по навыку. Приглашение с вилкой.» Шапка: Кандидатам, Работодателям, Войти, «Начать». Три шага: профиль и бэкграунд, короткие ответы и рабочая задача, приглашения от компаний. Счётчики категорий, открытых кандидатов и приглашений — живые. Если счётчик 0, на его месте демо-цифра с подписью «в демо», а не голый ноль.

`docs/design.md` в коммите 1 обязан содержать: ссылку на Mercor как композицию и замену палитры; что копируем и что не копируем; компоненты `.btn-primary`, `.btn-ghost`, `.stat`, `.row-link`, `.category-pill`, `.invite`, поля на card; состояния пустого списка, ошибки под полем, фокуса clay 2px; запрет градиентов, тяжёлых теней, фиолетового и числового бейджа; компоненты `.deck-card`, `.deck-actions`, `.call-room`; токены движения из §10.1. Шрифт `Inter, Segoe UI, sans-serif`.

### 10.1 Движение

Красота здесь в коротком и одном направлении, не в декоративной петле. Всё живёт в `app/public/styles.css`. Сторонние animation-библиотеки не подключать.

Токены:

```css
:root {
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --dur-fast: 160ms;
  --dur: 240ms;
  --dur-deck: 320ms;
}
```

Анимировать только `opacity` и `transform`. Не анимировать `height`, `margin`, `box-shadow`, `filter`, `background-image`.

| Место | Что происходит | Длительность |
|-------|----------------|--------------|
| Лендинг, заголовок | Один вход: `translateY(8px)` и opacity 0 → 1. Повторно при скролле не запускается | 240ms |
| Три числа | То же, каждое следующее на 40ms позже | 240ms |
| Строка списка и пункт меню | Hover меняет фон на card за 160ms. Карточка не «всплывает» тенью | 160ms |
| `.btn-primary` | Фон clay → clay-hover. Масштаб не больше 1 | 160ms |
| Ошибка поля | Текст ошибки проявляется на 4px снизу | 160ms |
| Pill категории | Только opacity | 160ms |
| Колода, уход карточки | Жест задаёт направление: отказ — влево на 72px, отложить — вниз на 48px, пригласить — вправо на 72px, одновременно opacity → 0 | 320ms |
| Колода, следующая карточка | Входит с `translateY(12px)` и opacity 0, встаёт на место | 240ms |
| Лист вилки | Поднимается на 16px и проявляется | 240ms |
| Смена раздела кабинета | Колонка контента: 8px и opacity | 200ms |
| Комната звонка | Видео проявляется, когда пришёл поток. Таймер не мигает. Точка записи — статичный кружок clay, без пульса | 240ms |

Запрещено: bounce, elastic, бесконечный pulse, parallax, смена градиента, confetti, skeleton-шиммер, blur, масштаб кнопки, анимированная тень.

`prefers-reduced-motion: reduce` обнуляет длительности переходов и анимаций до практически нуля. Фокус clay 2px остаётся. Смысл жеста колоды не пропадает: карточка сразу сменяется следующей.

### 10.2 Где живёт состояние экрана

Правило одно: ссылка, которой можно поделиться, важнее памяти вкладки, память вкладки важнее привычки устройства, привычка важнее пустого значения по умолчанию. Запись на сервере важнее черновика в браузере. То, что можно вычислить из ответа API, отдельно не хранится.

| Что видит человек | Куда кладётся | Как ведёт себя F5 и ссылка |
|-------------------|---------------|----------------------------|
| Колода или список | Сам адрес: `/employer/deck` и `/employer/list` | Обновление и новая вкладка открывают тот же вид |
| Фильтр стека и ФСП | Query `?stack=` и `?fsp=1` или `?fsp=0` на обоих адресах | Ссылка с query сужает выдачу. Адрес без query снова показывает полный порядок. Фильтр не записывается в потребность |
| Какая карточка сейчас в колоде | Сервер: следующий кандидат без `rejected` и без `later` | Обновление показывает ту же следующую карточку. Идентификатор человека в адрес не кладётся |
| Текст оффера и вилка, пока лист открыт | Только память страницы | Обновление закрывает лист. Ответ 400 оставляет введённые числа и текст на месте |
| Ответ QuickProbe и WorkSim | Сервер, `PATCH .../draft` | WorkSim шлёт черновик каждые 10 секунд и по blur. QuickProbe шлёт по blur. Обновление возвращает текст с сервера и тот же открытый пункт батареи |
| Кусок текста, который ещё не подтвердил сервер | `localStorage`, ключ `handcheck:draft:v1:{attemptId}`, срок 2 часа | Если в ключе есть текст новее серверного, показывается фраза «Черновик восстановлен», затем снова уходит на сервер. При ошибке записи в браузере черновик остаётся только в памяти страницы |
| Профиль, эпизод, потребность | Сервер | Кнопка сохранения неактивна, пока поля не отличаются от последнего ответа сервера. Ошибка сети не очищает поля |
| Галочка согласия на запись | Память, пока нет `consent_at` на сервере | Если согласие уже записано, галочка показана включённой и «Войти» активно. Локально «как будто согласился» без ответа сервера не запоминается |
| Прокрутка списка | Память вкладки и `history.state` | Назад из комнаты звонка или листа возвращает место в списке. Новый щелчок по пункту меню открывает список сверху |
| Наведение, загрузка, прогресс анимации, открытый лист | Память на время жеста | После обновления этого нет |

Навигация кабинета на всех страницах одна, текущий пункт читается из адреса. Пустой список, строка «Загрузка» и текст ошибки — три разных состояния. Шиммер вместо загрузки не использовать: он спорит с запретом бесконечного движения.

Отказ и отложение в колоде остаются одним нажатием, без дополнительного окна. Удаление своего эпизода спрашивает подтверждение фразой «Эпизод исчезнет из подбора». Пока запрос идёт, неактивна только нажатая кнопка. Закрытие листа вилки: клавиша Escape и щелчок вне листа. Поля почты и пароля подписаны и имеют `autocomplete`.

Страница неизвестного адреса — тот же бумажный фон и ссылка на главную, не стандартная страница сервера.

---

## 11. Тестирование и validators

### 11.1 npm scripts

```json
"validate:assessment": "node scripts/validate-assessment.js",
"validate:matching": "node scripts/validate-matching.js",
"validate:privacy": "node scripts/validate-privacy.js",
"validate": "npm run validate:assessment && npm run validate:matching && npm run validate:privacy",
"test": "node --test test/*.test.js"
```

Validators работают по `DB_PATH=./data/handcheck-dev.sqlite`: migrate + seed во временную копию. Наружу порт не слушают. HTTP-кейсы гоняют через supertest на `createApp()`, без `listen`.

### 11.2 validate-assessment.js — кейсы

| # | Assert |
|---|--------|
| A1 | Формы A/B backend×middle на canonical answer: \|Δ(knowledge+breadth)\| < 0.15 |
| A2 | Weak answer: test_score < middle cutoff 0.68 |
| A3 | Strong answer: test_score ≥ 0.68 |
| A4 | API shape mock: submit response без score fields |

### 11.3 validate-matching.js — кейсы

| # | Assert |
|---|--------|
| M1 | При равных test_score и motivation Анна выше Бориса на потребности кафе |
| M2 | Кандидат не категории backend × middle в выдачу не входит |
| M3 | trust_ok=0 не входит |
| M4 | rejected пропадает из deck и invitation не создаётся |
| M5 | later не создаёт invitation и виден в deferred; DELETE возвращает в колоду |
| M6 | explanation не содержит цифр |

### 11.4 validate-privacy.js — кейсы

| # | Assert |
|---|--------|
| P1 | Employer JSON до accept: phone/contact_email absent |
| P2 | После accept: present |
| P3 | Два инвайта Анне; accept первого не удаляет второй и не ставит paused |
| P4 | Ответы кандидата без integrity, events, test_score, call_analyses, transcript_text |
| P5 | Call room 403 before accept |
| P6 | Start call 400 without consent |

### 11.5 Unit tests (node:test)

- `rubric-score.test.js` — normalization, key hit ratio
- `domain-boost.test.js` — «официанта» и HoReCa дают boost, пустой эпизод даёт 0
- `privacy.test.js` — redaction matrix

### 11.6 Ручной UAT (прод)

1. https://handcheck.baski.pro/api/health → 200  
2. Demo login anna / cafe employer  
3. Deck → invite Anna → accept → call with consent → employer sees summary, Anna not  
4. UI: clay buttons, no numeric rating, no photo in deck  

### 11.7 Цикл проверки движения

После того как экраны коммита 6 открываются локально, движение проверяется циклом, а не одним скриншотом. Сервер: `npm start`, адрес `http://127.0.0.1:8810`. Браузер — встроенный. Отдельный Playwright не заводить.

Раунд, не больше четырёх. Выход раньше, когда все пункты ниже пройдены. Если после четвёртого раунда пункт всё ещё красный, остановиться и записать разрыв. Новое украшение в этом случае не придумывать.

На каждом раунде:

1. Поправить только CSS и разметку жеста, который провалился.
2. Пройти таблицу в обычном режиме и с эмуляцией `prefers-reduced-motion: reduce`.
3. Снять экран в покое и после жеста. Середину перехода смотреть через длительность и имя анимации в вычисленных стилях, не на глаз по одному кадру.
4. Записать результат в `docs/ui-motion-loop.md`: номер раунда, пункт, pass или fail, что именно видно.

| # | Проверка | Fail, если |
|---|----------|------------|
| U1 | Лендинг `/` | Заголовок крутится или пульсирует после первого входа |
| U2 | Кнопка «Начать» | Меняется тень, масштаб или градиент |
| U3 | `/employer/deck` | Отказ, отложение и приглашение уводят карточку не в свою сторону или следующая не появляется |
| U4 | Лист вилки | Выезжает дольше 400ms или сдвигает шапку |
| U5 | Любой экран | В вычисленном фоне есть gradient, у элемента растёт box-shadow во время перехода |
| U6 | Reduced motion | После жеста колоды остаются ненулевые анимации длиннее 20ms |
| U7 | Колода и итог теста | На время движения появляется числовой балл или фото |
| U8 | Ширина 1280 и 390 | Уходящая карточка не выталкивает страницу горизонтальным скроллом |
| U9 | `/call/:invitationId` до галочки | «Войти» неактивна, точка записи не пульсирует |

Когда U1–U9 pass, один прогон frontend-qa в режиме smoke по `/`, `/employer/deck` и комнате звонка. Цикл закрыт, только если smoke тоже PASS. Результат smoke дописывается в тот же `docs/ui-motion-loop.md`.

Файл отчёта создаётся во время прогона, не заранее. В git он попадает вместе с коммитом 6, если цикл уже зелёный.

### 11.8 Проверка устойчивости экранов

В том же локальном браузере, после U1–U9. Четыре контракта: обновление, ссылка в новой вкладке, кнопка «Назад», полная перезагрузка.

| # | Шаги | Pass |
|---|------|------|
| D1 | Открыть `/employer/list?stack=node&fsp=1`, обновить страницу | Те же фильтры. Адрес без query возвращает полный список в исходном порядке |
| D2 | Скопировать этот адрес во вторую вкладку | Та же урезанная выдача, состав потребности в базе не изменился |
| D3 | Прокрутить список, открыть лист вилки, нажать Escape, затем «Назад» | Место прокрутки на месте. Повторный вход через пункт меню «Колода» начинается сверху |
| D4 | Открыть лист вилки и обновить страницу | Лист закрыт, черновик оффера не всплывает сам |
| D5 | Вписать ответ WorkSim, дождаться черновика, обновить страницу | Текст на месте. Фраза «Черновик восстановлен» есть только если сервер ещё не успел принять последний кусок |
| D6 | Отправить вилку с `salary_from` больше `salary_to` | Поля остаются заполненными, под ними текст ошибки |
| D7 | Войти в комнату звонка без галочки и обновить страницу | «Войти» снова неактивна, пока сервер не записал согласие |

Результат дописывается в `docs/ui-motion-loop.md` тем же прогоном. Коммит 6 не считается готовым, пока D1–D7 тоже pass.

## 12. Порядок коммитов (6 шагов на main)

1. **docs:** design.md, UX.md, sync TZ/ARCHITECTURE/DATA-MODEL/VALIDATION/AGENTS + этот план  
2. **feat:** db schema migrate seed, config, auth email confirm, profiles, background  
3. **feat:** assessment battery, rubric, telemetry, category, candidate_private  
4. **feat:** matching, domain_boost, deck reviews, invitations, privacy  
5. **feat:** calls ws, recording, transcript, analyzeCall  
6. **feat:** UI кабинетов, колода, комната, `openapi.yaml`, validators. Volume и `.env.example` появляются раньше, в коммите 2, иначе SQLite на сервере некуда писать.

Чистые `node:test` для rubric, domain-boost и privacy можно класть в тот коммит, где появляется функция. Скрипты `validate:*` — только в коммите 6, как в порядке поставки. UI кабинетов, колоды и комнаты — тоже коммит 6. В коммите 1 остаётся палитра и лендинг: фаза A требует токены сразу.

---

## 13. Задачи реализации (чеклист для агента)

### Commit 1 — docs + design tokens

- [x] Создать `docs/design.md` (Mercor ref, tokens, components, deck, call-room)
- [x] Создать `docs/UX.md` (экраны кабинетов, копирайт)
- [x] Обновить `docs/ARCHITECTURE.md` под rev.5 (calls, deck, tasks table)
- [x] Обновить `docs/DATA-MODEL.md` (все таблицы rev.5)
- [x] Обновить `docs/VALIDATION.md` (таблицы кейсов G)
- [x] Обновить `docs/TZ.md` (ссылки UX + design)
- [x] Обновить `AGENTS.md` (запреты rev.5)
- [x] Переписать `app/public/styles.css` на CSS variables палитры и токены движения §10.1
- [x] В `design.md` записать таблицу жестов и запрет бесконечных анимаций
- [x] Переверстать `index.html`, заготовки candidate/employer под shell

### Commit 2 — db + auth + profiles

- [x] `npm i better-sqlite3 bcryptjs`
- [x] `app/config.js` — env defaults
- [x] `app/db/schema.sql` + migrate.js + seed.js (Anna, Boris, cafe)
- [x] `modules/auth/router.js` — register, confirm, login, logout
- [x] `middleware/auth.js` — session, requireConfirmedEmail, requireRole
- [x] `modules/candidates/router.js` — profile, background CRUD, availability
- [x] `modules/employers/router.js` — profile
- [x] `server.js` — mount, run migrate, remove dependence on in-memory for auth
- [x] `.env.example`; compose: volume `/data`, `DEMO_MODE=1`, образ `node:20-bookworm-slim`
- [x] Если `SESSION_SECRET` пуст, создать `/data/session.secret` при старте и не писать его в git
- [x] Smoke: register → confirm → GET /api/me

### Commit 3 — assessment

- [x] `lib/rubric-score.js`, `motivation.js`, `integrity.js`
- [x] `modules/assessment/router.js` — start battery, draft, submit, events
- [x] `lib/task-phrases.js`
- [x] Seed: 4 quick + 1 work на формы A и B, test_score Анны = test_score Бориса
- [x] `test/rubric-score.test.js`

### Commit 4 — matching + deck + invitations

- [x] `lib/ranking.js`, `domain-boost.js`, `privacy.js`
- [x] `modules/needs/router.js`, `matching/router.js`, `deck/router.js`, `invitations/router.js`
- [x] `test/domain-boost.test.js`, `test/privacy.test.js`
- [x] Удалить in-memory stub `/api/candidates` и `/api/invitations`

### Commit 5 — calls

- [x] `npm i ws`
- [x] `modules/calls/router.js`, `signaling.js`, `analyze-call.js`
- [x] `server.js` — attach WebSocketServer
- [x] Запись двумя файлами, signaling с проверкой сессии на upgrade

### Commit 6 — polish

- [x] Кабинеты, колода, список, комната по URL из §10, жесты колоды и комнаты из §10.1
- [x] Прогнать цикл §11.7 до pass U1–U9 и smoke, затем D1–D7 из §11.8. Отчёт `docs/ui-motion-loop.md`
- [x] `openapi.yaml` по фактическим роутам
- [x] `scripts/validate-assessment.js`, `validate-matching.js`, `validate-privacy.js`
- [x] `modules/stats/router.js`: живые счётчики, ноль подписывается «в демо»
- [x] `POST /api/assessment/generate` и publish
- [x] README, затем UAT в браузере и `GET /api/health` на проде

---

## 14. Конфиг (.env.example)

```env
PORT=8810
DB_PATH=/data/handcheck.sqlite
SESSION_SECRET=
GRADE_COOLDOWN_DAYS=90
APP_BASE_URL=http://127.0.0.1:8810
DEMO_MODE=1
DEMO_PASSWORD=demo-demo-demo
LLM_BASE_URL=
LLM_API_KEY=
SMTP_URL=
```

`SESSION_SECRET` в примере пустой. На сервере секрет появляется в volume, не в репозитории. `DEMO_PASSWORD` в примере нужен: им пользуются seed-аккаунты.

---

## 15. Критерий «готово» (демо-сценарий)

- [x] Anna: категория Backend × Middle, эпизод официант, availability open  
- [x] Employer cafe: need «автоматизация работы официанта», колода показывает Anna без фото, Boris отложен  
- [x] Invite Anna с вилкой ₽, Anna accept — контакты только cafe  
- [x] Два инвайта Анне от разных работодателей: accept одного не удаляет второй и не ставит paused  
- [x] Звонок: оба consent → live → end → webm + transcript на диске → employer 3 фразы analysis  
- [x] Anna не видит analysis  
- [x] Интерфейс paper/clay/forest, Inter, без indigo и без числового рейтинга  
- [x] Цикл движения §11.7 закрыт: U1–U9 и smoke pass, в том числе reduced motion  
- [x] Экраны держат состояние по §10.2: D1–D7 pass  
- [x] `npm run validate` pass локально  
- [ ] `/api/health` 200 на https://handcheck.baski.pro  

---

## 16. Self-review (spec coverage)

| Требование rev.5 | Раздел плана |
|------------------|--------------|
| design.md + tokens + лендинг | §10, commit 1 |
| Движение и цикл U1–U9 | §10.1, §11.7, commit 6 |
| Состояние экранов: URL, сервер, память | §10.2, §11.8 |
| Батарея 4+1, cutoff, cooldown специализации | §4.1–4.2 |
| Telemetry скрыта, integrity из трёх сигналов | §4.4, §7.3 |
| Rank и domain_boost с леммами | §5 |
| Колода без фото, later/rejected | §5.7 |
| Мультиинвайт без paused | §7 |
| Два webm, consent, analysis только работодателю | §8 |
| `POST /api/assessment/generate` → draft | §6 |
| Validators, включая M5 и P3 | §11 |
| createApp без listen в тестах | Global Constraints |

---

*Документ синхронизирован с делегированием Grok Bot rev.5. Исполнение — по §12–13, одна фаза за раз.*
