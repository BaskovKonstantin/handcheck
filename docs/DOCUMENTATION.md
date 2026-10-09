# Документация HandCheck

Индекс документов проекта. Требования ТЗ: «ссылка на документацию проекта в формате doc/pdf».

## Обязательное по ТЗ

| Требование ТЗ | Документ |
|---|---|
| Функциональная и компонентная архитектура | [ARCHITECTURE.md](./ARCHITECTURE.md) — разделы «Функциональная архитектура» и «Компонентная архитектура» |
| Механика тестирования и обоснование устойчивости | [TESTING.md](./TESTING.md) |
| Механика подбора и логика категоризации | [MATCHING.md](./MATCHING.md) |
| Собственная процедура валидации и результаты | [VALIDATION.md](./VALIDATION.md) + [context/metrics-assessment.json](../context/metrics-assessment.json) |
| Схема интеграции с реестром ФСП | [FSP-INTEGRATION.md](./FSP-INTEGRATION.md) |
| Описание API | [API.md](./API.md) + [openapi.yaml](../openapi.yaml) |
| Использованные библиотеки и их версии | [DEPLOYMENT.md](./DEPLOYMENT.md), раздел «Библиотеки и версии» |
| Пошаговая инструкция сборки, развёртывания и локального запуска | [DEPLOYMENT.md](./DEPLOYMENT.md) |

## Прочее

| Документ | О чём |
|---|---|
| [TZ.md](./TZ.md) | сжатое ТЗ ФСП |
| [presentation/ТЗ-ФСП-2026.txt](./presentation/ТЗ-ФСП-2026.txt) | полный текст ТЗ из PDF ФСП 2026 |
| [FUNCTIONAL-COVERAGE.md](./FUNCTIONAL-COVERAGE.md) | покрытие ТЗ по пунктам: что сделано, чем подтверждено, чего нет |
| [PRESENTATION.md](./PRESENTATION.md) | текст презентации и ответы на вопросы жюри |
| [presentation/HandCheck-ФСП-2026.pptx](./presentation/HandCheck-ФСП-2026.pptx) | презентация в официальном шаблоне ФСП |
| [presentation/HandCheck-ФСП-2026.pdf](./presentation/HandCheck-ФСП-2026.pdf) | та же презентация в PDF |
| [DATA-MODEL.md](./DATA-MODEL.md) | таблицы и приватность |
| [UX.md](./UX.md) | маршруты и тексты интерфейса |
| [MCP.md](./MCP.md) | MCP-интеграция для ИИ-клиентов |
| [JURY-DEMO.md](./JURY-DEMO.md) | клик-маршрут демонстрации жюри |
| [IMPLEMENTATION-PLAN-rev5.md](./IMPLEMENTATION-PLAN-rev5.md) | каноническая спецификация rev.5 |
| [../README.md](../README.md) | быстрый старт и ссылки |
| [../context/audits/](../context/audits) | отчёты функционального аудита |

## Как поддерживать документацию

```bash
python3 scripts/build-documentation-pdf.py        # все docs/*.md → docs/Documentation-HandCheck.pdf
node scripts/functional-audit.js                   # отчёты в context/audits/
METRICS_JSON=context/metrics-assessment.json node scripts/assessment-metrics.js
```

Сводный PDF собирается из 13 разделов в порядке: индекс → покрытие ТЗ → ТЗ → архитектура →
тестирование → подбор → валидация → интеграция ФСП → API → модель данных → деплой → MCP → демо.

## Ссылки для жюри (в репозитории)

| Что | Файл в репозитории |
|---|---|
| Индекс документации | [docs/DOCUMENTATION.md](./DOCUMENTATION.md) |
| Сводная документация одним файлом | [docs/Documentation-HandCheck.pdf](./Documentation-HandCheck.pdf) |
| Презентация (PDF / PPTX) | [docs/presentation/HandCheck-ФСП-2026.pdf](./presentation/HandCheck-ФСП-2026.pdf) · [pptx](./presentation/HandCheck-ФСП-2026.pptx) |
| Короткая презентация (13 слайдов) | [docs/presentation/HandCheck-overview.pdf](./presentation/HandCheck-overview.pdf) |
| Полный текст ТЗ ФСП | [docs/presentation/ТЗ-ФСП-2026.txt](./presentation/ТЗ-ФСП-2026.txt) |
| Скриншоты интерфейса | [handcheck-ui/presentation/](../handcheck-ui/presentation) |

## Ссылки для жюри

| Что | Ссылка |
|---|---|
| Развёрнутый прототип | https://handcheck.baski.pro |
| Репозиторий | https://github.com/BaskovKonstantin/handcheck |
| Презентация | `docs/presentation/HandCheck-ФСП-2026.pptx` / `.pdf` |
| Документация | этот раздел и файлы выше |
| Демо-вход | `cafe@demo.local` (работодатель), `anna@demo.local`, `boris@demo.local` (кандидаты), код подтверждения `000000` |