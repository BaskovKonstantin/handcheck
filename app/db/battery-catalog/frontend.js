"use strict";

const frontendJunior = {
  quick: [
    {
      promptA: "Чем семантическая разметка HTML помогает доступности и SEO на лендинге?",
      promptB: "Какие теги header, main, nav вы используете вместо div-«супа»?",
      keys: [["семант", "html", "доступ", "seo"]],
      breadthKeys: [["aria", "заголов"]],
    },
    {
      promptA: "Как вы центрируете блок по горизонтали и вертикали с flexbox?",
      promptB: "Объясните justify-content и align-items на примере карточки в модалке.",
      keys: [["flex", "justify", "align", "центр"]],
      breadthKeys: [["css", "контейнер"]],
    },
    {
      promptA: "Как повесить обработчик клика на кнопку без inline onclick в HTML?",
      promptB: "Покажите addEventListener и почему не стоит смешивать разметку и логику.",
      keys: [["addEventListener", "клик", "dom", "кнопк"]],
      breadthKeys: [["js", "обработ"]],
    },
    {
      promptA: "Как выполнить fetch GET к API и отобразить JSON в списке на странице?",
      promptB: "Опишите async/await, проверку response.ok и обработку ошибки сети.",
      keys: [["fetch", "json", "async", "await"]],
      breadthKeys: [["список", "рендер"]],
    },
    {
      promptA: "Зачем нужен alt у img и как вы формулируете текст для декоративных картинок?",
      promptB: "Пример доступной формы: label, связь с input, сообщение об ошибке.",
      keys: [["alt", "label", "доступ", "input"]],
      breadthKeys: [["aria", "форм"]],
    },
    {
      promptA: "Что такое box model: margin, border, padding, content?",
      promptB: "Как box-sizing border-box упрощает вёрстку сетки карточек?",
      keys: [["margin", "padding", "border", "box"]],
      breadthKeys: [["css", "ширин"]],
    },
    {
      promptA: "Как вы структурируете CSS: классы, БЭМ или модули — что выберете для маленького проекта?",
      promptB: "Как избежать конфликта имён стилей при росте страниц?",
      keys: [["css", "класс", "бэм", "модул"]],
      breadthKeys: [["имен", "стил"]],
    },
    {
      promptA: "Как отладить проблему «не применился стиль» в DevTools?",
      promptB: "Шаги: вкладка Elements, Computed, специфичность селектора, каскад.",
      keys: [["devtools", "селектор", "специфич", "computed"]],
      breadthKeys: [["каскад", "стил"]],
    },
  ],
  work: {
    promptA:
      "Мини-проект: адаптивная страница каталога (мобильный/десктоп), fetch к публичному API, фильтр и состояние загрузки/ошибки.",
    promptB:
      "За неделю сверстайте каталог товаров: сетка, фильтр по категории, запрос к API, скелетон и сообщение об ошибке.",
    rubric: {
      keys: [["адаптив", "flex", "grid", "медиа"], ["fetch", "api", "json", "ошиб"]],
      breadthKeys: [["доступ", "семант"]],
      workItems: [
        { id: "layout", phrases: ["mobile", "мобил", "брейкпоинт", "viewport"] },
        { id: "state", phrases: ["загруз", "скелет", "спиннер", "ошиб"] },
      ],
      minLength: 180,
    },
  },
};

const frontendMiddle = {
  quick: [
    {
      promptA: "Как вы управляете состоянием формы с несколькими полями: локальный state vs form library?",
      promptB: "Когда подключите React Hook Form / аналог и что останется в компоненте?",
      keys: [["state", "форма", "хук", "контрол"]],
      breadthKeys: [["валидац", "ошиб"]],
    },
    {
      promptA: "Какие приёмы уменьшают лишние ре-рендеры в React-приложении?",
      promptB: "Объясните useMemo, useCallback, React.memo — когда они реально нужны.",
      keys: [["рендер", "memo", "usememo", "usecallback"]],
      breadthKeys: [["профил", "оптимиз"]],
    },
    {
      promptA: "Как организуете загрузку данных: React Query / SWR vs ручной useEffect?",
      promptB: "Кэш, stale time, refetch on focus — что настроите для списка заказов?",
      keys: [["react query", "swr", "кэш", "stale"]],
      breadthKeys: [["useeffect", "fetch"]],
    },
    {
      promptA: "Как настроите TypeScript для API-ответов: типы DTO, unknown vs any?",
      promptB: "Пример: парсинг JSON с проверкой полей перед использованием в UI.",
      keys: [["typescript", "тип", "dto", "unknown"]],
      breadthKeys: [["any", "интерфейс"]],
    },
    {
      promptA: "Что такое code splitting и lazy routes в Vite/Webpack?",
      promptB: "Как уменьшить initial bundle для кабинета с тяжёлыми графиками?",
      keys: [["split", "lazy", "chunk", "bundle"]],
      breadthKeys: [["vite", "webpack", "динамич"]],
    },
    {
      promptA: "Как тестируете компонент с пользовательским сценарием (Testing Library)?",
      promptB: "Пример теста: клик по кнопке отправки и появление сообщения об успехе.",
      keys: [["testing library", "тест", "рендер", "клик"]],
      breadthKeys: [["jest", "vitest", "сценари"]],
    },
    {
      promptA: "Как обрабатываете ошибки API в UI: toast, inline, retry?",
      promptB: "Разделение ошибок 4xx и 5xx для формы логина — что покажете пользователю?",
      keys: [["toast", "ошиб", "retry", "4xx"]],
      breadthKeys: [["5xx", "сообщ"]],
    },
    {
      promptA: "Как вы строите дизайн-токены (цвета, отступы) в CSS variables для темы?",
      promptB: "Связь с макетом Figma: scale отступов, тёмная тема через prefers-color-scheme.",
      keys: [["токен", "перемен", "тема", "css"]],
      breadthKeys: [["figma", "отступ"]],
    },
  ],
  work: {
    promptA:
      "Недельный проект: SPA кабинета кандидата — маршруты, форма профиля, список с пагинацией, оптимизация bundle и базовые тесты.",
    promptB:
      "Соберите фронт кабинета: роутинг, интеграция с REST, состояние загрузки, a11y формы и README с архитектурой папок.",
    rubric: {
      keys: [["роут", "spa", "react", "api"], ["тест", "bundle", "lazy"]],
      breadthKeys: [["typescript", "доступ"]],
      workItems: [
        { id: "routing", phrases: ["router", "маршрут", "страниц"] },
        { id: "quality", phrases: ["a11y", "доступ", "eslint", "ci"] },
      ],
      minLength: 200,
    },
  },
};

