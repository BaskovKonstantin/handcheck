let needId = null;
let candidateId = null;

function validateSalaryRange(fromRaw, toRaw) {
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!Number.isInteger(from) || from < 0) {
    return "Укажите целое число в поле «От»";
  }
  if (!Number.isInteger(to) || to < 0) {
    return "Укажите целое число в поле «До»";
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

async function loadNeed() {
  const needs = await HandCheck.api("/api/employer/needs");
  needId = needs.items[0]?.id;
  if (!needId) {
    document.getElementById("empty").hidden = false;
    return;
  }
  await loadCard();
}

function renderCard(data) {
  const cardEl = document.getElementById("deck-card");
  const monogram = HandCheck.initials(data.card.displayName);
  const domains = (data.card.backgroundDomains || [])
    .map((d) => `<span class="chip chip-domain">${d}</span>`)
    .join("");
  const stack = (data.card.stack || [])
    .map((s) => `<span class="chip chip-skill">${s}</span>`)
    .join("");
  const phrases = (data.card.taskPhrases || [])
    .map((t) => `<li>${t}</li>`)
    .join("");
  const explain = (data.card.explanation || []).join(" ");

  cardEl.className = "deck-card enter deck-card-swipe";
  cardEl.innerHTML = `
    <div class="deck-card-stack" aria-hidden="true"></div>
    <div class="deck-card-face">
      <div class="deck-card-head">
        <div class="avatar-monogram" title="Без фото по правилам платформы">${monogram}</div>
        <div>
          <h2 class="deck-name">${data.card.displayName}</h2>
          <span class="category-pill">${data.card.categoryLabel}</span>
        </div>
      </div>
      ${domains ? `<div class="chip-row">${domains}</div>` : ""}
      ${stack ? `<div class="chip-row chip-row-skills">${stack}</div>` : ""}
      <ul class="deck-phrases">${phrases}</ul>
      <p class="deck-explain"><svg class="inline-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a7 7 0 1 0 7 7 7 7 0 0 0-7-7zm0 3a1 1 0 1 1-1 1 1 1 0 0 1 1-1zm2 8H6v-1h1V8H6V7h3v4h1v1z" fill="currentColor"/></svg> ${explain}</p>
    </div>`;
}

async function loadCard() {
  const qs = window.location.search;
  const data = await HandCheck.api(`/api/employer/needs/${needId}/deck/next${qs}`);
  const cardEl = document.getElementById("deck-card");
  const actions = document.getElementById("deck-actions");
  const empty = document.getElementById("empty");
  if (!data.card) {
    cardEl.innerHTML = "";
    actions.hidden = true;
    empty.hidden = false;
    candidateId = null;
    return;
  }
  empty.hidden = true;
  actions.hidden = false;
  candidateId = data.candidateId;
  renderCard(data);
}

function animateExit(cls) {
  const cardEl = document.getElementById("deck-card");
  cardEl.classList.remove("enter");
  cardEl.classList.add(cls);
  return new Promise((r) => setTimeout(r, 320));
}

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
document.getElementById("invite-open").onclick = () => {
  showSalaryError(null);
  document.getElementById("invite-err").hidden = true;
  sheet.classList.remove("hidden");
};
document.getElementById("invite-cancel").onclick = () => sheet.classList.add("hidden");
sheet.addEventListener("click", (e) => {
  if (e.target === sheet) sheet.classList.add("hidden");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") sheet.classList.add("hidden");
});

document.getElementById("invite-send").onclick = async () => {
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

HandCheck.employerNav();
loadNeed().catch(() => {
  document.getElementById("empty").hidden = false;
  document.getElementById("empty").textContent = "Не удалось загрузить колоду";
});
