const ERROR_MESSAGES = {
  invalid_credentials: "Неверный email или пароль",
  unauthorized: "Войдите в аккаунт",
  forbidden: "Нет доступа",
  file_too_large: "Файл слишком большой (максимум 80 МБ)",
  upload_failed: "Не удалось загрузить файл",
  invalid_id: "Некорректный идентификатор",
  internal_error: "Внутренняя ошибка сервера",
  invalid_body: "Проверьте поля формы",
  network_error: "Не удалось связаться с сервером",
  timeout: "Сервер долго не отвечает",
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

const LOGO_MARK = `<span class="logo-mark" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="8" fill="currentColor" opacity="0.12"/><path d="M8 18V10h3.2c2.2 0 3.6 1.1 3.6 2.9 0 1.2-.6 2.1-1.6 2.5L16 18h-2.4l-1.9-2.2H11v2.2H8zm3-4.5c.9 0 1.4-.4 1.4-1.1s-.5-1.1-1.4-1.1H11v2.2h0zM17.5 18V10H20v8h-2.5z" fill="currentColor"/></svg></span>`;

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
};

const TAB_PRIMARY = {
  candidate: ["/candidate/today", "/candidate/profile", "/candidate/invitations", "/candidate/calls"],
  employer: ["/employer/deck", "/employer/need", "/employer/invitations", "/employer/calls"],
};

function navLinkHtml(l, compact) {
  const iconKey = LINK_ICON[l.href];
  const icon = iconKey ? NAV_ICONS[iconKey] : "";
  const cls = `cabinet-nav-link${isActive(l.href) ? " active" : ""}${compact ? " tab-link" : ""}`;
  return `<a href="${l.href}" class="${cls}">${icon}<span>${l.label}</span></a>`;
}

function ensureCabinetChrome(links, role) {
  document.body.classList.add("has-cabinet-chrome", `cabinet-${role}`);
  let aside = document.getElementById("cabinet-aside");
  if (!aside) {
    aside = document.createElement("aside");
    aside.id = "cabinet-aside";
    aside.className = "cabinet-aside";
    aside.setAttribute("aria-label", "Разделы кабинета");
    document.body.insertBefore(aside, document.body.querySelector("main"));
  }
  aside.innerHTML = `<div class="cabinet-aside-inner">${links.map((l) => navLinkHtml(l, false)).join("")}</div>`;

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
}

async function mountCabinetShell(links, role) {
  const el = document.getElementById("site-header");
  if (!el) return;
  let me = { email: "" };
  try {
    me = await api("/api/me");
  } catch {
    window.location.href = "/auth";
    return;
  }
  const nav = links.map((l) => navLinkHtml(l, false)).join("");
  el.innerHTML = `
    <header class="cabinet-header cabinet-header-v3">
      <div class="cabinet-header-inner">
        <a class="logo" href="/">${LOGO_MARK}<span>HandCheck</span></a>
        <nav class="cabinet-nav-scroll" aria-label="Кабинет">${nav}</nav>
        <div class="cabinet-user">
          <span class="cabinet-email" title="${me.email}">${me.email}</span>
          <button type="button" class="btn-ghost btn-sm" id="logout-btn">Выход</button>
        </div>
      </div>
      <div class="cabinet-header-glow" aria-hidden="true"></div>
    </header>`;
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/auth";
  });
  ensureCabinetChrome(links, role);
}

const CANDIDATE_LINKS = [
  { href: "/candidate/today", label: "Сегодня" },
  { href: "/candidate/profile", label: "Профиль" },
  { href: "/candidate/tasks", label: "Задания" },
  { href: "/candidate/invitations", label: "Приглашения" },
  { href: "/candidate/calls", label: "Звонки" },
];

const EMPLOYER_LINKS = [
  { href: "/employer/need", label: "Потребность" },
  { href: "/employer/deck", label: "Колода" },
  { href: "/employer/list", label: "Список" },
  { href: "/employer/deferred", label: "Отложенные" },
  { href: "/employer/profile", label: "Профиль" },
  { href: "/employer/invitations", label: "Приглашения" },
  { href: "/employer/calls", label: "Звонки" },
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
    el.innerHTML = '<p class="loading"><span class="loading-dot"></span>Загрузка…</p>';
  }
}

const EMPTY_ILLUSTRATION = `<svg class="empty-illus" viewBox="0 0 120 80" aria-hidden="true"><ellipse cx="60" cy="68" rx="48" ry="6" fill="currentColor" opacity="0.08"/><rect x="28" y="18" width="64" height="44" rx="10" fill="currentColor" opacity="0.06" stroke="currentColor" stroke-width="1.5" opacity="0.2"/><path d="M40 32h40M40 42h28" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.25"/></svg>`;

function emptyState(title, help, ctaHref, ctaLabel) {
  const cta = ctaHref
    ? `<a class="btn-primary" href="${ctaHref}">${ctaLabel || "Перейти"}</a>`
    : "";
  return `<div class="empty-state">${EMPTY_ILLUSTRATION}<h2 class="empty-title">${title}</h2><p class="empty-help">${help}</p>${cta}</div>`;
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
  setLoading,
  emptyState,
  loadErrorState,
  loadPanel,
  toast,
  initials,
  invitationStatusLabel: (s) => INVITATION_STATUS_LABEL[s] || s,
  callStatusLabel: (s) => CALL_STATUS_LABEL[s] || s,
  LOGO_MARK,
};