const frontendSenior = {
  quick: [
    {
      promptA: "Как вы выбираете между SSR, SSG и CSR для маркетингового сайта и личного кабинета?",
      promptB: "Trade-off Next.js SSR vs статика: TTFB, SEO, сложность деплоя.",
      keys: [["ssr", "ssg", "csr", "next"]],
      breadthKeys: [["seo", "ttfb", "гидрат"]],
    },
    {
      promptA: "Стратегия микрофронтендов: module federation, iframe, single-spa — критерии выбора.",
      promptB: "Как версионировать общие UI-kit и не ломать команды-потребители?",
      keys: [["микрофронт", "federation", "single", "верси"]],
      breadthKeys: [["ui-kit", "команд"]],
    },
    {
      promptA: "Как проектируете design system: токены, компоненты, документация Storybook?",
      promptB: "Governance: кто апрувит breaking change в кнопке, как мигрируете продукты?",
      keys: [["design system", "storybook", "токен", "компонент"]],
      breadthKeys: [["breaking", "миграц"]],
    },
    {
      promptA: "Как измеряете и улучшаете Core Web Vitals на проде (LCP, INP, CLS)?",
      promptB: "Инструменты: RUM, Lighthouse CI, бюджет перформанса в PR.",
      keys: [["lcp", "inp", "cls", "web vitals"]],
      breadthKeys: [["rum", "lighthouse", "бюджет"]],
    },
    {
      promptA: "Безопасность фронта: XSS, CSP, хранение токенов — ваши правила.",
      promptB: "Почему не кладёте refresh token в localStorage и как настроите CSP?",
      keys: [["xss", "csp", "токен", "cookie"]],
      breadthKeys: [["httpOnly", "sanitize"]],
    },
    {
      promptA: "Как организуете feature flags и постепенный rollout UI-фич?",
      promptB: "Связь с backend flags, kill switch, наблюдаемость ошибок после релиза.",
      keys: [["feature flag", "rollout", "kill", "флаг"]],
      breadthKeys: [["метрик", "релиз"]],
    },
    {
      promptA: "Архитектура состояния в большом приложении: нормализация, селекторы, границы сторов.",
      promptB: "Когда Redux/Zustand избыточен и достаточно server state + URL state?",
      keys: [["redux", "zustand", "нормализ", "селектор"]],
      breadthKeys: [["url", "server state"]],
    },
    {
      promptA: "Как ведёте техдолг фронта: eslint rules, codemods, deprecation policy?",
      promptB: "Пример миграции с legacy jQuery виджета на React без big-bang релиза.",
      keys: [["техдолг", "eslint", "codemod", "миграц"]],
      breadthKeys: [["legacy", "jquery", "react"]],
    },
  ],
  work: {
    promptA:
      "Недельный проект: архитектурное предложение для платформы с 5 продуктами — design system, микрофронты, перформанс-бюджет, безопасность и план внедрения.",
    promptB:
      "Опишите целевую фронт-архитектуру: SSR/edge, общий UI-kit, наблюдаемость UX, CI quality gates и риски миграции.",
    rubric: {
      keys: [["архитект", "микрофронт", "design system", "ssr"], ["безопас", "csp", "перформан"]],
      breadthKeys: [["ci", "бюджет", "rollout"]],
      workItems: [
        { id: "governance", phrases: ["governance", "верси", "апрув", "документ"] },
        { id: "metrics", phrases: ["vitals", "rum", "метрик", "slo"] },
      ],
      minLength: 220,
    },
  },
};

module.exports = {
  frontend: {
    junior: frontendJunior,
    middle: frontendMiddle,
    senior: frontendSenior,
  },
};
