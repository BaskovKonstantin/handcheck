# HandCheck — процедура валидации (для сдачи)

ТЗ требует собственную оценку качества теста и подбора + описание в документации.

## Что измеряем на seed-данных

### Assessment
1. **Cutoff sanity** — junior-форма: seed junior-кандидат pass ≥ 80%; senior answers на junior pass; senior-форма: junior fail ≥ 80%.
2. **Form equivalence** — формы A/B одной ячейки: средний score на одном пуле ответов отличается < 0.15.
3. **Leakage resistance (proxy)** — доля уникальных form_key выдач при 50 `start` подряд ≥ 2 keys.

Скрипт (добавить в Phase 4): `npm run validate:assessment`.

### Matching
1. Need `backend×middle` → в top-5 только `backend × middle` (или явно соседние, если так задокументировано).
2. Кандидат с большим `test_score` выше при равной категории.
3. Кандидат с FSP stub выше при равном score (если `RANK_W_FSP > 0`).
4. До accept в JSON matches **нет** полей phone/contact_email.

Скрипт: `npm run validate:matching`.

### Privacy
Автотест: invite sent → employer GET candidate → contacts null; accept → contacts present.

## Что писать в отчёт сдачи
- Размер seed (N кандидатов, M needs)
- Таблица метрик + команда запуска
- Ограничения (синтетика, не продакшен-IRT)

Не заявлять «точность 99%» без цифр из скриптов.
