/* global HandCheck, HandCheckInputClassify */
(function () {
  let timerInterval = null;
  let telemetry = { pasteChars: 0, typedChars: 0, pendingPaste: 0, trackedLen: 0 };

  function esc(s) {
    return HandCheck.escapeHtml(s);
  }

  function resetTelemetry() {
    telemetry = { pasteChars: 0, typedChars: 0, pendingPaste: 0, trackedLen: 0 };
  }

  function clearTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function actionLabel(status) {
    if (status === "assigned") return "Начать";
    if (status === "started") return "Продолжить";
    return null;
  }

  function renderTakeUi(state) {
    const current = state.items.find((it) => it.id === state.currentItemId);
    if (!current || current.submitted) {
      const next = state.items.find((it) => !it.submitted);
      if (!next) {
        return `<p class="invite-meta">Все вопросы отвечены. Нажмите «Сдать тест».</p>
          <button type="button" class="btn-primary" id="company-test-final-submit">Сдать тест</button>`;
      }
      return `<p class="loading"><span class="loading-dot"></span>Загрузка вопроса…</p>`;
    }
    let body = "";
    if (current.kind === "single" || current.kind === "multi") {
      const input = current.kind === "single" ? "radio" : "checkbox";
      body = `<ul class="company-test-choice-list">${(current.options || [])
        .map(
          (o) =>
            `<li><label class="choice-option"><input type="${input}" name="ct-choice" value="${esc(o.id)}" /> <span>${esc(o.label)}</span></label></li>`
        )
        .join("")}</ul>`;
    } else if (current.kind === "code") {
      body = `<textarea id="company-test-answer" class="employer-test-code-preview" rows="8"></textarea>`;
    } else {
      body = `<textarea id="company-test-answer" rows="5"></textarea>`;
    }
    const timer = current.deadlineAt
      ? `<p class="invite-meta" id="company-test-timer" data-deadline="${esc(current.deadlineAt)}">⏱ …</p>`
      : "";
    return `<article class="employer-test-preview-card">
      <h3>${esc(state.title)}</h3>
      <p>${esc(current.prompt)}</p>
      ${timer}
      ${body}
      <button type="button" class="btn-primary" id="company-test-answer-submit">Ответить</button>
    </article>`;
  }

  function attachTextTelemetry(ta) {
    if (!ta) return;
    resetTelemetry();
    ta.addEventListener("paste", (ev) => {
      const clip = ev.clipboardData?.getData("text") || "";
      telemetry.pasteChars += clip.length;
    });
    ta.addEventListener("input", (ev) => {
      if (typeof InputEvent === "undefined" || !(ev instanceof InputEvent)) return;
      const inputType = typeof ev.inputType === "string" ? ev.inputType : "";
      if (inputType === "insertFromPaste" || inputType === "insertFromDrop") return;
      if (inputType === "insertText" || inputType === "insertCompositionText") {
        telemetry.typedChars += (ev.data || "").length;
      }
    });
  }

  async function mountCompanyTestsPanel() {
    clearTimer();
    const host = document.getElementById("company-tests-panel");
    if (!host) return;
    host.innerHTML = `<h2 class="h3">Задания от компаний</h2><p class="loading"><span class="loading-dot"></span>Загрузка…</p>`;
    const data = await HandCheck.api("/api/candidate/company-tests");
    const items = data.items || [];
    if (!items.length) {
      host.innerHTML = `<h2 class="h3">Задания от компаний</h2><p class="invite-meta">Пока нет тестов от работодателей.</p>`;
      return;
    }
    host.innerHTML = `<h2 class="h3">Задания от компаний</h2>
      <ul class="company-tests-assign-list">
        ${items
          .map((a) => {
            const label = a.statusLabel || a.status;
            const action = actionLabel(a.status);
            const btn = action
              ? `<button type="button" class="btn-primary btn-sm" data-company-test-action="${esc(a.status)}" data-assignment-id="${esc(a.id)}">${action}</button>`
              : "";
            return `<li class="company-tests-assign-row">
            <div class="company-tests-assign-main">
              <span><strong>${esc(a.companyName)}</strong> — ${esc(a.title)}</span>
              <span class="invite-meta">${esc(label)} · до ${esc(new Date(a.dueAt).toLocaleDateString("ru-RU"))}</span>
            </div>
            ${btn}
          </li>`;
          })
          .join("")}
      </ul>
      <div id="company-test-active"></div>`;
    host.querySelectorAll("[data-company-test-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.assignmentId;
        const action = btn.dataset.companyTestAction;
        if (action === "assigned") beginAssignment(id);
        else if (action === "started") continueAssignment(id);
      });
    });
  }

  function syncListActionForAssignment(assignmentId, hideStart) {
    document.querySelectorAll(`[data-assignment-id="${assignmentId}"]`).forEach((btn) => {
      if (!btn.matches("[data-company-test-action]")) return;
      if (hideStart) {
        btn.hidden = true;
        return;
      }
      const status = btn.dataset.companyTestAction;
      const label = actionLabel(status);
      if (label) {
        btn.textContent = label;
        btn.hidden = false;
      } else {
        btn.hidden = true;
      }
    });
  }

  async function loadTakeState(assignmentId, { start } = {}) {
    const active = document.getElementById("company-test-active");
    if (!active) return;
    active.innerHTML = HandCheck.skeletonBlocks(1);
    if (start) {
      await HandCheck.api(`/api/candidate/company-tests/${assignmentId}/start`, {
        method: "POST",
        body: "{}",
      });
      syncListActionForAssignment(assignmentId, true);
    }
    const state = await HandCheck.api(`/api/candidate/company-tests/${assignmentId}`);
    active.innerHTML = renderTakeUi(state);
    bindTakeUi(assignmentId, state);
    if (state.status === "started") syncListActionForAssignment(assignmentId, true);
  }

  function beginAssignment(id) {
    return loadTakeState(id, { start: true });
  }

  function continueAssignment(id) {
    return loadTakeState(id, { start: false });
  }

  async function submitCurrentAnswer(assignmentId, state) {
    const current = state.items.find((it) => it.id === state.currentItemId);
    if (!current) return;
    const ta = document.getElementById("company-test-answer");
    let body = {
      itemId: current.id,
      pasteChars: telemetry.pasteChars,
      typedChars: telemetry.typedChars,
    };
    if (current.kind === "single") {
      const picked = document.querySelector('input[name="ct-choice"]:checked');
      body.choiceId = picked?.value;
    } else if (current.kind === "multi") {
      body.choiceIds = [...document.querySelectorAll('input[name="ct-choice"]:checked')].map((el) => el.value);
    } else {
      body.answerText = ta?.value || "";
    }
    await HandCheck.api(`/api/candidate/company-tests/${assignmentId}/answers`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    resetTelemetry();
    clearTimer();
    const next = await HandCheck.api(`/api/candidate/company-tests/${assignmentId}`);
    const active = document.getElementById("company-test-active");
    active.innerHTML = renderTakeUi(next);
    bindTakeUi(assignmentId, next);
  }

  function bindTakeUi(assignmentId, state) {
    clearTimer();
    const ta = document.getElementById("company-test-answer");
    attachTextTelemetry(ta);

    const timerEl = document.getElementById("company-test-timer");
    if (timerEl?.dataset.deadline) {
      const deadline = new Date(timerEl.dataset.deadline).getTime();
      const tick = () => {
        const left = deadline - Date.now();
        if (left <= 0) {
          clearTimer();
          timerEl.textContent = "⏱ время вышло";
          void submitCurrentAnswer(assignmentId, state).catch((e) =>
            HandCheck.toast(HandCheck.formatApiError(e), "error")
          );
          return;
        }
        timerEl.textContent = `⏱ ${Math.ceil(left / 1000)} с`;
      };
      tick();
      timerInterval = setInterval(tick, 500);
    }

    document.getElementById("company-test-answer-submit")?.addEventListener("click", () => {
      void submitCurrentAnswer(assignmentId, state).catch((e) =>
        HandCheck.toast(HandCheck.formatApiError(e), "error")
      );
    });
    document.getElementById("company-test-final-submit")?.addEventListener("click", async () => {
      await HandCheck.api(`/api/candidate/company-tests/${assignmentId}/submit`, {
        method: "POST",
        body: "{}",
      });
      HandCheck.toast("Тест отправлен", "success");
      clearTimer();
      await mountCompanyTestsPanel();
    });
  }

  window.HandCheckCompanyTests = { mountCompanyTestsPanel, beginAssignment, continueAssignment };
})();
