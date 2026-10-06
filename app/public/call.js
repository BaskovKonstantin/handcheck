const invitationId = location.pathname.split("/").pop();
let callId = null;
let timerStartedAt = null;
let timerTick = null;

const consent = document.getElementById("consent");
const join = document.getElementById("join");
const endBtn = document.getElementById("end");
const video = document.getElementById("local");
const banner = document.getElementById("state-banner");
const recLabel = document.getElementById("rec-label");
const roomErr = document.getElementById("room-err");

join.disabled = true;

function setBanner(text, live) {
  banner.textContent = text;
  banner.classList.toggle("live", Boolean(live));
}

consent.addEventListener("change", () => {
  join.disabled = !consent.checked;
});

async function init() {
  setBanner("Загрузка комнаты…");
  try {
    const info = await HandCheck.api(`/api/calls/for-invitation/${invitationId}`);
    callId = info.callId;
    setBanner("Комната готова — подтвердите согласие и войдите", false);
    const me = await HandCheck.api("/api/me");
    const hasConsent =
      (me.role === "candidate" && info.consentCandidate) ||
      (me.role === "employer" && info.consentEmployer);
    if (hasConsent) {
      consent.checked = true;
      join.disabled = false;
    }
  } catch {
    setBanner("Не удалось загрузить комнату", false);
    roomErr.hidden = false;
    roomErr.textContent = "Проверьте соединение.";
    const retry = document.createElement("button");
    retry.className = "btn-ghost btn-sm";
    retry.textContent = "Повторить";
    retry.type = "button";
    retry.onclick = () => {
      roomErr.hidden = true;
      init();
    };
    roomErr.after(retry);
    join.disabled = !consent.checked;
  }
}

join.onclick = async () => {
  if (!consent.checked || join.disabled) return;
  await HandCheck.api(`/api/calls/${callId}/consent`, {
    method: "POST",
    body: JSON.stringify({ accepted: true }),
  });
  await HandCheck.api(`/api/calls/${callId}/start`, { method: "POST" });
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  video.srcObject = stream;
  video.classList.add("live");
  setBanner("Эфир — разговор записывается", true);
  recLabel.textContent = "Запись активна";
  join.hidden = true;
  endBtn.hidden = false;
  const timerEl = document.getElementById("timer");
  timerStartedAt = Date.now();
  clearInterval(timerTick);
  timerTick = setInterval(() => {
    const sec = Math.floor((Date.now() - timerStartedAt) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    timerEl.textContent = `${mm}:${ss}`;
  }, 1000);
};

endBtn.onclick = async () => {
  await HandCheck.api(`/api/calls/${callId}/end`, { method: "POST" });
  location.href = "/";
};

init();
