/* global HandCheck */
(function () {
  const root = document.getElementById("root");
  const esc = HandCheck.escapeHtml;
  const STATUS_LABEL = { draft: "Черновик", published: "Опубликован", archived: "В архиве" };
  const KIND_LABEL = { text: "Текст", single: "Один вариант", multi: "Несколько", code: "Код" };

  let config = { llmConfigured: false, templates: [] };
  let groups = [];
  let needs = [];
  let activeTestId = null;
  let editor = null;
  let saveTimer = null;
  let saving = false;

  function statusPill(status) {
    const cls =
      status === "published" ? "status-pill accepted" : status === "draft" ? "status-pill" : "status-pill declined";
    return `<span class="${cls}">${esc(STATUS_LABEL[status] || status)}</span>`;
  }

  async function loadList() {
    activeTestId = null;
    editor = null;
    const seq = HandCheck.nextCabinetPageLoad();
    root.innerHTML = HandCheck.skeletonBlocks(3);
    const [listData, needsData, cfg] = await Promise.all([
      HandCheck.api("/api/employer/tests"),
      HandCheck.api("/api/employer/needs"),
      HandCheck.api("/api/employer/tests/config"),
    ]);
    if (HandCheck.isStaleCabinetPageLoad(seq)) return;
    groups = listData.groups || [];
    needs = needsData.items || [];
    config = cfg;
    paintList();
  }

  function paintList() {
    const tplBlock =
      config.templates?.length
        ? `<section class="employer-tests-templates panel-inset">
        <h2 class="h3">Шаблоны</h2>
        <p class="invite-meta">Создайте тест из готового набора вопросов — потом отредактируйте под вакансию.</p>
        <div class="employer-tests-template-grid">${config.templates
          .map(
            (t) => `<article class="employer-tests-template-card">
            <h3>${esc(t.title)}</h3>
            <p class="invite-meta">${esc(t.intro)}</p>
            <p class="invite-meta">${t.itemCount} вопросов</p>
            <button type="button" class="btn-primary btn-sm" data-template-create="${esc(t.key)}">Создать из шаблона</button>
          </article>`
          )
          .join("")}</div>
      </section>`
        : "";

    const groupHtml = groups.length
      ? groups
          .map(
            (g) => `<section class="employer-tests-group">
          <h2 class="h3">${esc(g.needTitle)}</h2>
          <ul class="employer-tests-list">
            ${g.tests
              .map(
                (t) => `<li>
              <button type="button" class="employer-tests-list-btn" data-open-test="${esc(t.id)}">
                <span class="employer-tests-list-title">${esc(t.title)}</span>
                ${statusPill(t.status)}
              </button>
            </li>`
              )
              .join("")}
          </ul>
        </section>`
          )
          .join("")
      : `<p class="empty">Пока нет тестов — создайте черновик или выберите шаблон.</p>`;

    root.innerHTML = `${tplBlock}
      <div class="employer-tests-toolbar">
        <label class="form-label">Потребность для нового теста
          <select id="new-test-need">${needs.map((n) => `<option value="${esc(n.id)}">${esc(n.title)}</option>`).join("")}</select>
        </label>
        <button type="button" class="btn-primary" id="new-test-blank">Новый черновик</button>
      </div>
      ${groupHtml}`;

    root.querySelector("#new-test-blank")?.addEventListener("click", createBlank);
    root.querySelectorAll("[data-template-create]").forEach((btn) => {
      btn.addEventListener("click", () => createFromTemplate(btn.dataset.templateCreate));
    });
    root.querySelectorAll("[data-open-test]").forEach((btn) => {
      btn.addEventListener("click", () => openEditor(btn.dataset.openTest));
    });
  }

  async function createBlank() {
    const needId = root.querySelector("#new-test-need")?.value;
    const title = window.prompt("Название теста", "Новый тест");
    if (!title?.trim()) return;
    const res = await HandCheck.api("/api/employer/tests", {
      method: "POST",
      body: JSON.stringify({ needId, title: title.trim(), intro: "" }),
    });
    await openEditor(res.id);
  }

  async function createFromTemplate(templateKey) {
    const needId = root.querySelector("#new-test-need")?.value;
    const res = await HandCheck.api("/api/employer/tests", {
      method: "POST",
      body: JSON.stringify({ needId, templateKey }),
    });
    await openEditor(res.id);
  }

  async function openEditor(testId) {
    activeTestId = testId;
    const seq = HandCheck.nextCabinetPageLoad();
    root.innerHTML = HandCheck.skeletonBlocks(4);
    const data = await HandCheck.api(`/api/employer/tests/${testId}`);
    if (HandCheck.isStaleCabinetPageLoad(seq)) return;
    editor = { test: data.test, items: data.items || [] };
    paintEditor();
  }

  function scheduleMetaSave() {
    if (!editor || editor.test.status !== "draft") return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveMeta, 600);
  }

  async function saveMeta() {
    if (!editor || saving) return;
    saving = true;
    try {
      await HandCheck.api(`/api/employer/tests/${activeTestId}`, {
        method: "PUT",
        body: JSON.stringify({
          title: editor.test.title,
          intro: editor.test.intro,
          needId: editor.test.needId,
        }),
      });
      HandCheck.toast("Черновик сохранён", "success", { duration: 1200 });
    } catch (e) {
      HandCheck.toast(HandCheck.errorMessage(e), "error");
    } finally {
      saving = false;
    }
  }

  async function saveItem(item) {
    await HandCheck.api(`/api/employer/tests/${activeTestId}/items/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({
        kind: item.kind,
        prompt: item.prompt,
        options: item.options,
        answerKey: item.answerKey,
        rubricKeys: item.rubricKeys,
        timeLimitSec: item.timeLimitSec,
      }),
    });
  }

  function previewHtml(items) {
    return items
      .map((it, idx) => {
        let body = "";
        if (it.kind === "single" || it.kind === "multi") {
          const input = it.kind === "single" ? "radio" : "checkbox";
          body = `<ul class="employer-test-preview-choices">${(it.options || [])
            .map(
              (o) => `<li><label><input type="${input}" disabled name="p${idx}" /> ${esc(o.label)}</label></li>`
            )
            .join("")}</ul>`;
        } else if (it.kind === "code") {
          body = `<textarea class="employer-test-code-preview" rows="5" disabled placeholder="Код…"></textarea>`;
        } else {
          body = `<textarea class="employer-test-text-preview" rows="3" disabled placeholder="Ответ…"></textarea>`;
        }
        const timer = it.timeLimitSec
          ? `<span class="invite-meta">⏱ ${Math.round(it.timeLimitSec / 60) || 1} мин</span>`
          : "";
        return `<article class="employer-test-preview-card"><h4>Вопрос ${idx + 1} ${timer}</h4><p>${esc(it.prompt)}</p>${body}</article>`;
      })
      .join("");
  }

  function itemCard(it, index, editable) {
    const optionsHtml =
      it.kind === "single" || it.kind === "multi"
        ? `<div class="employer-test-options" data-item-options="${esc(it.id)}">
        ${(it.options || [])
          .map(
            (o, oi) => `<div class="employer-test-option-row">
            <input type="text" class="employer-test-opt-label" data-opt-id="${esc(o.id)}" value="${esc(o.label)}" ${editable ? "" : "disabled"} />
            <label class="employer-test-opt-correct"><input type="${it.kind === "single" ? "radio" : "checkbox"}" name="correct-${esc(it.id)}" value="${esc(o.id)}" ${(it.answerKey?.correctIds || []).includes(o.id) ? "checked" : ""} ${editable ? "" : "disabled"} /> верно</label>
          </div>`
          )
          .join("")}
        ${editable ? `<button type="button" class="btn-ghost btn-sm" data-add-option="${esc(it.id)}">+ вариант</button>` : ""}
      </div>`
        : "";

    const rubricHtml =
      it.kind === "text" || it.kind === "code"
        ? `<label class="form-label">Ключевые слова (через запятую)
        <input type="text" class="employer-test-keywords" data-item-kw="${esc(it.id)}" value="${esc((it.rubricKeys?.keywords || []).join(", "))}" ${editable ? "" : "disabled"} />
      </label>`
        : "";

    return `<article class="employer-test-item-card" draggable="${editable ? "true" : "false"}" data-item-id="${esc(it.id)}">
      <div class="employer-test-item-head">
        <span class="employer-test-drag-handle" aria-hidden="true">⋮⋮</span>
        <span class="invite-meta">#${index + 1} · ${esc(KIND_LABEL[it.kind] || it.kind)}</span>
        <div class="employer-test-item-actions">
          <button type="button" class="btn-ghost btn-sm" data-move-up="${esc(it.id)}" ${index === 0 || !editable ? "disabled" : ""} aria-label="Выше">↑</button>
          <button type="button" class="btn-ghost btn-sm" data-move-down="${esc(it.id)}" ${!editable ? "disabled" : ""} aria-label="Ниже">↓</button>
          ${editable ? `<button type="button" class="btn-ghost btn-sm" data-del-item="${esc(it.id)}">Удалить</button>` : ""}
        </div>
      </div>
      <label class="form-label">Тип
        <select class="employer-test-kind" data-item-kind="${esc(it.id)}" ${editable ? "" : "disabled"}>
          ${Object.keys(KIND_LABEL)
            .map((k) => `<option value="${k}"${it.kind === k ? " selected" : ""}>${KIND_LABEL[k]}</option>`)
            .join("")}
        </select>
      </label>
      <label class="form-label">Вопрос
        <textarea class="employer-test-prompt" rows="3" data-item-prompt="${esc(it.id)}" ${editable ? "" : "disabled"}>${esc(it.prompt)}</textarea>
      </label>
      ${optionsHtml}
      ${rubricHtml}
      <label class="form-label">Лимит (сек)
        <input type="number" class="employer-test-timer" min="30" max="3600" step="30" data-item-timer="${esc(it.id)}" value="${it.timeLimitSec || ""}" ${editable ? "" : "disabled"} />
      </label>
    </article>`;
  }

  function paintEditor() {
    const t = editor.test;
    const editable = t.status === "draft";
    const genBtn =
      config.llmConfigured && editable
        ? `<button type="button" class="btn-ghost" id="gen-llm">Сгенерировать черновик</button>`
        : "";

    root.innerHTML = `<div class="employer-tests-editor">
      <div class="employer-tests-editor-main">
        <button type="button" class="btn-ghost employer-tests-back" id="back-list">← К списку</button>
        <div class="employer-tests-editor-head">
          <input type="text" class="employer-tests-title-input" id="test-title" value="${esc(t.title)}" ${editable ? "" : "readonly"} />
          ${statusPill(t.status)}
        </div>
        <label class="form-label">Вступление для кандидата
          <textarea id="test-intro" rows="2" ${editable ? "" : "readonly"}>${esc(t.intro)}</textarea>
        </label>
        <label class="form-label">Потребность
          <select id="test-need" ${editable ? "" : "disabled"}>${needs
            .map((n) => `<option value="${esc(n.id)}"${n.id === t.needId ? " selected" : ""}>${esc(n.title)}</option>`)
            .join("")}</select>
        </label>
        <div class="employer-tests-editor-actions">
          ${editable ? `<button type="button" class="btn-ghost" id="add-item">+ Вопрос</button>` : ""}
          ${genBtn}
          ${editable ? `<button type="button" class="btn-primary" id="publish-test">Опубликовать</button>` : ""}
          ${t.status !== "archived" ? `<button type="button" class="btn-ghost" id="archive-test">В архив</button>` : ""}
        </div>
        <div class="employer-test-items" id="item-list">${editor.items.map((it, i) => itemCard(it, i, editable)).join("")}</div>
      </div>
      <aside class="employer-tests-preview panel-inset" aria-label="Как увидит кандидат">
        <h2 class="h3">Превью</h2>
        <p class="invite-meta">${esc(t.intro)}</p>
        <div id="preview-pane">${previewHtml(editor.items)}</div>
      </aside>
    </div>`;

    root.querySelector("#back-list")?.addEventListener("click", loadList);
    root.querySelector("#test-title")?.addEventListener("input", (e) => {
      editor.test.title = e.target.value;
      scheduleMetaSave();
    });
    root.querySelector("#test-intro")?.addEventListener("input", (e) => {
      editor.test.intro = e.target.value;
      scheduleMetaSave();
      root.querySelector("#preview-pane")?.previousElementSibling?.textContent = e.target.value;
    });
    root.querySelector("#test-need")?.addEventListener("change", (e) => {
      editor.test.needId = e.target.value;
      scheduleMetaSave();
    });
    root.querySelector("#add-item")?.addEventListener("click", addItem);
    root.querySelector("#publish-test")?.addEventListener("click", publishTest);
    root.querySelector("#archive-test")?.addEventListener("click", archiveTest);
    root.querySelector("#gen-llm")?.addEventListener("click", generateLlm);
    bindItemEditors(editable);
    if (editable) bindDragReorder();
  }

  function bindItemEditors(editable) {
    if (!editable) return;
    const list = root.querySelector("#item-list");
    list?.querySelectorAll("[data-item-prompt]").forEach((el) => {
      el.addEventListener("input", () => debounceItemSave(el.dataset.itemPrompt));
    });
    list?.querySelectorAll("[data-item-kind]").forEach((el) => {
      el.addEventListener("change", () => onKindChange(el.dataset.itemKind, el.value));
    });
    list?.querySelectorAll("[data-item-timer]").forEach((el) => {
      el.addEventListener("change", () => debounceItemSave(el.dataset.itemTimer));
    });
    list?.querySelectorAll("[data-item-kw]").forEach((el) => {
      el.addEventListener("change", () => debounceItemSave(el.dataset.itemKw));
    });
    list?.querySelectorAll(".employer-test-opt-label").forEach((el) => {
      el.addEventListener("change", () => debounceItemSave(el.closest("[data-item-id]")?.dataset.itemId));
    });
    list?.querySelectorAll(".employer-test-opt-correct input").forEach((el) => {
      el.addEventListener("change", () => debounceItemSave(el.name.replace("correct-", "")));
    });
    list?.querySelectorAll("[data-add-option]").forEach((btn) => {
      btn.addEventListener("click", () => addOption(btn.dataset.addOption));
    });
    list?.querySelectorAll("[data-del-item]").forEach((btn) => {
      btn.addEventListener("click", () => deleteItem(btn.dataset.delItem));
    });
    list?.querySelectorAll("[data-move-up]").forEach((btn) => {
      btn.addEventListener("click", () => moveItem(btn.dataset.moveUp, -1));
    });
    list?.querySelectorAll("[data-move-down]").forEach((btn) => {
      btn.addEventListener("click", () => moveItem(btn.dataset.moveDown, 1));
    });
  }

  const itemSaveTimers = new Map();
  function debounceItemSave(itemId) {
    if (!itemId) return;
    clearTimeout(itemSaveTimers.get(itemId));
    itemSaveTimers.set(
      itemId,
      setTimeout(() => flushItemFromDom(itemId).catch((e) => HandCheck.toast(HandCheck.errorMessage(e), "error")), 500)
    );
  }

  function readItemFromDom(itemId) {
    const card = root.querySelector(`[data-item-id="${itemId}"]`);
    const item = editor.items.find((x) => x.id === itemId);
    if (!card || !item) return null;
    item.kind = card.querySelector(`[data-item-kind="${itemId}"]`)?.value || item.kind;
    item.prompt = card.querySelector(`[data-item-prompt="${itemId}"]`)?.value || "";
    const timerVal = card.querySelector(`[data-item-timer="${itemId}"]`)?.value;
    item.timeLimitSec = timerVal ? Number(timerVal) : null;
    if (item.kind === "text" || item.kind === "code") {
      const kw = card.querySelector(`[data-item-kw="${itemId}"]`)?.value || "";
      item.rubricKeys = { keywords: kw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean) };
      item.options = [];
      item.answerKey = {};
    } else {
      const rows = card.querySelectorAll(".employer-test-option-row");
      item.options = [];
      const correct = [];
      rows.forEach((row, i) => {
        const id = row.querySelector("[data-opt-id]")?.dataset.optId || `opt${i + 1}`;
        const label = row.querySelector(".employer-test-opt-label")?.value || "";
        item.options.push({ id, label });
        if (row.querySelector(".employer-test-opt-correct input")?.checked) correct.push(id);
      });
      item.answerKey = { correctIds: correct };
      item.rubricKeys = {};
    }
    return item;
  }

  async function flushItemFromDom(itemId) {
    const item = readItemFromDom(itemId);
    if (!item) return;
    await saveItem(item);
    root.querySelector("#preview-pane").innerHTML = previewHtml(editor.items);
  }

  async function onKindChange(itemId, kind) {
    const item = editor.items.find((x) => x.id === itemId);
    if (!item) return;
    item.kind = kind;
    if (kind === "single" || kind === "multi") {
      if (!item.options?.length) {
        item.options = [{ id: "a", label: "Вариант A" }, { id: "b", label: "Вариант B" }];
        item.answerKey = { correctIds: ["a"] };
      }
    }
    paintEditor();
    await saveItem(item);
  }

  async function addItem() {
    const res = await HandCheck.api(`/api/employer/tests/${activeTestId}/items`, {
      method: "POST",
      body: JSON.stringify({
        kind: "text",
        prompt: "Новый вопрос",
        rubricKeys: { keywords: ["ответ"] },
        timeLimitSec: 120,
      }),
    });
    editor.items.push(res.item);
    paintEditor();
  }

  async function addOption(itemId) {
    const item = readItemFromDom(itemId);
    const next = String.fromCharCode(97 + (item.options?.length || 0));
    item.options.push({ id: next, label: `Вариант ${next.toUpperCase()}` });
    await saveItem(item);
    paintEditor();
  }

  async function deleteItem(itemId) {
    await HandCheck.api(`/api/employer/tests/${activeTestId}/items/${itemId}`, { method: "DELETE" });
    editor.items = editor.items.filter((x) => x.id !== itemId);
    paintEditor();
  }

  async function moveItem(itemId, delta) {
    const idx = editor.items.findIndex((x) => x.id === itemId);
    const j = idx + delta;
    if (idx < 0 || j < 0 || j >= editor.items.length) return;
    const copy = [...editor.items];
    const [row] = copy.splice(idx, 1);
    copy.splice(j, 0, row);
    editor.items = copy;
    paintEditor();
    await HandCheck.api(`/api/employer/tests/${activeTestId}/items/reorder`, {
      method: "POST",
      body: JSON.stringify({ order: editor.items.map((x) => x.id) }),
    });
  }

  function bindDragReorder() {
    const list = root.querySelector("#item-list");
    if (!list) return;
    let dragId = null;
    list.querySelectorAll(".employer-test-item-card").forEach((card) => {
      card.addEventListener("dragstart", (e) => {
        dragId = card.dataset.itemId;
        card.classList.add("employer-test-item-dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("employer-test-item-dragging");
        dragId = null;
      });
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragId || dragId === card.dataset.itemId) return;
        const rect = card.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        card.classList.toggle("employer-test-drop-after", after);
        card.classList.toggle("employer-test-drop-before", !after);
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("employer-test-drop-after", "employer-test-drop-before");
      });
      card.addEventListener("drop", async (e) => {
        e.preventDefault();
        card.classList.remove("employer-test-drop-after", "employer-test-drop-before");
        const targetId = card.dataset.itemId;
        if (!dragId || dragId === targetId) return;
        const from = editor.items.findIndex((x) => x.id === dragId);
        let to = editor.items.findIndex((x) => x.id === targetId);
        const after = card.classList.contains("employer-test-drop-after");
        if (from < 0 || to < 0) return;
        const copy = [...editor.items];
        const [row] = copy.splice(from, 1);
        if (from < to) to -= 1;
        if (after) to += 1;
        copy.splice(to, 0, row);
        editor.items = copy;
        paintEditor();
        await HandCheck.api(`/api/employer/tests/${activeTestId}/items/reorder`, {
          method: "POST",
          body: JSON.stringify({ order: editor.items.map((x) => x.id) }),
        });
      });
    });
  }

  async function publishTest() {
    await saveMeta();
    for (const it of editor.items) await saveItem(it);
    await HandCheck.api(`/api/employer/tests/${activeTestId}/publish`, { method: "POST", body: "{}" });
    HandCheck.toast("Тест опубликован", "success");
    await openEditor(activeTestId);
  }

  async function archiveTest() {
    await HandCheck.api(`/api/employer/tests/${activeTestId}`, { method: "DELETE" });
    HandCheck.toast("Тест в архиве", "success");
    await loadList();
  }

  async function generateLlm() {
    await HandCheck.api(`/api/employer/tests/${activeTestId}/generate`, {
      method: "POST",
      body: "{}",
      headers: { "x-demo-admin": "1" },
    });
    HandCheck.toast("Вопросы добавлены", "success");
    await openEditor(activeTestId);
  }

  async function boot() {
    HandCheck.employerNav();
    needs = (await HandCheck.api("/api/employer/needs")).items || [];
    await loadList();
  }

  HandCheck.bootCabinetPage("employer", () => boot());
})();
