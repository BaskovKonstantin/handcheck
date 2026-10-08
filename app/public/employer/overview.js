"use strict";

function renderFunnel(funnel) {
  const esc = HandCheck.escapeHtml;
  const max = Math.max(funnel.sent, funnel.viewed, funnel.accepted, funnel.declined, 1);
  const bar = (label, value, cls) => {
    const pct = Math.round((value / max) * 100);
    return `<div class="overview-funnel-row">
      <span class="overview-funnel-label">${esc(label)}</span>
      <div class="grade-relation-bar overview-funnel-bar" aria-hidden="true"><span class="${cls}" style="width:${pct}%"></span></div>
      <span class="overview-funnel-value">${value}</span>
    </div>`;
  };
  const median =
    funnel.medianAnswerHours != null
      ? `${Math.round(funnel.medianAnswerHours)} ч`
      : "—";
  return `<h2 class="h2">Приглашения</h2>
    ${bar("Отправлено", funnel.sent, "grade-bar-exact")}
    ${bar("Просмотрено", funnel.viewed, "grade-bar-other")}
    ${bar("Принято", funnel.accepted, "grade-bar-exact")}
    ${bar("Отклонено", funnel.declined, "grade-bar-unconfirmed")}
    <p class="invite-meta">Доля принятий: ${funnel.acceptanceShare != null ? `${funnel.acceptanceShare}%` : "—"} · Медиана ответа: ${median}</p>`;
}

function renderNeeds(needs) {
  const esc = HandCheck.escapeHtml;
  if (!needs.length) {
    return HandCheck.emptyState(
      "Нет потребностей",
      "Опишите первую потребность, чтобы открыть колоду и кандидатов.",
      "/employer/need",
      "Создать потребность"
    );
  }
  return `<h2 class="h2">Потребности</h2><div class="overview-needs-grid">${needs
    .map((n) => {
      const total = n.pool.exact + n.pool.otherGrade + n.pool.unconfirmed || 1;
      const exactPct = Math.round((n.pool.exact / total) * 100);
      const otherPct = Math.round((n.pool.otherGrade / total) * 100);
      const unPct = 100 - exactPct - otherPct;
      return `<article class="overview-need-card">
        <h3 class="h3">${esc(n.title)}</h3>
        <div class="grade-relation-bar overview-need-bar" title="Точное / другой грейд / не подтверждено">
          <span class="grade-bar-exact" style="width:${exactPct}%"></span>
          <span class="grade-bar-other" style="width:${otherPct}%"></span>
          <span class="grade-bar-unconfirmed" style="width:${unPct}%"></span>
        </div>
        <p class="invite-meta">Колода: ${n.deckLeft} · Приглашено: ${n.invited} · Отложено: ${n.deferred}</p>
        <div class="overview-need-actions">
          <a class="btn-primary btn-sm" href="/employer/deck?need=${esc(n.id)}">Колода</a>
          <a class="btn-ghost btn-sm" href="/employer/candidates?need=${esc(n.id)}">Кандидаты</a>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function renderBank(rows) {
  const esc = HandCheck.escapeHtml;
  if (!rows.length) {
    return `<h2 class="h2">Банк</h2><p class="invite-meta">Пока нет открытых категорий в банке.</p>`;
  }
  const max = rows[0].count || 1;
  return `<h2 class="h2">Состав банка</h2><div class="overview-bank-chart">${rows
    .slice(0, 12)
    .map((r) => {
      const pct = Math.round((r.count / max) * 100);
      return `<div class="overview-bank-row">
        <span class="overview-bank-label">${esc(r.label || `${r.spec} × ${r.grade}`)}</span>
        <div class="overview-bank-bar"><span style="width:${pct}%"></span></div>
        <span class="overview-bank-count">${r.count}</span>
      </div>`;
    })
    .join("")}</div>`;
}

function renderActivity(events) {
  const esc = HandCheck.escapeHtml;
  if (!events.length) {
    return `<h2 class="h2">Активность</h2><p class="invite-meta">Событий пока нет — отправьте первое приглашение.</p>`;
  }
  const rows = events
    .map(
      (e) =>
        `<li><span class="overview-event-time">${esc(HandCheck.formatDateTimeMoscow(e.at))}</span> ${esc(e.label)}${e.name ? ` · ${esc(e.name)}` : ""}</li>`
    )
    .join("");
  return `<h2 class="h2">Активность</h2><ol class="overview-event-list">${rows}</ol>`;
}

function renderActions(actions) {
  const esc = HandCheck.escapeHtml;
  if (!actions.length) {
    return `<h2 class="h2">Следующие шаги</h2><p class="invite-meta">Всё под контролем — можно пройтись по колоде.</p>`;
  }
  return `<h2 class="h2">Следующие шаги</h2><ul class="overview-actions-list">${actions
    .map((a) => `<li><a href="${esc(a.href)}">${esc(a.label)}</a></li>`)
    .join("")}</ul>`;
}

async function loadOverview() {
  const data = await HandCheck.api("/api/employer/dashboard");
  document.getElementById("greeting-line").textContent = data.greeting || "Здравствуйте";
  document.getElementById("company-line").textContent = data.companyName || "Компания";
  document.getElementById("kpi-host").innerHTML = HandCheck.statTilesHtml(
    [
      { label: "Активные потребности", value: String(data.kpis?.needsActive ?? 0), variant: "forest" },
      { label: "В колоде", value: String(data.kpis?.deckLeft ?? 0), variant: "clay" },
      { label: "Открытые приглашения", value: String(data.kpis?.openInvites ?? 0), variant: "violet" },
      { label: "Банк (открытые)", value: String(data.kpis?.bankOpen ?? 0), variant: "forest" },
    ],
    { gridClass: "stat-tile-grid-compact" }
  );
  HandCheck.animateStatCounters(document.getElementById("kpi-host"));
  const kpiHost = document.getElementById("kpi-host");
  if (kpiHost && !kpiHost.querySelector(".overview-quick-links")) {
    kpiHost.insertAdjacentHTML(
      "beforeend",
      `<p class="overview-quick-links">
        <a class="btn-ghost btn-sm" href="/employer/tests">Тесты вакансии</a>
        <a class="btn-ghost btn-sm" href="/employer/invitations">Ответы на тесты</a>
      </p>`
    );
  }
  document.getElementById("funnel-host").innerHTML = renderFunnel(data.funnel || {});
  document.getElementById("needs-host").innerHTML = renderNeeds(data.needs || []);
  document.getElementById("bank-host").innerHTML = renderBank(data.bankComposition || []);
  document.getElementById("activity-host").innerHTML = renderActivity(data.events || []);
  document.getElementById("actions-host").innerHTML = renderActions(data.nextActions || []);
}

HandCheck.bootCabinetPage("employer", async () => {
  const hosts = ["kpi-host", "funnel-host", "needs-host"];
  for (const id of hosts) {
    document.getElementById(id).innerHTML = HandCheck.skeletonBlocks(2);
  }
  try {
    await loadOverview();
  } catch {
    document.getElementById("kpi-host").innerHTML = HandCheck.loadErrorState(
      "Не удалось загрузить обзор",
      "Повторите запрос.",
      () => loadOverview()
    );
  }
});
