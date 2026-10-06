const invitationId = location.pathname.split("/").pop();
let callId = null;
let timerStartedAt = null;
let timerTick = null;

const roomHost = document.getElementById("room-host");

function setBanner(text, live) {
  const banner = document.getElementById("state-banner");
  if (!banner) return;
  banner.textContent = text;
  banner.classList.toggle("live", Boolean(live));
}

function renderRoomShell() {
  roomHost.innerHTML = `
    <p class="call-state-banner" id="state-banner">Подготовка комнаты…</p>
    <div class="call-room-grid">
      <section class="panel call-room-panel">
        <h2 class="call-room-panel-title">Перед входом</h2>
        <label class="call-consent-label">
          <input type="checkbox" id="consent" />
          <span>Разговор сохранится и будет использован, чтобы оценить соответствие задаче.</span>
        </label>
        <p class="call-rec-row"><span class="rec-dot" id="rec-indicator"></span><span id="rec-label">Запись выключена</span></p>
        <div class="form-actions call-room-actions">
          <button class="btn-primary" id="join" disabled>Войти в комнату</button>
          <button class="btn-ghost" id="end" hidden>Завершить</button>
        </div>
        <p class="field-error" id="room-err" hidden></p>
      </section>
      <section class="call-video-shell panel" aria-label="Видео">
        <div class="call-video-placeholder" id="video-placeholder">
          <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 16h32v32H8V16zm36 8l12 8v16l-12 8V24z" fill="currentColor" opacity="0.35"/></svg>
          <p>Камера включится после входа</p>
        </div>
        <video id="local" class="call-video" autoplay muted playsinline hidden></video>
        <p id="timer" class="call-timer" hidden>00:00</p>
      </section>
    </div>`;
}

function bindRoomControls() {
  const consent = document.getElementById("consent");
  const join = document.getElementById("join");
  const endBtn = document.getElementById("end");
  const video = document.getElementById("local");
  const recLabel = document.getElementById("rec-label");
  const roomErr = document.getElementById("room-err");
  const placeholder = document.getElementById("video-placeholder");
  const timerEl = document.getElementById("timer");

  join.disabled = true;

  consent.addEventListener("change", () => {
    join.disabled = !consent.checked;
  });

  join.onclick = async () => {
    if (!consent.checked || join.disabled) return;
    roomErr.hidden = true;
    try {
      await HandCheck.api(`/api/calls/${callId}/consent`, {
        method: "POST",
        body: JSON.stringify({ accepted: true }),
      });
      await HandCheck.api(`/api/calls/${callId}/start`, { method: "POST" });
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      video.srcObject = stream;
      video.hidden = false;
      placeholder.hidden = true;
      video.classList.add("live");
      setBanner("Эфир — разговор записывается", true);
      recLabel.textContent = "Запись активна";
      join.hidden = true;
      endBtn.hidden = false;
      timerEl.hidden = false;
      timerStartedAt = Date.now();
      clearInterval(timerTick);
      timerTick = setInterval(() => {
        const sec = Math.floor((Date.now() - timerStartedAt) / 1000);
        const mm = String(Math.floor(sec / 60)).padStart(2, "0");
        const ss = String(sec % 60).padStart(2, "0");
        timerEl.textContent = `${mm}:${ss}`;
      }, 1000);
    } catch (e) {
      roomErr.hidden = false;
      roomErr.textContent = HandCheck.formatApiError(e);
    }
  };

  endBtn.onclick = async () => {
    await HandCheck.api(`/api/calls/${callId}/end`, { method: "POST" });
    location.href = "/";
  };

  return { consent, join, roomErr };
}

async function init() {
  if (!invitationId || invitationId === "call") {
    roomHost.innerHTML = HandCheck.emptyState(
      "Некорректная ссылка",
      "Откройте комнату из принятого приглашения в кабинете.",
      "/candidate/invitations",
      "К приглашениям"
    );
    return;
  }

  roomHost.innerHTML = HandCheck.skeletonBlocks(2);

  try {
    const info = await HandCheck.api(`/api/calls/for-invitation/${invitationId}`);
    callId = info.callId;
    renderRoomShell();
    setBanner("Комната готова — подтвердите согласие и войдите", false);
    const { consent, join, roomErr } = bindRoomControls();
    const me = await HandCheck.api("/api/me");
    const hasConsent =
      (me.role === "candidate" && info.consentCandidate) ||
      (me.role === "employer" && info.consentEmployer);
    if (hasConsent) {
      consent.checked = true;
      join.disabled = false;
    }
    roomErr.hidden = true;
  } catch (e) {
    const code = e?.data?.error || e?.message;
    const forbidden = e?.status === 403 || e?.status === 404;
    roomHost.innerHTML = HandCheck.emptyState(
      forbidden ? "Комната недоступна" : "Не удалось загрузить комнату",
      forbidden
        ? "Звонок доступен только после принятия приглашения участниками."
        : "Проверьте соединение или повторите запрос.",
      forbidden ? "/candidate/invitations" : undefined,
      forbidden ? "К приглашениям" : undefined
    );
    if (!forbidden) {
      const retry = document.createElement("button");
      retry.className = "btn-primary";
      retry.type = "button";
      retry.textContent = "Повторить";
      retry.onclick = () => init();
      roomHost.querySelector(".empty-state")?.appendChild(retry);
    }
  }
}

init();
