"use strict";

let cachedNeeds = [];
let cachedItems = [];
let selectedCompare = new Set();
let activeCandidate = null;
let inviteCandidateId = null;
let loadSeq = 0;
let searchDebounce;

const SPECS = [
  { value: "", label: "Любая" },
  { value: "backend", label: "Backend" },
  { value: "frontend", label: "Frontend" },
  { value: "fullstack", label: "Fullstack" },
  { value: "qa", label: "QA" },
  { value: "data", label: "Data" },
  { value: "devops", label: "DevOps" },
];

const GRADES = [
  { value: "", label: "Любой" },
  { value: "junior", label: "Junior" },
  { value: "middle", label: "Middle" },
  { value: "senior", label: "Senior" },
];

function statusLabel(row) {
  const st = row.reviewStatus;
  if (st === "invited") return "Приглашён";
  if (st === "later") return "Отложен";
  if (st === "rejected" || st === "declined") return "Отказ";
  return "Новый";
}

function readState() {
  const p = new URLSearchParams(location.search);
  return {
    q: p.get("q") || "",
    need: p.get("need") || "",
    spec: p.get("spec") || "",
    grade: p.get("grade") || "",
    status: p.get("status") || "",
    stack: p.get("stack") || "",
    fsp: p.get("fsp") || "",
    domain: p.get("domain") || "",
    sort: p.get("sort") || "relevance",
    page: p.get("page") || "1",
  };
}

function writeState(patch) {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === "" || v === null || v === undefined) p.delete(k);
    else p.set(k, String(v));
  }
  const qs = p.toString();
  history.replaceState({}, "", qs ? `${location.pathname}?${qs}` : location.pathname);
}

