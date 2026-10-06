const ERROR_MESSAGES = {
  invalid_credentials: "Неверный email или пароль",
  unauthorized: "Войдите в аккаунт",
  forbidden: "Нет доступа",
  file_too_large: "Файл слишком большой (максимум 80 МБ)",
  upload_failed: "Не удалось загрузить файл",
  invalid_id: "Некорректный идентификатор",
  internal_error: "Внутренняя ошибка сервера",
};

function formatApiError(err) {
  const code = err?.data?.error || err?.message;
  if (err?.status === 413 || code === "file_too_large") {
    return ERROR_MESSAGES.file_too_large;
  }
  if (err?.status === 502) {
    return "Сервер не принял файл. Попробуйте меньший размер или повторите позже.";
  }
  return ERROR_MESSAGES[code] || "Что-то пошло не так. Попробуйте ещё раз.";
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
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
}

function isActive(href) {
  const path = window.location.pathname;
  return path === href || path.startsWith(href + "/");
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
  const nav = links
    .map(
      (l) =>
        `<a href="${l.href}" class="cabinet-nav-link${isActive(l.href) ? " active" : ""}">${l.label}</a>`
    )
    .join("");
  el.innerHTML = `
    <header class="cabinet-header">
      <div class="cabinet-header-inner">
        <a class="logo" href="/">HandCheck</a>
        <nav class="cabinet-nav-scroll" aria-label="Кабинет">${nav}</nav>
        <div class="cabinet-user">
          <span class="cabinet-email" title="${me.email}">${me.email}</span>
          <button type="button" class="btn-ghost btn-sm" id="logout-btn">Выход</button>
        </div>
      </div>
    </header>`;
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/auth";
  });
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
  mountCabinetShell(CANDIDATE_LINKS, "candidate");
}

function employerNav() {
  mountCabinetShell(EMPLOYER_LINKS, "employer");
}

function setLoading(el, on) {
  if (!el) return;
  if (on) {
    el.innerHTML = '<p class="loading">Загрузка…</p>';
  }
}

function emptyState(title, help, ctaHref, ctaLabel) {
  const cta = ctaHref
    ? `<a class="btn-primary" href="${ctaHref}">${ctaLabel || "Перейти"}</a>`
    : "";
  return `<div class="empty-state"><h2 class="empty-title">${title}</h2><p class="empty-help">${help}</p>${cta}</div>`;
}

window.HandCheck = {
  api,
  formatApiError,
  candidateNav,
  employerNav,
  setLoading,
  emptyState,
};
