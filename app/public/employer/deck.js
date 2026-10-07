let needId = null;
let candidateId = null;
let cachedNeeds = [];

function setDeckLayoutVisible(show) {
  const layout = document.getElementById("deck-layout");
  if (layout) layout.hidden = !show;
}

async function refreshDeckNeedPanel(needs) {
  const panel = document.getElementById("deck-need-panel");
  if (!panel || !needId) return;
  const need = (needs || cachedNeeds).find((n) => n.id === needId);
  if (!need) {
    panel.innerHTML = "";
    return;
  }
  try {
    const qs = window.location.search || "";
    const data = await HandCheck.api(`/api/employer/needs/${needId}/matches${qs}`);
    const stats = HandCheck.deckStatsFromMatches(data.items || []);
    panel.innerHTML = HandCheck.renderDeckNeedPanel(need, stats);
  } catch {
    panel.innerHTML = HandCheck.renderDeckNeedPanel(need, { deckLeft: "—", invited: "—", deferred: "—" });
  }
}

function validateSalaryRange(fromRaw, toRaw) {
  const fromMissing = fromRaw === "" || fromRaw === null || fromRaw === undefined;
  const toMissing = toRaw === "" || toRaw === null || toRaw === undefined;
  if (fromMissing || toMissing) {
    return "Укажите вилку зарплаты";
  }
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!Number.isInteger(from)) {
    return "Укажите целое число в поле «От»";
  }
  if (from < 0) {
    return "Вилка не может быть отрицательной";
  }
  if (!Number.isInteger(to)) {
    return "Укажите целое число в поле «До»";
  }
  if (to < 0) {
    return "Вилка не может быть отрицательной";
  }
  if (from === 0 && to === 0) {
    return "Укажите вилку зарплаты";
  }
  if (from > to) {
    return "Вилка зарплаты: «От» не может быть больше «До»";
  }
  return null;
}

function showSalaryError(msg) {
  const el = document.getElementById("salary-range-err");
  const generic = document.getElementById("invite-err");
  if (msg) {
    el.hidden = false;
    el.textContent = msg;
    generic.hidden = true;
  } else {
    el.hidden = true;
    el.textContent = "";
  }
}

function setDeckVisible(showCard) {
  const wrap = document.getElementById("deck-wrap");
  const emptyHost = document.getElementById("deck-empty");
  if (wrap) wrap.hidden = !showCard;
  if (emptyHost) emptyHost.hidden = showCard;
}

function showDeckLoading() {
  const cardEl = document.getElementById("deck-card");
  const actions = document.getElementById("deck-actions");
  const roundActions = document.getElementById("deck-actions-round");
  if (cardEl) {
    cardEl.hidden = true;
    cardEl.innerHTML = "";
  }
  if (actions) actions.hidden = true;
  if (roundActions) roundActions.hidden = true;
  const emptyHost = document.getElementById("deck-empty");
  if (emptyHost) {
    emptyHost.hidden = false;
    emptyHost.innerHTML = HandCheck.deckSkeleton();
  }
}

async function loadNeed() {
  showDeckLoading();
  const needsRes = await HandCheck.api("/api/employer/needs");
  const needs = needsRes.items || [];
  cachedNeeds = needs;
  const params = new URLSearchParams(location.search);
  needId = HandCheck.resolveEmployerNeedId(needs, params);
  if (needId) HandCheck.persistEmployerNeedId(needId);
  const switchHost = document.getElementById("need-switcher-host");
  if (switchHost) {
    switchHost.innerHTML = needId ? HandCheck.employerNeedSwitcherHtml(needs, needId) : "";
    HandCheck.bindEmployerNeedSwitcher((id) => {
      needId = id;
      loadCard();
    });
  }
  if (!needId) {
    setDeckLayoutVisible(false);
    setDeckVisible(false);
    const emptyHost = document.getElementById("deck-empty");
    emptyHost.hidden = false;
    emptyHost.innerHTML = HandCheck.emptyState(
      "Нет активной потребности",
      "Создайте или активируйте потребность, чтобы открыть колоду кандидатов.",
      "/employer/need",
      "Настроить потребность"
    );
    return;
  }
  setDeckLayoutVisible(true);
  await refreshDeckNeedPanel(needs);
  await loadCard();
}