function buildApiQuery() {
  const s = readState();
  const p = new URLSearchParams();
  for (const key of ["q", "need", "spec", "grade", "status", "stack", "fsp", "domain", "sort", "page"]) {
    if (s[key]) p.set(key, s[key]);
  }
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

function renderFiltersRail() {
  const s = readState();
  const esc = HandCheck.escapeHtml;
  const needOpts = [
    `<option value="">Весь банк</option>`,
    ...cachedNeeds.map(
      (n) => `<option value="${esc(n.id)}"${s.need === n.id ? " selected" : ""}>${esc(n.title)}</option>`
    ),
  ].join("");
  document.getElementById("filters-rail").innerHTML = `
    <div class="filter-group">
      <span class="filter-group-label">Потребность</span>
      <select id="filter-need" class="filter-select">${needOpts}</select>
    </div>
    <div class="filter-group">
      <span class="filter-group-label">Специализация</span>
      <div class="segmented" role="group" aria-label="Специализация">
        ${SPECS.map(
          (sp) =>
            `<button type="button" class="segmented-btn${s.spec === sp.value ? " active" : ""}" data-spec="${esc(sp.value)}">${esc(sp.label)}</button>`
        ).join("")}
      </div>
    </div>
    <div class="filter-group">
      <span class="filter-group-label">Грейд</span>
      <div class="segmented segmented-compact" role="group" aria-label="Грейд">
        ${GRADES.map(
          (g) =>
            `<button type="button" class="segmented-btn${s.grade === g.value ? " active" : ""}" data-grade="${esc(g.value)}">${esc(g.label)}</button>`
        ).join("")}
      </div>
    </div>
    <div class="filter-group">
      <label class="filter-group-label">Статус
        <select id="filter-status" class="filter-select">
          <option value="">Любой</option>
          <option value="new"${s.status === "new" ? " selected" : ""}>Новый</option>
          <option value="later"${s.status === "later" ? " selected" : ""}>Отложен</option>
          <option value="invited"${s.status === "invited" ? " selected" : ""}>Приглашён</option>
          <option value="rejected"${s.status === "rejected" ? " selected" : ""}>Отказ</option>
        </select>
      </label>
    </div>
    <div class="filter-group">
      <label class="filter-group-label">ФСП
        <select id="filter-fsp" class="filter-select">
          <option value="">Любые</option>
          <option value="1"${s.fsp === "1" ? " selected" : ""}>Есть</option>
          <option value="0"${s.fsp === "0" ? " selected" : ""}>Нет</option>
        </select>
      </label>
    </div>
    <div class="filter-group">
      <label class="filter-group-label">Домен / отрасль
        <input type="text" id="filter-domain" class="filter-input" value="${esc(s.domain)}" placeholder="финтех" />
      </label>
    </div>`;
  bindFilterRail();
}

function bindFilterRail() {
  document.getElementById("filter-need")?.addEventListener("change", (e) => {
    writeState({ need: e.target.value, page: "1" });
    loadCandidates();
  });
  document.querySelectorAll("[data-spec]").forEach((btn) => {
    btn.onclick = () => {
      writeState({ spec: btn.dataset.spec, page: "1" });
      loadCandidates();
    };
  });
  document.querySelectorAll("[data-grade]").forEach((btn) => {
    btn.onclick = () => {
      writeState({ grade: btn.dataset.grade, page: "1" });
      loadCandidates();
    };
  });
  document.getElementById("filter-status")?.addEventListener("change", (e) => {
    writeState({ status: e.target.value, page: "1" });
    loadCandidates();
  });
  document.getElementById("filter-fsp")?.addEventListener("change", (e) => {
    writeState({ fsp: e.target.value, page: "1" });
    loadCandidates();
  });
  document.getElementById("filter-domain")?.addEventListener("change", (e) => {
    writeState({ domain: e.target.value.trim(), page: "1" });
    loadCandidates();
  });
}

function renderSearchChips(chips) {
  const host = document.getElementById("search-chips");
  if (!host) return;
  const esc = HandCheck.escapeHtml;
  const fromUrl = readState();
  const parts = [];
  if (fromUrl.stack && !chips?.some((c) => c.key === "stack")) {
    parts.push({ key: "stack", label: fromUrl.stack, remove: "stack" });
  }
  for (const c of chips || []) {
    parts.push({ key: c.key, label: c.label, remove: "q" });
  }
  host.innerHTML = parts
    .map(
      (c) =>
        `<button type="button" class="search-chip" data-remove="${esc(c.remove)}" data-chip-key="${esc(c.key)}">${esc(c.label)}<span aria-hidden="true">×</span></button>`
    )
    .join("");
  host.querySelectorAll(".search-chip").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.remove === "stack") writeState({ stack: "", page: "1" });
      else {
        const s = readState();
        writeState({ q: "", page: "1" });
        document.getElementById("search-input").value = "";
      }
      loadCandidates();
    };
  });
}

function rowHtml(r) {
  const esc = HandCheck.escapeHtml;
  const stack = (r.stack || []).map((s) => `<span class="chip chip-skill">${esc(s)}</span>`).join("");
  const domain = (r.backgroundDomains || [])[0] || "—";
  const fsp = r.hasFsp ? '<span class="chip chip-fsp">ФСП</span>' : '<span class="muted">—</span>';
  const marks = `${HandCheck.renderPasteInputMark(r.pasteInputMark) || ""}${HandCheck.renderAiUsageSection(r.aiUsage, { compact: true }) || ""}`;
  const date = r.assignedAt ? HandCheck.formatDateTimeMoscow(r.assignedAt).split(",")[0] : "—";
  const checked = selectedCompare.has(r.id) ? " checked" : "";
  return `<tr class="candidates-row" data-id="${esc(r.id)}" tabindex="0">
    <td class="candidates-col-check"><input type="checkbox" class="compare-check" data-id="${esc(r.id)}"${checked} aria-label="Сравнить" /></td>
    <td><strong>${esc(r.displayName)}</strong></td>
    <td>${HandCheck.renderCategoryPill(r.categoryLabel, r.categoryStatus, r.gradeRelation)}</td>
    <td><div class="chip-row chip-row-skills">${stack || "—"}</div></td>
    <td>${esc(domain)}</td>
    <td>${fsp}</td>
    <td class="candidates-col-marks">${marks}</td>
    <td><span class="status-pill sent">${esc(statusLabel(r))}</span></td>
    <td>${esc(date)}</td>
    <td class="candidates-col-actions">
      <button type="button" class="btn-primary btn-sm" data-invite="${esc(r.id)}">Пригласить</button>
    </td>
  </tr>`;
}

