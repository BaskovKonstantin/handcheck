# HandCheck — модель данных (MVP)

SQLite. Имена таблиц — snake_case. UUID или `prefix_timestamp` id допустимы; предпочтительно UUID v4.

## users
| Поле | Тип | Notes |
|------|-----|-------|
| id | TEXT PK | |
| email | TEXT UNIQUE | |
| email_confirmed_at | TEXT NULL | ISO |
| role | TEXT | `candidate` \| `employer` |
| password_hash | TEXT NULL | или magic-link only |
| created_at | TEXT | |

## sessions / auth_tokens
Одноразовые коды подтверждения email и сессии. Не логировать токены.

## candidate_profiles
| Поле | Тип | Notes |
|------|-----|-------|
| user_id | TEXT PK FK | |
| display_name | TEXT | |
| headline | TEXT | |
| stack_json | TEXT | JSON array |
| phone | TEXT NULL | **sensitive** |
| contact_email | TEXT NULL | **sensitive**; default = users.email |
| privacy_json | TEXT | что видно до invite |
| fsp_id | TEXT NULL | stub |
| consent_at | TEXT NULL | |

## employer_profiles
| Поле | Тип | Notes |
|------|-----|-------|
| user_id | TEXT PK FK | |
| company_name | TEXT | |
| description | TEXT | |
| industry | TEXT | |
| contact_email | TEXT | |

## specializations / grades
Справочники seed. `categories` = декартово или явная таблица `category_id`, `specialization`, `grade`, `label`.

## assessment_forms
| Поле | Тип | Notes |
|------|-----|-------|
| id | TEXT PK | |
| specialization | TEXT | |
| grade | TEXT | |
| form_key | TEXT | `A`/`B`/… параллельные формы |
| items_json | TEXT | задания + ключи/рубрика |
| pass_score | REAL | cutoff 0..1 |

Уникальность: `(specialization, grade, form_key)`.

## assessment_attempts
| Поле | Тип | Notes |
|------|-----|-------|
| id | TEXT PK | |
| candidate_user_id | TEXT | |
| form_id | TEXT | |
| claimed_grade | TEXT | |
| specialization | TEXT | |
| answers_json | TEXT | |
| score | REAL NULL | |
| passed | INTEGER NULL | 0/1 |
| started_at / submitted_at | TEXT | |

## candidate_categories
Текущая видимая категория (после успешного теста).

| Поле | Тип | Notes |
|------|-----|-------|
| candidate_user_id | TEXT PK | |
| category_id | TEXT | |
| specialization | TEXT | |
| grade | TEXT | |
| test_score | REAL | для ранжирования |
| assigned_at | TEXT | |
| grade_changed_at | TEXT | для cooldown |

## fsp_achievements
| Поле | Тип | Notes |
|------|-----|-------|
| id | TEXT PK | |
| candidate_user_id | TEXT | |
| title | TEXT | |
| kind | TEXT | contest/event/… |
| year | INTEGER NULL | |
| evidence_note | TEXT | stub |

Пустой набор = валидный кейс «нет истории ФСП».

## employer_needs
| Поле | Тип | Notes |
|------|-----|-------|
| id | TEXT PK | |
| employer_user_id | TEXT | |
| title | TEXT | |
| specialization | TEXT NULL | |
| grade | TEXT NULL | |
| stack_json | TEXT | |
| notes | TEXT | |
| active | INTEGER | |
| created_at | TEXT | |

## invitations
| Поле | Тип | Notes |
|------|-----|-------|
| id | TEXT PK | |
| employer_user_id | TEXT | |
| candidate_user_id | TEXT | |
| need_id | TEXT NULL | |
| company_name | TEXT | snapshot |
| offer_text | TEXT | |
| salary_from | INTEGER | ₽, required |
| salary_to | INTEGER | ₽, required |
| status | TEXT | sent/viewed/accepted/declined |
| created_at / updated_at | TEXT | |

Инвариант: `salary_from <= salary_to`, оба > 0.

## vacancies / applications (Phase 5)
Только если Phase 3 готов. У vacancy тоже `salary_from`/`salary_to`.

---

## Правила видимости (код + SQL)

Функция `publicCandidateView(viewer, candidate)`:

- viewer = сам кандидат → всё своё
- viewer = employer и **нет** accepted invite / application → без phone/contact_email; можно display_name по privacy, category, stack, test_score band, fsp flag
- viewer = employer и есть accepted → контакты открыты

API работодателя **никогда** не должен отдавать сырой JOIN на contacts без этой проверки.
