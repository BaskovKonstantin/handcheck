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

function mountHeader(links = []) {
  const el = document.getElementById("site-header");
  if (!el) return;
  const path = window.location.pathname;
  const nav = links
    .map(
      (l) =>
        `<a href="${l.href}" class="${path === l.href || path.startsWith(l.href + "/") ? "active" : ""}">${l.label}</a>`
    )
    .join("");
  el.innerHTML = `
    <div class="site-header">
      <a class="logo" href="/">HandCheck</a>
      <nav class="site-nav">${nav}<button type="button" class="btn-ghost" id="logout-btn">Выход</button></nav>
    </div>`;
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/auth";
  });
}

function candidateNav() {
  mountHeader([
    { href: "/candidate/today", label: "Сегодня" },
    { href: "/candidate/past", label: "Прошлое" },
    { href: "/candidate/tasks", label: "Задания" },
    { href: "/candidate/invitations", label: "Приглашения" },
    { href: "/candidate/calls", label: "Звонки" },
  ]);
}

function employerNav() {
  mountHeader([
    { href: "/employer/need", label: "Потребность" },
    { href: "/employer/deck", label: "Колода" },
    { href: "/employer/list", label: "Список" },
    { href: "/employer/deferred", label: "Отложенные" },
    { href: "/employer/invitations", label: "Приглашения" },
    { href: "/employer/calls", label: "Звонки" },
  ]);
}

window.HandCheck = { api, mountHeader, candidateNav, employerNav };