function cardHtml(r) {
  const esc = HandCheck.escapeHtml;
  const stack = (r.stack || []).map((s) => `<span class="chip chip-skill">${esc(s)}</span>`).join("");
  return `<article class="candidates-card" data-id="${esc(r.id)}">
    <div class="candidates-card-head">
      <input type="checkbox" class="compare-check" data-id="${esc(r.id)}"${selectedCompare.has(r.id) ? " checked" : ""} />
      <strong>${esc(r.displayName)}</strong>
      ${HandCheck.renderCategoryPill(r.categoryLabel, r.categoryStatus, r.gradeRelation)}
    </div>
    <div class="chip-row chip-row-skills">${stack}</div>
    <p class="invite-meta">${esc(statusLabel(r))} · ${r.hasFsp ? "ФСП" : "без ФСП"}</p>
    <button type="button" class="btn-primary btn-sm" data-invite="${esc(r.id)}">Пригласить</button>
  </article>`;
}

function renderTable(items) {
  const host = document.getElementById("candidates-table-host");
  if (!items.length) {
    host.innerHTML = HandCheck.emptyState(
      "Никого не нашли",
      "Снимите фильтры или выберите «Весь банк».",
      readState().need ? "/employer/deck" : "/employer/need",
      readState().need ? "В колоду" : "К потребности"
    );
    return;
  }
  const rows = items.map((r) => rowHtml(r)).join("");
  const cards = items.map((r) => cardHtml(r)).join("");
  host.innerHTML = `
    <div class="candidates-table-wrap">
      <table class="candidates-table">
        <thead><tr>
          <th scope="col"></th><th scope="col">Имя</th><th scope="col">Категория</th><th scope="col">Стек</th>
          <th scope="col">Домен</th><th scope="col">ФСП</th><th scope="col">Метки</th><th scope="col">Статус</th>
          <th scope="col">В категории с</th><th scope="col"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="candidates-cards">${cards}</div>`;
  bindTableEvents(host);
}

function bindTableEvents(root) {
  root.querySelectorAll(".candidates-row, .candidates-card").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("button, input, a")) return;
      openDrawer(el.dataset.id);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") openDrawer(el.dataset.id);
    });
  });
  root.querySelectorAll("[data-invite]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openInvite(btn.dataset.invite);
    };
  });
  root.querySelectorAll(".compare-check").forEach((cb) => {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.onchange = () => {
      if (cb.checked) {
        if (selectedCompare.size >= 3) {
          cb.checked = false;
          HandCheck.toast("Можно сравнить не больше трёх кандидатов", "info");
          return;
        }
        selectedCompare.add(cb.dataset.id);
      } else selectedCompare.delete(cb.dataset.id);
      updateCompareButton();
    };
  });
}

function updateCompareButton() {
  const btn = document.getElementById("compare-open");
  if (!btn) return;
  btn.hidden = selectedCompare.size < 2;
}

