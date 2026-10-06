const invitationId = location.pathname.split("/").pop();
let callId = null;
let timerStartedAt = null;
let timerTick = null;
let callSession = null;
let roomInfo = null;
let roomMe = null;

const roomHost = document.getElementById("room-host");

function setCallLede(text) {
  const lede = document.querySelector(".call-room-hero .lede");
  if (lede) lede.textContent = text;
}

function setBanner(text, live) {
  const banner = document.getElementById("state-banner");
  if (!banner) return;
  banner.textContent = text;
  banner.classList.toggle("live", Boolean(live));
}

function renderEndedView(info, me) {
  HandCheck.bootCabinetPage(me.role, () => {});
  const who =
    me.role === "employer"
      ? info.candidateName || "Кандидат"
      : info.companyName || "Работодатель";
  const esc = HandCheck.escapeHtml;
  const endedWhen = info.endedAt ? HandCheck.formatDateTimeMoscow(info.endedAt) : "";
  const salary = HandCheck.formatSalaryRange(info.salaryFrom, info.salaryTo);
  const duration = info.durationHint ? esc(info.durationHint) : "";
  const metaRows = [
    info.needTitle ? `<dt>Потребность</dt><dd>${esc(info.needTitle)}</dd>` : "",
    salary ? `<dt>Вилка</dt><dd>${esc(salary)}</dd>` : "",
    endedWhen ? `<dt>Завершён</dt><dd>${esc(endedWhen)}</dd>` : "",
    duration ? `<dt>Длительность</dt><dd>${duration}</dd>` : "",
  ]
    .filter(Boolean)
    .join("");
  const analysis =
    me.role === "employer" && info.analysisText
      ? `<section class="panel call-analysis-panel"><h2 class="h2">Внутренний разбор</h2><p>${esc(info.analysisText)}</p></section>`
      : "";
  const aiUsage =
    me.role === "employer" && info.aiUsage && !info.aiUsage.empty
      ? HandCheck.renderAiUsageSection(info.aiUsage).replace(
          "deck-ai-usage",
          "deck-ai-usage call-ai-panel"
        )
      : "";
  const visibleSides = (info.recordingSides || []).filter((side) => {
    if (me.role === "employer") return true;
    return side === "candidate";
  });
  const recordings = visibleSides.length
    ? `<section class="panel call-recording-panel"><h2 class="h2">Запись</h2><div class="call-recording-players">${visibleSides
        .map((side) => {
          const label = side === "candidate" ? "Кандидат" : "Работодатель";
          const url = `/api/calls/${info.callId}/recording?side=${side}`;
          return `<div class="call-recording-side"><span class="invite-meta">${label}</span>
                <video class="call-recording-video" controls playsinline preload="metadata" src="${url}"></video>
                <a class="btn-ghost btn-sm" href="${url}" download="${side}-recording.webm">Скачать</a></div>`;
        })
        .join("")}</div></section>`
    : "";
  const ledeEmployer =
    "Комната закрыта. Ниже — итог созвона и материалы только для работодателя.";
  const ledeCandidate = "Комната закрыта. Краткий итог созвона — подробности в списке звонков.";
  setCallLede(me.role === "employer" ? ledeEmployer : ledeCandidate);
  setBanner("Звонок завершён", false);
  roomHost.innerHTML = `<article class="panel call-result-card">
        <div class="call-result-head">
          <span class="status-pill ended">Завершён</span>
          <h2 class="h2">${me.role === "employer" ? `Звонок с кандидатом: ${esc(who)}` : `Звонок с ${esc(who)}`}</h2>
        </div>
        ${metaRows ? `<dl class="call-result-meta">${metaRows}</dl>` : ""}
        ${analysis}
        ${aiUsage}
        ${recordings}
        <div class="call-result-actions">
          <a class="btn-primary" href="${me.role === "employer" ? "/employer/calls" : "/candidate/calls"}">К списку звонков</a>
        </div>
      </article>`;
}

