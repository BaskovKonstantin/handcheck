const ERROR_MESSAGES = {
  invalid_credentials: "Неверный email или пароль",
  unauthorized: "Войдите в аккаунт",
  forbidden: "Нет доступа",
  email_not_confirmed: "Подтвердите email — проверьте почту после регистрации",
  not_found: "Страница или объект не найдены",
  rate_limit: "Слишком много запросов — подождите минуту",
  file_too_large: "Файл слишком большой (максимум 80 МБ)",
  upload_failed: "Не удалось загрузить файл",
  invalid_id: "Некорректный идентификатор",
  internal_error: "Внутренняя ошибка сервера",
  invalid_body: "Проверьте поля формы",
  network_error: "Не удалось связаться с сервером",
  timeout: "Сервер долго не отвечает",
  cooldown: "Пересдача по этой специализации пока недоступна",
  deadline_passed: "Время на рабочую задачу истекло",
  candidate_paused: "Кандидат на паузе — новые приглашения не отправляются",
  candidate_rejected: "Кандидат отклонён по этой потребности",
  candidate_deferred: "Кандидат в отложенных — сначала верните его из списка отложенных",
  consent_required: "Подтвердите согласие на запись перед входом в комнату",
  invitation_duplicate: "Приглашение уже отправлено — дождитесь ответа кандидата",
  invitation_final: "Ответ на приглашение уже зафиксирован",
  battery_incomplete: "Батарея заданий для выбранной категории пока не готова",
};

const API_TIMEOUT_MS = 14000;
const API_RETRIES = 2;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatApiError(err) {
  const code = err?.data?.error || err?.message;
  const fields = err?.data?.details?.fields;
  if (fields?.salaryRange) return fields.salaryRange;
  if (fields?.tokenName) return fields.tokenName;
  if (err?.status === 413 || code === "file_too_large") {
    return ERROR_MESSAGES.file_too_large;
  }
  if (err?.status === 502) {
    return "Сервер не принял файл. Попробуйте меньший размер или повторите позже.";
  }
  if (code === "timeout" || err?.code === "timeout") {
    return ERROR_MESSAGES.timeout;
  }
  if (code === "network_error" || err?.code === "network_error") {
    return ERROR_MESSAGES.network_error;
  }
  return ERROR_MESSAGES[code] || "Что-то пошло не так. Попробуйте ещё раз.";
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const dedupe = method === "GET" && options.dedupe !== false;
  if (dedupe) {
    const key = path;
    const existing = inflightGetJson.get(key);
    if (existing) return existing;
    const run = apiOnce(path, options);
    inflightGetJson.set(key, run);
    try {
      return await run;
    } finally {
      inflightGetJson.delete(key);
    }
  }
  return apiOnce(path, options);
}

