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

## Ссылки для жюри

| Что | Ссылка |
|---|---|
| Развёрнутый прототип | https://handcheck.baski.pro |
| Репозиторий | https://github.com/BaskovKonstantin/handcheck |
| Презентация | `docs/presentation/HandCheck-ФСП-2026.pptx` / `.pdf` |
| Документация | этот раздел и файлы выше |
| Демо-вход | `cafe@demo.local` (работодатель), `anna@demo.local`, `boris@demo.local` (кандидаты), код подтверждения `000000` |