function renderRoomShell(peerLabel) {
  roomHost.innerHTML = `
    <p class="call-state-banner" id="state-banner">Подготовка комнаты…</p>
    <div class="call-room-grid">
      <section class="panel call-room-panel">
        <h2 class="call-room-panel-title" id="panel-title">Перед входом</h2>
        <p class="invite-meta" id="peer-line" hidden></p>
        <p class="invite-meta" id="peer-state">Собеседник ещё не подключился</p>
        <label class="call-consent-label" id="consent-wrap">
          <input type="checkbox" id="consent" />
          <span>Разговор сохранится и будет использован, чтобы оценить соответствие задаче.</span>
        </label>
        <p class="invite-meta" id="speech-note" hidden></p>
        <p class="call-rec-row"><span class="rec-dot" id="rec-indicator"></span><span id="rec-label">Запись выключена</span></p>
        <div class="form-actions call-room-actions">
          <button class="btn-primary" id="join" disabled>Войти в комнату</button>
          <button class="btn-ghost" id="end" hidden>Завершить</button>
        </div>
        <p class="field-error" id="room-err" hidden></p>
      </section>
      <section class="call-video-shell panel" aria-label="Видео">
        <div class="call-video-grid">
          <div class="call-video-tile call-video-tile-remote">
            <p class="call-video-tile-label">Собеседник</p>
            <div class="call-video-placeholder" id="remote-placeholder">
              <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 16h32v32H8V16zm36 8l12 8v16l-12 8V24z" fill="currentColor" opacity="0.35"/></svg>
              <p id="remote-wait">${HandCheck.escapeHtml(peerLabel || "Собеседник ещё не подключился")}</p>
            </div>
            <video id="remote" class="call-video call-video-remote" autoplay playsinline hidden></video>
          </div>
          <div class="call-video-tile call-video-tile-local">
            <p class="call-video-tile-label">Вы</p>
            <div class="call-video-placeholder" id="video-placeholder">
              <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 16h32v32H8V16zm36 8l12 8v16l-12 8V24z" fill="currentColor" opacity="0.35"/></svg>
              <p>Камера включится после входа</p>
            </div>
            <video id="local" class="call-video call-video-local" autoplay muted playsinline hidden></video>
          </div>
        </div>
        <p id="timer" class="call-timer" hidden>00:00</p>
      </section>
    </div>`;
}

function updateRecordingLabel(state) {
  const recLabel = document.getElementById("rec-label");
  const recDot = document.getElementById("rec-indicator");
  if (!recLabel) return;
  if (state.recording) {
    recLabel.textContent = "Запись активна";
    recDot?.classList.add("live");
  } else if (state.recordingUnavailable) {
    recLabel.textContent = "Запись недоступна в этом браузере";
    recDot?.classList.remove("live");
  } else if (state.recordingPreparing) {
    recLabel.textContent = "Подготовка записи…";
    recDot?.classList.remove("live");
  } else {
    recLabel.textContent = "Запись выключена";
    recDot?.classList.remove("live");
  }
  const speechNote = document.getElementById("speech-note");
  if (speechNote) {
    const note = [state.speechNote, state.transcriptWarn].filter(Boolean).join(" ");
    if (note) {
      speechNote.hidden = false;
      speechNote.textContent = note;
    }
  }
}

function updatePeerUi(state) {
  const peerState = document.getElementById("peer-state");
  const remote = document.getElementById("remote");
  const remotePh = document.getElementById("remote-placeholder");
  if (!peerState) return;
  if (state.peerConnected && remote) {
    peerState.textContent = "Собеседник в эфире";
    remotePh.hidden = true;
    remote.hidden = false;
  } else if (state.connectionState === "connecting" || state.connectionState === "new") {
    peerState.textContent = "Подключение к собеседнику…";
  } else {
    peerState.textContent = "Собеседник ещё не подключился";
  }
}

function setConnectingPanel(peerName, consentLocked) {
  const title = document.getElementById("panel-title");
  const consent = document.getElementById("consent");
  const consentWrap = document.getElementById("consent-wrap");
  const peerLine = document.getElementById("peer-line");
  if (title) title.textContent = "Подключение к собеседнику…";
  if (peerLine && peerName) {
    peerLine.hidden = false;
    peerLine.textContent = `Собеседник: ${peerName}`;
  }
  if (consentLocked && consent) {
    consent.checked = true;
    consent.disabled = true;
    if (consentWrap) consentWrap.style.opacity = "0.85";
  }
}

function setLivePanel(peerName) {
  const title = document.getElementById("panel-title");
  const peerLine = document.getElementById("peer-line");
  if (title) title.textContent = "В эфире";
  if (peerLine && peerName) {
    peerLine.hidden = false;
    peerLine.textContent = `Собеседник: ${peerName}`;
  }
}

let roomPeerName = "";
let roomLiveUi = false;

function applyLiveUiIfReady(state, peerName) {
  if (roomLiveUi || !state.peerConnected) return;
  roomLiveUi = true;
  setLivePanel(peerName || roomPeerName);
  setBanner("Эфир — соединение с собеседником установлено", true);
}

async function handleRemoteEnded() {
  if (callSession) {
    await callSession.endLocalSide().catch(() => {});
    callSession = null;
  }
  clearInterval(timerTick);
  try {
    const info = await HandCheck.api(`/api/calls/for-invitation/${invitationId}`);
    renderEndedView(info, roomMe);
  } catch {
    location.reload();
  }
}