function renderCard(data) {
  const cardEl = document.getElementById("deck-card");
  const esc = HandCheck.escapeHtml;
  const monogram = HandCheck.initials(data.card.displayName);
  const domains = (data.card.backgroundDomains || [])
    .map((d) => `<span class="chip chip-domain">${esc(d)}</span>`)
    .join("");
  const stack = (data.card.stack || [])
    .map((s) => `<span class="chip chip-skill">${esc(s)}</span>`)
    .join("");
  const phrases = (data.card.taskPhrases || [])
    .map((t) => `<li>${esc(t)}</li>`)
    .join("");
  const explainLines = (data.card.explanation || [])
    .map((line) => `<li>${esc(line)}</li>`)
    .join("");

  cardEl.hidden = false;
  cardEl.className = "deck-card enter deck-card-swipe";
  cardEl.innerHTML = `
    <div class="deck-card-stack" aria-hidden="true"></div>
    <div class="deck-card-face">
      <div class="deck-card-head">
        <div class="avatar-monogram" title="Без фото по правилам платформы">${monogram}</div>
        <div>
          <h2 class="deck-name">${esc(data.card.displayName)}</h2>
          ${HandCheck.renderCategoryPill(data.card.categoryLabel, data.card.categoryStatus, data.card.gradeRelation)}
          ${HandCheck.renderGradeRelationBar(
            data.card.categoryLabel,
            data.card.gradeRelation,
            data.card.categoryStatus
          )}
          ${HandCheck.renderPasteInputMark(data.card.pasteInputMark)}
        </div>
      </div>
      ${domains ? `<div class="chip-row">${domains}</div>` : ""}
      ${stack ? `<div class="chip-row chip-row-skills">${stack}</div>` : ""}
      <ul class="deck-phrases">${phrases}</ul>
      ${
        explainLines
          ? `<div class="deck-explain"><svg class="inline-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a7 7 0 1 0 7 7 7 7 0 0 0-7-7zm0 3a1 1 0 1 1-1 1 1 1 0 0 1 1-1zm2 8H6v-1h1V8H6V7h3v4h1v1z" fill="currentColor"/></svg><ul class="deck-explain-lines deck-explain-lines-plain">${explainLines}</ul></div>`
          : ""
      }
      ${(() => {
        const ai = data.card.aiUsage;
        const showAi =
          ai && !ai.empty && (ai.headline || (ai.activityLines || []).length > 0);
        const note =
          data.card.integrationNote && !showAi
            ? `<p class="deck-integration-note invite-meta">${esc(data.card.integrationNote)}</p>`
            : "";
        return `${note}${showAi ? HandCheck.renderAiUsageSection(ai) : ""}`;
      })()}
    </div>`;
}

async function loadCard() {
  const qs = window.location.search;
  const data = await HandCheck.api(`/api/employer/needs/${needId}/deck/next${qs}`);
  const cardEl = document.getElementById("deck-card");
  const actions = document.getElementById("deck-actions");
  const empty = document.getElementById("empty");
  const emptyHost = document.getElementById("deck-empty");
  if (emptyHost) {
    emptyHost.hidden = true;
    emptyHost.innerHTML = "";
  }
  if (!data.card) {
    cardEl.innerHTML = "";
    cardEl.className = "deck-card";
    cardEl.hidden = true;
    actions.hidden = true;
    const roundActions = document.getElementById("deck-actions-round");
    if (roundActions) roundActions.hidden = true;
    empty.hidden = true;
    setDeckVisible(false);
    let invited = 0;
    try {
      const matches = await HandCheck.api(`/api/employer/needs/${needId}/matches${qs}`);
      invited = matches.items?.filter((i) => i.reviewStatus === "invited").length || 0;
    } catch {
      invited = 0;
    }
    const meta = HandCheck.getDeckEmptyState({ invitedInMatches: invited });
    emptyHost.hidden = false;
    emptyHost.innerHTML = HandCheck.emptyStateActions(meta.title, meta.help, meta.actions);
    candidateId = null;
    return;
  }
  empty.hidden = true;
  setDeckVisible(true);
  actions.hidden = false;
  const roundActions = document.getElementById("deck-actions-round");
  if (roundActions) roundActions.hidden = false;
  candidateId = data.candidateId;
  renderCard(data);
  await refreshDeckNeedPanel(cachedNeeds);
}