function renderCompare() {
  const panel = document.getElementById("compare-panel");
  const picked = cachedItems.filter((r) => selectedCompare.has(r.id));
  if (picked.length < 2) {
    panel.hidden = true;
    panel.classList.add("hidden");
    return;
  }
  const esc = HandCheck.escapeHtml;
  panel.hidden = false;
  panel.classList.remove("hidden");
  panel.innerHTML = `<div class="candidates-compare-inner">
    <h2 class="h2">Сравнение</h2>
    <div class="candidates-compare-grid">${picked
      .map(
        (r) => `<div class="candidates-compare-col">
          <strong>${esc(r.displayName)}</strong>
          ${HandCheck.renderCategoryPill(r.categoryLabel, r.categoryStatus, r.gradeRelation)}
          <ul class="deck-explain-lines">${(r.explanation || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
        </div>`
      )
      .join("")}</div>
    <button type="button" class="btn-ghost btn-sm" id="compare-close">Закрыть</button>
  </div>`;
  const compareClose = document.getElementById("compare-close");
  if (compareClose) {
    compareClose.onclick = () => {
      panel.hidden = true;
      panel.classList.add("hidden");
    };
  }
}

function openDrawer(id) {
  const row = cachedItems.find((r) => r.id === id);
  if (!row) return;
  activeCandidate = row;
  const drawer = document.getElementById("detail-drawer");
  const esc = HandCheck.escapeHtml;
  const explain = (row.explanation || []).map((l) => `<li>${esc(l)}</li>`).join("");
  const tasks = (row.taskPhrases || []).map((l) => `<li>${esc(l)}</li>`).join("");
  document.getElementById("drawer-body").innerHTML = `
    <h2 class="h2">${esc(row.displayName)}</h2>
    ${HandCheck.renderCategoryPill(row.categoryLabel, row.categoryStatus, row.gradeRelation)}
    <ul class="deck-explain-lines">${explain}</ul>
    <h3 class="h3">Фразы по задачам</h3>
    <ul class="deck-explain-lines">${tasks}</ul>`;
  document.getElementById("drawer-actions").innerHTML = `
    <button type="button" class="btn-ghost" data-decision="later">Отложить</button>
    <button type="button" class="btn-ghost" data-decision="rejected">Отказать</button>
    <button type="button" class="btn-primary" data-invite-drawer="1">Пригласить</button>`;
  drawer.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => drawer.classList.add("open"));
  document.getElementById("drawer-actions").querySelectorAll("[data-decision]").forEach((btn) => {
    btn.onclick = () => review(btn.dataset.decision, row.id);
  });
  document.querySelector("[data-invite-drawer]")?.addEventListener("click", () => openInvite(row.id));
}

function closeDrawer() {
  const drawer = document.getElementById("detail-drawer");
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  setTimeout(() => {
    drawer.hidden = true;
  }, 280);
}

async function review(decision, candidateId) {
  const need = readState().need;
  if (!need) {
    HandCheck.toast("Выберите потребность для решения по кандидату", "info");
    return;
  }
  try {
    await HandCheck.api(`/api/employer/needs/${need}/reviews`, {
      method: "POST",
      body: JSON.stringify({ decision, candidateId }),
    });
    HandCheck.toast(decision === "later" ? "Отложен" : "Отказ сохранён", "info");
    closeDrawer();
    await loadCandidates();
  } catch (e) {
    HandCheck.toast(HandCheck.formatApiError(e), "error");
  }
}

function validateSalaryRange(fromRaw, toRaw) {
  const fromMissing = fromRaw === "" || fromRaw === null || fromRaw === undefined;
  const toMissing = toRaw === "" || toRaw === null || toRaw === undefined;
  if (fromMissing || toMissing) return "Укажите вилку зарплаты";
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!Number.isInteger(from) || from < 0) return "Укажите корректное «От»";
  if (!Number.isInteger(to) || to < 0) return "Укажите корректное «До»";
  if (from === 0 && to === 0) return "Укажите вилку зарплаты";
  if (from > to) return "«От» не может быть больше «До»";
  return null;
}

function openInvite(candidateId) {
  const need = readState().need;
  if (!need) {
    HandCheck.toast("Выберите потребность, чтобы отправить приглашение", "info");
    return;
  }
  inviteCandidateId = candidateId;
  document.getElementById("invite-err").hidden = true;
  document.getElementById("salary-range-err")?.setAttribute("hidden", "");
  document.getElementById("sheet").classList.remove("hidden");
}

