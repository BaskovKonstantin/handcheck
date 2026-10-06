let needId = null;
let candidateId = null;

async function loadNeed() {
  const needs = await HandCheck.api("/api/employer/needs");
  needId = needs.items[0]?.id;
  if (!needId) {
    document.getElementById("empty").hidden = false;
    return;
  }
  await loadCard();
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
  cardEl.className = "deck-card enter";
  cardEl.innerHTML = `
    <h2>${data.card.displayName}</h2>
    <span class="category-pill">${data.card.categoryLabel}</span>
    <p>${(data.card.backgroundDomains || []).join(" · ")}</p>
    <p>${(data.card.stack || []).join(", ")}</p>
    <ul>${(data.card.taskPhrases || []).map((t) => `<li>${t}</li>`).join("")}</ul>
    <p><em>${(data.card.explanation || []).join(" ")}</em></p>`;
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
    await HandCheck.api(`/api/employer/needs/${needId}/reviews`, {
      method: "POST",
      body: JSON.stringify({ candidateId, decision: d }),
    });
    btn.disabled = false;
    await loadCard();
  });
});

const sheet = document.getElementById("sheet");
document.getElementById("invite-open").onclick = () => sheet.classList.remove("hidden");
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
  const from = Number(document.getElementById("salary-from").value);
  const to = Number(document.getElementById("salary-to").value);
  try {
    await animateExit("exit-right");
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
    await loadCard();
  } catch (e) {
    err.hidden = false;
    err.textContent = HandCheck.formatApiError(e);
  }
};

HandCheck.employerNav();
loadNeed();