function animateExit(cls) {
  const cardEl = document.getElementById("deck-card");
  cardEl.classList.remove("enter");
  cardEl.classList.add(cls);
  return new Promise((r) => setTimeout(r, 320));
}

function bindDeckUi() {
  document.getElementById("invite-open-round")?.addEventListener("click", () => {
    document.getElementById("invite-open")?.click();
  });

  document.querySelectorAll("[data-decision]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!candidateId) return;
      btn.disabled = true;
      const d = btn.dataset.decision;
      const cls = d === "rejected" ? "exit-left" : "exit-down";
      await animateExit(cls);
      try {
        await HandCheck.api(`/api/employer/needs/${needId}/reviews`, {
          method: "POST",
          body: JSON.stringify({ candidateId, decision: d }),
        });
        if (d === "later") HandCheck.toast("Кандидат отложен", "info");
        if (d === "rejected") HandCheck.toast("Отказ отправлен", "info");
      } catch (e) {
        HandCheck.toast(HandCheck.formatApiError(e), "error");
      }
      btn.disabled = false;
      await loadCard();
    });
  });

  const sheet = document.getElementById("sheet");
  const inviteOpen = document.getElementById("invite-open");
  if (inviteOpen) {
    inviteOpen.onclick = () => {
      showSalaryError(null);
      document.getElementById("invite-err").hidden = true;
      sheet.classList.remove("hidden");
    };
  }
  const inviteCancel = document.getElementById("invite-cancel");
  if (inviteCancel) {
    inviteCancel.onclick = () => sheet.classList.add("hidden");
  }
  sheet?.addEventListener("click", (e) => {
    if (e.target === sheet) sheet.classList.add("hidden");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") sheet.classList.add("hidden");
  });

  const inviteSend = document.getElementById("invite-send");
  if (inviteSend) {
    inviteSend.onclick = async () => {
      const err = document.getElementById("invite-err");
      err.hidden = true;
      const fromVal = document.getElementById("salary-from").value;
      const toVal = document.getElementById("salary-to").value;
      const salaryMsg = validateSalaryRange(fromVal, toVal);
      if (salaryMsg) {
        showSalaryError(salaryMsg);
        return;
      }
      showSalaryError(null);
      const from = Number(fromVal);
      const to = Number(toVal);
      const btn = document.getElementById("invite-send");
      btn.disabled = true;
      try {
        await HandCheck.api("/api/employer/invitations", {
          method: "POST",
          body: JSON.stringify({
            needId,
            candidateId,
            salaryFrom: from,
            salaryTo: to,
            offerText: document.getElementById("offer-text").value,
            contactChannel: document.getElementById("contact-channel").value,
          }),
        });
        sheet.classList.add("hidden");
        HandCheck.toast("Приглашение отправлено", "success");
        await animateExit("exit-right");
        await loadCard();
      } catch (e) {
        const msg = HandCheck.formatApiError(e);
        if (e?.data?.details?.fields?.salaryRange) {
          showSalaryError(msg);
        } else {
          err.hidden = false;
          err.textContent = msg;
        }
      } finally {
        btn.disabled = false;
      }
    };
  }
}

HandCheck.bootCabinetPage("employer", () =>
  loadNeed().catch(() => {
    const emptyEl = document.getElementById("empty");
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = "Не удалось загрузить колоду";
    }
  })
);

bindDeckUi();