async function sendInvite() {
  const need = readState().need;
  if (!need || !inviteCandidateId) return;
  const err = document.getElementById("invite-err");
  const salaryMsg = validateSalaryRange(
    document.getElementById("salary-from").value,
    document.getElementById("salary-to").value
  );
  const salaryErr = document.getElementById("salary-range-err");
  if (salaryMsg) {
    if (salaryErr) {
      salaryErr.textContent = salaryMsg;
      salaryErr.hidden = false;
    }
    return;
  }
  err.hidden = true;
  try {
    await HandCheck.api("/api/employer/invitations", {
      method: "POST",
      body: JSON.stringify({
        needId: need,
        candidateId: inviteCandidateId,
        salaryFrom: Number(document.getElementById("salary-from").value),
        salaryTo: Number(document.getElementById("salary-to").value),
        offerText: document.getElementById("offer-text").value,
        contactChannel: document.getElementById("contact-channel").value,
      }),
    });
    document.getElementById("sheet").classList.add("hidden");
    HandCheck.toast("Приглашение отправлено", "success");
    closeDrawer();
    await loadCandidates();
  } catch (e) {
    err.hidden = false;
    err.textContent = HandCheck.formatApiError(e);
  }
}

function renderPagination(meta) {
  const el = document.getElementById("pagination");
  if (!meta || meta.total <= meta.pageSize) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const pages = Math.ceil(meta.total / meta.pageSize);
  const cur = meta.page;
  el.innerHTML = `<button type="button" class="btn-ghost btn-sm" id="page-prev"${cur <= 1 ? " disabled" : ""}>Назад</button>
    <span class="invite-meta">${cur} / ${pages}</span>
    <button type="button" class="btn-ghost btn-sm" id="page-next"${cur >= pages ? " disabled" : ""}>Вперёд</button>`;
  const pagePrev = document.getElementById("page-prev");
  if (pagePrev) {
    pagePrev.onclick = () => {
      writeState({ page: String(cur - 1) });
      loadCandidates();
    };
  }
  const pageNext = document.getElementById("page-next");
  if (pageNext) {
    pageNext.onclick = () => {
      writeState({ page: String(cur + 1) });
      loadCandidates();
    };
  }
}

async function loadCandidates() {
  const seq = ++loadSeq;
  const host = document.getElementById("candidates-table-host");
  host.innerHTML = HandCheck.skeletonBlocks(5);
  try {
    const data = await HandCheck.api(`/api/employer/candidates${buildApiQuery()}`);
    if (seq !== loadSeq) return;
    cachedItems = data.items || [];
    renderSearchChips(data.parsedChips);
    renderFiltersRail();
    document.getElementById("search-input").value = readState().q;
    document.getElementById("sort-select").value = readState().sort;
    renderTable(cachedItems);
    renderPagination(data);
    renderCompare();
    updateCompareButton();
  } catch {
    if (seq !== loadSeq) return;
    host.innerHTML = HandCheck.loadErrorState("Не удалось загрузить кандидатов", "Повторите запрос.", () =>
      loadCandidates()
    );
  }
}

function bindStaticUi() {
  const input = document.getElementById("search-input");
  input.value = readState().q;
  input.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      writeState({ q: input.value.trim(), page: "1" });
      loadCandidates();
    }, 320);
  });
  document.getElementById("sort-select").addEventListener("change", (e) => {
    writeState({ sort: e.target.value, page: "1" });
    loadCandidates();
  });
  document.getElementById("compare-open")?.addEventListener("click", renderCompare);
  document.querySelectorAll("[data-close-drawer]").forEach((el) => {
    el.addEventListener("click", closeDrawer);
  });
  document.getElementById("invite-cancel")?.addEventListener("click", () => {
    document.getElementById("sheet").classList.add("hidden");
  });
  document.getElementById("invite-send")?.addEventListener("click", sendInvite);
  document.getElementById("sheet")?.addEventListener("click", (e) => {
    if (e.target.id === "sheet") document.getElementById("sheet").classList.add("hidden");
  });
}

HandCheck.bootCabinetPage("employer", async () => {
  const needsRes = await HandCheck.api("/api/employer/needs");
  cachedNeeds = needsRes.items || [];
  const s = readState();
  if (!s.need) {
    const resolved = HandCheck.resolveEmployerNeedId(cachedNeeds, new URLSearchParams(location.search));
    if (resolved && new URLSearchParams(location.search).has("need")) {
      writeState({ need: resolved });
    }
  }
  renderFiltersRail();
  bindStaticUi();
  await loadCandidates();
});
