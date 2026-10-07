/* global HandCheck */
(function () {
  function esc(s) {
    return HandCheck.escapeHtml(s);
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
      body = `<ul>${(current.options || [])
        .map(
          (o) =>
            `<li><label><input type="${input}" name="ct-choice" value="${esc(o.id)}" /> ${esc(o.label)}</label></li>`
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

  async function mountCompanyTestsPanel() {
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
          .map(
            (a) => `<li>
            <button type="button" class="employer-tests-list-btn" data-open-assignment="${esc(a.id)}">
              <span><strong>${esc(a.companyName)}</strong> — ${esc(a.title)}</span>
              <span class="invite-meta">${esc(a.status)} · до ${esc(new Date(a.dueAt).toLocaleDateString("ru-RU"))}</span>
            </button>
          </li>`
          )
          .join("")}
      </ul>
      <div id="company-test-active"></div>`;
    host.querySelectorAll("[data-open-assignment]").forEach((btn) => {
      btn.addEventListener("click", () => openAssignment(btn.dataset.openAssignment));
    });
  }

  let pasteChars = 0;
  let typedChars = 0;

  async function openAssignment(id) {
    const active = document.getElementById("company-test-active");
    if (!active) return;
    active.innerHTML = HandCheck.skeletonBlocks(1);
    await HandCheck.api(`/api/candidate/company-tests/${id}/start`, { method: "POST", body: "{}" });
    const state = await HandCheck.api(`/api/candidate/company-tests/${id}`);
    active.innerHTML = renderTakeUi(state);
    bindTakeUi(id, state);
  }

  function bindTakeUi(assignmentId, state) {
    const timerEl = document.getElementById("company-test-timer");
    if (timerEl?.dataset.deadline) {
      const deadline = new Date(timerEl.dataset.deadline).getTime();
      const tick = () => {
        const left = deadline - Date.now();
        timerEl.textContent = left > 0 ? `⏱ ${Math.ceil(left / 1000)} с` : "⏱ время вышло";
      };
      tick();
      setInterval(tick, 500);
    }
    const ta = document.getElementById("company-test-answer");
    if (ta && window.AssessmentInputClassify) {
      ta.addEventListener("paste", () => {
        pasteChars += (ta.value || "").length;
      });
      ta.addEventListener("input", () => {
        typedChars += 1;
      });
    }
    document.getElementById("company-test-answer-submit")?.addEventListener("click", async () => {
      const current = state.items.find((it) => it.id === state.currentItemId);
      if (!current) return;
      let body = { itemId: current.id, pasteChars, typedChars };
      if (current.kind === "single") {
        const picked = document.querySelector('input[name="ct-choice"]:checked');
        body.choiceId = picked?.value;
      } else if (current.kind === "multi") {
        body.choiceIds = [...document.querySelectorAll('input[name="ct-choice"]:checked')].map(
          (el) => el.value
        );
      } else {
        body.answerText = ta?.value || "";
      }
      try {
        await HandCheck.api(`/api/candidate/company-tests/${assignmentId}/answers`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        pasteChars = 0;
        typedChars = 0;
        const next = await HandCheck.api(`/api/candidate/company-tests/${assignmentId}`);
        const active = document.getElementById("company-test-active");
        active.innerHTML = renderTakeUi(next);
        bindTakeUi(assignmentId, next);
      } catch (e) {
        HandCheck.toast(HandCheck.formatApiError(e), "error");
      }
    });
    document.getElementById("company-test-final-submit")?.addEventListener("click", async () => {
      await HandCheck.api(`/api/candidate/company-tests/${assignmentId}/submit`, {
        method: "POST",
        body: "{}",
      });
      HandCheck.toast("Тест отправлен", "success");
      await mountCompanyTestsPanel();
    });
  }

  window.HandCheckCompanyTests = { mountCompanyTestsPanel };
})();