async function apiOnce(path, options = {}) {
  const { retries = API_RETRIES, timeoutMs = API_TIMEOUT_MS, ...fetchOpts } = options;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(path, {
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(fetchOpts.headers || {}) },
        signal: controller.signal,
        ...fetchOpts,
      });
      clearTimeout(timer);
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      if (!res.ok) {
        const err = new Error(data?.error || res.statusText);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (e) {
      clearTimeout(timer);
      if (e?.status) throw e;
      lastErr = e;
      const aborted = e?.name === "AbortError";
      const err = new Error(aborted ? "timeout" : "network_error");
      err.code = aborted ? "timeout" : "network_error";
      err.cause = e;
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function isActive(href) {
  const path = window.location.pathname;
  return path === href || path.startsWith(href + "/");
}

const INVITATION_STATUS_LABEL = {
  sent: "Отправлено",
  viewed: "Просмотрено",
  accepted: "Принято",
  declined: "Отклонено",
};

const CALL_STATUS_LABEL = {
  ready: "Готов к звонку",
  live: "В эфире",
  ended: "Завершён",
};

const LOGO_MARK = `<span class="logo-mark" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M8 16.5l4.5 4.5L24 9.5" stroke="#fff" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

let cabinetMeEmail = "";

const ME_EMAIL_KEY = "hc_me_email";
/** @type {Map<string, Promise<unknown>>} */
const inflightGetJson = new Map();

function getCachedMeEmail() {
  try {
    return sessionStorage.getItem(ME_EMAIL_KEY) || "";
  } catch {
    return "";
  }
}

function setCachedMeEmail(email) {
  try {
    if (email) sessionStorage.setItem(ME_EMAIL_KEY, email);
    else sessionStorage.removeItem(ME_EMAIL_KEY);
  } catch {
    /* ignore */
  }
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function formatCabinetEmailMarkup(email) {
  if (email) {
    const safe = escapeHtml(email);
    return `<span class="cabinet-email" title="${safe}">${safe}</span>`;
  }
  return `<span class="cabinet-email cabinet-email-skeleton" aria-busy="true" title="Загрузка профиля"></span>`;
}

const NAV_ICONS = {
  today: '<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v14H4V6zm2 2v10h12V8H6zm2 9h2v-2H8v2zm0-4h2v-2H8v2zm4 4h2v-2h-2v2zm0-4h2v-2h-2v2zm4 4h2v-2h-2v2z" fill="currentColor"/></svg>',
  profile: '<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z" fill="currentColor"/></svg>',
  tasks: '<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v2H5V5zm0 6h14v2H5v-2zm0 6h10v2H5v-2z" fill="currentColor"/></svg>',
  invitations: '<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8l8 5 8-5v10H4V8zm16-2H4l8 5 8-5z" fill="currentColor"/></svg>',
  calls: '<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h3l1 4-2 1a12 12 0 0 0 5 5l1-2 4 1v3c-6-1-11-6-12-12z" fill="currentColor"/></svg>',
  need: '<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v4H4V4zm0 6h10v4H4v-4zm0 6h16v4H4v-4z" fill="currentColor"/></svg>',
  deck: '<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h14v12H4V6zm2 2v8h10V8H6zm12-1h2v14h-2V7z" fill="currentColor"/></svg>',
  list: '<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z" fill="currentColor"/></svg>',
  deferred: '<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-6-6V4zm1 5v5l4 2-.8 1.4L11 14V9h2z" fill="currentColor"/></svg>',
  integrations:
    '<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v3H7V7zm0 7h6v3H7v-3zm9 0h2v3h-2v-3zM5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="currentColor"/></svg>',
};

const LINK_ICON = {
  "/candidate/today": "today",
  "/candidate/profile": "profile",
  "/candidate/tasks": "tasks",
  "/candidate/invitations": "invitations",
  "/candidate/calls": "calls",
  "/employer/need": "need",
  "/employer/deck": "deck",
  "/employer/list": "list",
  "/employer/deferred": "deferred",
  "/employer/profile": "profile",
  "/employer/invitations": "invitations",
  "/employer/calls": "calls",
  "/candidate/integrations": "integrations",
  "/employer/integrations": "integrations",
};

const TAB_PRIMARY = {
  candidate: ["/candidate/today", "/candidate/invitations", "/candidate/calls", "/candidate/tasks"],
  employer: ["/employer/deck", "/employer/need", "/employer/invitations", "/employer/calls"],
};

function bindCabinetMoreMenu(role, links) {
  const primary = new Set(TAB_PRIMARY[role] || []);
  const extra = links.filter((l) => !primary.has(l.href));
  const tabs = document.getElementById("cabinet-tabs");
  if (!tabs || !extra.length) return;
  let more = document.getElementById("cabinet-more");
  if (!more) {
    more = document.createElement("button");
    more.type = "button";
    more.id = "cabinet-more";
    more.className = "cabinet-nav-link tab-link cabinet-more-btn";
    more.innerHTML = `${NAV_ICONS.profile}<span>Ещё</span>`;
    tabs.appendChild(more);
  }
  let sheet = document.getElementById("cabinet-more-sheet");
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "cabinet-more-sheet";
    sheet.className = "cabinet-more-sheet";
    sheet.hidden = true;
    document.body.appendChild(sheet);
  }
  sheet.innerHTML = `<div class="cabinet-more-backdrop" data-close="1"></div><div class="cabinet-more-panel" role="dialog" aria-label="Дополнительные разделы">${extra
    .map((l) => navLinkHtml(l, false))
    .join("")}</div>`;
  const close = () => {
    sheet.hidden = true;
  };
  more.onclick = () => {
    sheet.hidden = !sheet.hidden;
  };
  sheet.querySelector("[data-close]")?.addEventListener("click", close);
  sheet.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
}

function navLinkHtml(l, compact) {
  const iconKey = LINK_ICON[l.href];
  const icon = iconKey ? NAV_ICONS[iconKey] : "";
  const cls = `cabinet-nav-link${isActive(l.href) ? " active" : ""}${compact ? " tab-link" : ""}`;
  return `<a href="${l.href}" class="${cls}">${icon}<span>${l.label}</span></a>`;
}

function bindLogout(btn) {
  btn?.addEventListener("click", async () => {
    setCachedMeEmail("");
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/auth";
  });
}

function updateCabinetEmails(email) {
  document.querySelectorAll(".cabinet-email").forEach((el) => {
    el.classList.remove("cabinet-email-skeleton");
    el.removeAttribute("aria-busy");
    el.textContent = email;
    el.title = email;
  });
}

function paintCabinetHeader(el, meEmail) {
  el.innerHTML = `
    <header class="cabinet-header cabinet-header-v3 cabinet-header-r6">
      <div class="cabinet-header-inner">
        <a class="logo cabinet-header-logo" href="/">${LOGO_MARK}<span>HandCheck</span></a>
        <div class="cabinet-user cabinet-user-inline">
          ${formatCabinetEmailMarkup(meEmail)}
          <button type="button" class="btn-ghost btn-sm" id="logout-btn-header">Выход</button>
        </div>
      </div>
      <div class="cabinet-header-glow" aria-hidden="true"></div>
    </header>`;
  bindLogout(document.getElementById("logout-btn-header"));
}

function ensureCabinetChrome(links, role, meEmail) {
  document.body.classList.add("has-cabinet-chrome", `cabinet-${role}`);
  let aside = document.getElementById("cabinet-aside");
  if (!aside) {
    aside = document.createElement("aside");
    aside.id = "cabinet-aside";
    aside.className = "cabinet-aside";
    aside.setAttribute("aria-label", "Разделы кабинета");
    document.body.insertBefore(aside, document.body.querySelector("main"));
  }
  const navLinks = links.map((l) => navLinkHtml(l, false)).join("");
  aside.innerHTML = `
    <div class="cabinet-aside-brand">
      <a class="logo cabinet-aside-logo" href="/">${LOGO_MARK}<span>HandCheck</span></a>
      <p class="cabinet-aside-tagline">Категория по навыку</p>
    </div>
    <div class="cabinet-aside-inner">${navLinks}</div>
    <div class="cabinet-user-card">
      ${formatCabinetEmailMarkup(meEmail)}
      <button type="button" class="btn-ghost btn-sm" id="logout-btn-aside">Выход</button>
    </div>`;
  bindLogout(document.getElementById("logout-btn-aside"));

  let tabs = document.getElementById("cabinet-tabs");
  if (!tabs) {
    tabs = document.createElement("nav");
    tabs.id = "cabinet-tabs";
    tabs.className = "cabinet-tabs";
    tabs.setAttribute("aria-label", "Быстрая навигация");
    document.body.appendChild(tabs);
  }
  const tabHrefs = TAB_PRIMARY[role] || links.slice(0, 4).map((l) => l.href);
  const tabLinks = tabHrefs
    .map((href) => links.find((l) => l.href === href))
    .filter(Boolean);
  tabs.innerHTML = tabLinks.map((l) => navLinkHtml(l, true)).join("");
  bindCabinetMoreMenu(role, links);
}

function mountCabinetChromeSync(links, role) {
  const el = document.getElementById("site-header");
  if (!el) return;
  const placeholder = cabinetMeEmail || getCachedMeEmail();
  paintCabinetHeader(el, placeholder);
  ensureCabinetChrome(links, role, placeholder);
}

async function refreshCabinetMeEmail(expectedRole) {
  try {
    const me = await api("/api/me");
    if (expectedRole && me.role !== expectedRole) {
      window.location.replace(me.role === "employer" ? "/employer/deck" : "/candidate/today");
      return;
    }
    cabinetMeEmail = me.email || "";
    setCachedMeEmail(cabinetMeEmail);
    updateCabinetEmails(cabinetMeEmail);
  } catch {
    window.location.href = "/auth";
  }
}

async function mountCabinetShell(links, role) {
  mountCabinetChromeSync(links, role);
  await refreshCabinetMeEmail(role);
}

/**
 * Mount cabinet chrome synchronously, then load page data in parallel with /api/me.
 */
function bootCabinetPage(role, loadFn) {
  const links = role === "employer" ? EMPLOYER_LINKS : CANDIDATE_LINKS;
  mountCabinetChromeSync(links, role);
  void refreshCabinetMeEmail(role);
  try {
    const result = loadFn();
    if (result && typeof result.then === "function") {
      result.catch(() => {});
    }
  } catch (_e) {
    /* page-specific catch handlers */
  }
}

let cabinetPageLoadSeq = 0;

/** Ignore stale async results after a newer cabinet page load started. */
function nextCabinetPageLoad() {
  cabinetPageLoadSeq += 1;
  return cabinetPageLoadSeq;
}

function isStaleCabinetPageLoad(seq) {
  return seq !== cabinetPageLoadSeq;
}

function timelineSection(title, items) {
  if (!items?.length) {
    return `<section class="timeline-section"><h2 class="timeline-heading">${title}</h2><p class="invite-meta">Пока ничего нового — держите профиль открытым и проверяйте приглашения.</p></section>`;
  }
  const rows = items
    .map(
      (it) => `<li class="timeline-item">
        <span class="timeline-dot timeline-dot-${it.tone || "forest"}" aria-hidden="true"></span>
        <div class="timeline-body">
          <p class="timeline-title">${it.title}</p>
          ${it.meta ? `<p class="timeline-meta">${it.meta}</p>` : ""}
          ${it.cta || ""}
        </div>
      </li>`
    )
    .join("");
  return `<section class="timeline-section"><h2 class="timeline-heading">${title}</h2><ol class="timeline-list">${rows}</ol></section>`;
}

function statTilesHtml(tiles) {
  return `<div class="stat-tile-grid">${tiles
    .map(
      (t) => `<article class="stat-tile stat-tile-${t.variant || "forest"}">
      <div class="stat-tile-label">${t.icon || ""}${t.label}</div>
      <div class="stat-tile-value">${t.value}</div>
      ${t.hint ? `<p class="invite-meta">${t.hint}</p>` : ""}
      ${t.link ? `<a class="btn-ghost btn-sm" href="${t.link.href}">${t.link.label}</a>` : ""}
    </article>`
    )
    .join("")}</div>`;
}

const CANDIDATE_LINKS = [
  { href: "/candidate/today", label: "Сегодня" },
  { href: "/candidate/profile", label: "Профиль" },
  { href: "/candidate/tasks", label: "Задания" },
  { href: "/candidate/invitations", label: "Приглашения" },
  { href: "/candidate/calls", label: "Звонки" },
  { href: "/candidate/past", label: "Прошлое" },
  { href: "/candidate/integrations", label: "Интеграции" },
];

const EMPLOYER_LINKS = [
  { href: "/employer/need", label: "Потребность" },
  { href: "/employer/deck", label: "Колода" },
  { href: "/employer/list", label: "Список" },
  { href: "/employer/deferred", label: "Отложенные" },
  { href: "/employer/profile", label: "Профиль" },
  { href: "/employer/invitations", label: "Приглашения" },
  { href: "/employer/calls", label: "Звонки" },
  { href: "/employer/integrations", label: "Интеграции" },
];

function candidateNav() {
  return mountCabinetShell(CANDIDATE_LINKS, "candidate");
}

function employerNav() {
  return mountCabinetShell(EMPLOYER_LINKS, "employer");
}

function setLoading(el, on) {
  if (!el) return;
  if (on) {
    el.innerHTML = skeletonBlocks(2);
  }
}

function skeletonBlocks(count = 3) {
  return Array.from({ length: count })
    .map(
      () =>
        `<div class="skeleton-card" aria-hidden="true"><div class="skeleton-line skeleton-line-lg"></div><div class="skeleton-line"></div><div class="skeleton-line skeleton-line-sm"></div></div>`
    )
    .join("");
}

function deckSkeleton() {
  return `<div class="deck-skeleton" aria-busy="true" aria-label="Загрузка карточки">
    <div class="skeleton-card deck-skeleton-card">
      <div class="skeleton-line skeleton-line-lg"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line skeleton-line-sm"></div>
    </div>
    <div class="deck-skeleton-actions">
      <span class="skeleton-pill"></span>
      <span class="skeleton-pill"></span>
      <span class="skeleton-pill skeleton-pill-clay"></span>
    </div>
  </div>`;
}

function invitationStatusClass(status) {
  if (status === "accepted") return "accepted";
  if (status === "declined") return "declined";
  if (status === "sent" || status === "viewed") return "sent";
  return "";
}

function callStatusClass(status) {
  if (status === "ended") return "ended";
  if (status === "live") return "live";
  return "ready";
}

function formatDateTimeMoscow(iso) {
  if (!iso) return "";
  let normalized = iso;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:/.test(iso)) {
    normalized = `${iso.replace(" ", "T")}Z`;
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(iso) && !/[zZ]$/.test(iso) && !/[+-]\d{2}:\d{2}$/.test(iso)) {
    normalized = `${iso}Z`;
  }
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSalaryRange(from, to) {
  const f = Number(from);
  const t = Number(to);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return "—";
  return `₽${f.toLocaleString("ru")} – ₽${t.toLocaleString("ru")}`;
}

const EMPTY_ILLUSTRATION = `<svg class="empty-illus" viewBox="0 0 120 80" aria-hidden="true"><ellipse cx="60" cy="68" rx="48" ry="6" fill="currentColor" opacity="0.08"/><rect x="28" y="18" width="64" height="44" rx="10" fill="currentColor" opacity="0.06" stroke="currentColor" stroke-width="1.5" opacity="0.2"/><path d="M40 32h40M40 42h28" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.25"/></svg>`;

function emptyState(title, help, ctaHref, ctaLabel) {
  const cta = ctaHref
    ? `<a class="btn-primary" href="${ctaHref}">${ctaLabel || "Перейти"}</a>`
    : "";
  return `<div class="empty-state">${EMPTY_ILLUSTRATION}<h2 class="empty-title">${title}</h2><p class="empty-help">${help}</p>${cta}</div>`;
}

/** Keep in sync with app/lib/deck-empty-state.js */
function getDeckEmptyState({ invitedInMatches }) {
  if (invitedInMatches > 0) {
    return {
      title: "Колода пуста",
      help:
        "Все подходящие кандидаты уже получили приглашение по этой потребности. Откройте приглашения или посмотрите полный список.",
      actions: [
        { href: "/employer/invitations", label: "Приглашения", primary: true },
        { href: "/employer/list", label: "Список", primary: false },
        { href: "/employer/need", label: "Изменить потребность", primary: false },
      ],
    };
  }
  return {
    title: "Колода пуста",
    help:
      "Нет кандидатов для свайпа по текущим фильтрам. Проверьте потребность, снимите фильтры в списке или загляните в отложенные.",
    actions: [
      { href: "/employer/list", label: "Список", primary: true },
      { href: "/employer/deferred", label: "Отложенные", primary: false },
      { href: "/employer/need", label: "Изменить потребность", primary: false },
    ],
  };
}

function emptyStateActions(title, help, actions) {
  const ctas = (actions || [])
    .map((a) =>
      `<a class="${a.primary ? "btn-primary" : "btn-ghost"}" href="${a.href}">${a.label}</a>`
    )
    .join("");
  return `<div class="empty-state">${EMPTY_ILLUSTRATION}<h2 class="empty-title">${title}</h2><p class="empty-help">${help}</p><div class="empty-actions">${ctas}</div></div>`;
}

function loadErrorState(title, help, retryFn) {
  const id = `retry-${Math.random().toString(36).slice(2, 9)}`;
  setTimeout(() => {
    document.getElementById(id)?.addEventListener("click", () => retryFn());
  }, 0);
  return `<div class="empty-state error-state">${EMPTY_ILLUSTRATION}<h2 class="empty-title">${title}</h2><p class="empty-help">${help}</p><button type="button" class="btn-primary" id="${id}">Повторить</button></div>`;
}

async function loadPanel(el, loader) {
  if (!el) return;
  setLoading(el, true);
  try {
    await loader();
  } catch {
    el.innerHTML = loadErrorState(
      "Не удалось загрузить данные",
      "Проверьте соединение или повторите запрос.",
      () => loadPanel(el, loader)
    );
  }
}

let toastTimer;
function toast(message, type = "info") {
  let root = document.getElementById("hc-toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "hc-toast-root";
    root.className = "toast-root";
    document.body.appendChild(root);
  }
  root.innerHTML = `<div class="toast toast-${type}" role="status">${message}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    root.innerHTML = "";
  }, 3200);
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

window.HandCheck = {
  api,
  formatApiError,
  candidateNav,
  employerNav,
  bootCabinetPage,
  nextCabinetPageLoad,
  isStaleCabinetPageLoad,
  setLoading,
  skeletonBlocks,
  deckSkeleton,
  emptyState,
  emptyStateActions,
  getDeckEmptyState,
  loadErrorState,
  loadPanel,
  toast,
  initials,
  timelineSection,
  statTilesHtml,
  invitationStatusLabel: (s) => INVITATION_STATUS_LABEL[s] || s,
  invitationStatusClass,
  callStatusLabel: (s) => CALL_STATUS_LABEL[s] || s,
  callStatusClass,
  formatSalaryRange,
  formatDateTimeMoscow,
  LOGO_MARK,
};