function bindRoomControls(info, me) {
  const consent = document.getElementById("consent");
  const join = document.getElementById("join");
  const endBtn = document.getElementById("end");
  const video = document.getElementById("local");
  const remote = document.getElementById("remote");
  const roomErr = document.getElementById("room-err");
  const placeholder = document.getElementById("video-placeholder");
  const timerEl = document.getElementById("timer");

  join.disabled = true;

  consent.addEventListener("change", () => {
    join.disabled = !consent.checked;
  });

  const peerName =
    me.role === "employer" ? info.candidateName || "кандидат" : info.companyName || "компания";

  join.onclick = async () => {
    if (!consent.checked || join.disabled) return;
    roomErr.hidden = true;
    join.disabled = true;
    try {
      await HandCheck.api(`/api/calls/${callId}/consent`, {
        method: "POST",
        body: JSON.stringify({ accepted: true }),
      });
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        roomErr.hidden = false;
        roomErr.textContent =
          "Не удалось включить камеру или микрофон. Разрешите доступ в настройках браузера и повторите вход.";
        join.disabled = !consent.checked;
        return;
      }
      await HandCheck.api(`/api/calls/${callId}/start`, { method: "POST" });

      callSession = HandCheckCallRoom.createCallSession({
        callId,
        role: me.role,
        invitationId,
        onPeerEnded: () => {
          handleRemoteEnded();
        },
        onState: (state) => {
          const preparing =
            !state.recording &&
            !state.recordingUnavailable &&
            callSession &&
            document.getElementById("end") &&
            !document.getElementById("end").hidden;
          updateRecordingLabel({ ...state, recordingPreparing: preparing });
          updatePeerUi(state);
          applyLiveUiIfReady(state, peerName);
          const rs = callSession?.getRemoteStream();
          if (rs && remote && state.peerConnected) {
            if (remote.srcObject !== rs) remote.srcObject = rs;
          }
        },
      });
      await callSession.attachLocalMedia(stream);
      video.srcObject = stream;
      video.hidden = false;
      placeholder.hidden = true;
      video.classList.add("live");

      roomPeerName = peerName;
      roomLiveUi = false;
      setConnectingPanel(peerName, true);
      setCallLede(
        "Ожидаем собеседника. Запись начнётся после появления данных — индикатор «Запись активна» включится только при реальной записи."
      );
      setBanner("Подключение — ждём собеседника в комнате", false);
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

      await callSession.enterLive(invitationId);
    } catch (e) {
      roomErr.hidden = false;
      roomErr.textContent = HandCheck.formatApiError(e);
      join.disabled = !consent.checked;
    }
  };

  endBtn.onclick = async () => {
    endBtn.disabled = true;
    roomErr.hidden = true;
    try {
      if (callSession) {
        await callSession.endLocalSide();
        callSession = null;
      }
      await HandCheck.api(`/api/calls/${callId}/end`, { method: "POST" });
      clearInterval(timerTick);
      location.href = `/call/${invitationId}`;
    } catch (e) {
      endBtn.disabled = false;
      roomErr.hidden = false;
      roomErr.textContent = HandCheck.formatApiError(e);
    }
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
    const [info, me] = await Promise.all([
      HandCheck.api(`/api/calls/for-invitation/${invitationId}`),
      HandCheck.api("/api/me"),
    ]);
    roomInfo = info;
    roomMe = me;
    callId = info.callId;
    if (info.status === "ended") {
      renderEndedView(info, me);
      return;
    }
    HandCheck.bootCabinetPage(me.role, () => {});
    const heroTitle = document.querySelector(".call-room-hero h1");
    if (heroTitle) {
      const prefix = me.role === "employer" ? "Звонок с кандидатом: " : "Звонок с ";
      const name =
        me.role === "employer"
          ? info.candidateName || "кандидатом"
          : info.companyName || "компанией";
      heroTitle.textContent = prefix + name;
    }
    const peerLabel =
      me.role === "employer" ? info.candidateName || "Кандидат" : info.companyName || "Работодатель";
    renderRoomShell(peerLabel);
    if (info.status === "live") {
      setCallLede(
        "Разговор уже идёт. Подтвердите согласие и войдите — камера включится перед подключением."
      );
    } else {
      setCallLede(
        "Согласие на запись обязательно. После принятого приглашения войдите в комнату и подтвердите запись."
      );
    }
    setBanner(
      info.status === "live"
        ? "Эфир — ожидаем второго участника"
        : "Комната готова — подтвердите согласие и войдите",
      info.status === "live"
    );
    const { consent } = bindRoomControls(info, me);
    const hasConsent =
      (me.role === "candidate" && info.consentCandidate) ||
      (me.role === "employer" && info.consentEmployer);
    if (hasConsent) {
      consent.checked = true;
      document.getElementById("join").disabled = false;
    }
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
