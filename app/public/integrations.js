(function () {
  const SCOPE_LABELS = { read: "чтение", write: "запись" };

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function scopeLabelList(scopes) {
    return (scopes || []).map((s) => SCOPE_LABELS[s] || s).join(", ");
  }

  function filledCursorSnippet(cfg, token) {
    const snippet = JSON.parse(JSON.stringify(cfg.cursorSnippet));
    snippet.mcpServers.handcheck.headers.Authorization = `Bearer ${token}`;
    return JSON.stringify(snippet, null, 2);
  }

  function filledClaudeCommand(cfg, token) {
    return cfg.claudeCodeCommand.replace("hc_ВАШ_ТОКЕН", token);
  }

  function copyButton(targetId) {
    return `<button type="button" class="btn-ghost btn-sm copy-btn" data-copy-target="${targetId}">Копировать</button>`;
  }

  function bindCopyButtons(root) {
    root.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.copyTarget;
        const el = document.getElementById(id);
        if (!el) return;
        const text = el.textContent || "";
        try {
          await navigator.clipboard.writeText(text);
          HandCheck.toast("Скопировано", "success");
        } catch {
          HandCheck.toast("Не удалось скопировать", "error");
        }
      };
    });
  }

  function renderTokenOnce(rawToken, cfg) {
    if (!rawToken) return "";
    const cursorJson = filledCursorSnippet(cfg, rawToken);
    const claudeCmd = filledClaudeCommand(cfg, rawToken);
    return `
      <div id="token-once" class="token-once panel-accent">
        <p><strong>Скопируйте токен сейчас</strong> — больше он не покажется.</p>
        <div class="copy-row">
          <code id="token-raw" class="code-block">${escapeHtml(rawToken)}</code>
          ${copyButton("token-raw")}
        </div>
        <p class="invite-meta">Cursor — фрагмент для <code>.cursor/mcp.json</code></p>
        <div class="copy-row copy-row-block">
          <pre id="cursor-snippet" class="code-pre">${escapeHtml(cursorJson)}</pre>
          ${copyButton("cursor-snippet")}
        </div>
        <p class="invite-meta">Claude Code</p>
        <div class="copy-row copy-row-block">
          <pre id="claude-snippet" class="code-pre">${escapeHtml(claudeCmd)}</pre>
          ${copyButton("claude-snippet")}
        </div>
      </div>`;
  }

  async function loadAll(main, justCreatedToken) {
    main.innerHTML = HandCheck.skeletonBlocks(3);
    const [cfg, tokens, audit] = await Promise.all([
      HandCheck.api("/api/integrations/config"),
      HandCheck.api("/api/integrations/tokens"),
      HandCheck.api("/api/integrations/audit?limit=30"),
    ]);
    const tokenRows = (tokens.items || [])
      .map((t) => {
        const revoked = t.revoked ? " · отозван" : "";
        const used = t.lastUsedAt
          ? ` · последнее использование ${HandCheck.formatDateTimeMoscow(t.lastUsedAt)}`
          : "";
        return `<li class="token-row">
          <strong>${escapeHtml(t.name)}</strong>
          <span class="invite-meta">${escapeHtml(t.prefix)} · ${scopeLabelList(t.scopes)}${used}${revoked}</span>
          ${
            t.revoked
              ? ""
              : `<button type="button" class="btn-ghost btn-sm revoke-token" data-id="${t.id}" data-name="${escapeHtml(t.name)}">Отозвать</button>`
          }
        </li>`;
      })
      .join("");
    const auditRows = (audit.items || [])
      .map(
        (a) =>
          `<li class="audit-row"><span class="invite-meta">${HandCheck.formatDateTimeMoscow(a.at)}</span> · ${
            a.ok ? "успех" : "ошибка"
          } — ${escapeHtml(a.text || a.tool)}</li>`
      )
      .join("");

    main.innerHTML = `
      <section class="panel">
        <h2 class="h2">Подключение</h2>
        <p class="invite-meta">URL MCP-сервера</p>
        <div class="copy-row copy-row-block">
          <code id="mcp-url" class="code-block">${escapeHtml(cfg.mcpUrl)}</code>
          ${copyButton("mcp-url")}
        </div>
      </section>
      <section class="panel" style="margin-top:1.25rem">
        <h2 class="h2">Новый токен</h2>
        <label>Название (например, «Cursor на ноутбуке»)
          <input id="token-name" maxlength="80" />
        </label>
        <label>Где подключаете (Cursor / Claude Desktop / Claude Code / другое)
          <input id="client-where" maxlength="120" placeholder="Cursor на рабочем ноутбуке" />
        </label>
        <label class="scope-option consent-option">
          <input type="checkbox" id="logging-consent" />
          <span>Согласен на запись имени клиента, вызовов инструментов (аргументы без секретов) и краткого intent для улучшения продукта</span>
        </label>
        <fieldset class="scope-fieldset">
          <legend>Права</legend>
          <label class="scope-option"><input type="checkbox" id="scope-read" checked /> <span>Чтение</span></label>
          <label class="scope-option"><input type="checkbox" id="scope-write" /> <span>Запись</span></label>
        </fieldset>
        <p class="field-error" id="token-err" hidden></p>
        ${renderTokenOnce(justCreatedToken, cfg)}
        <button type="button" class="btn-primary" id="create-token">Создать токен</button>
      </section>
      <section class="panel" style="margin-top:1.25rem">
        <h2 class="h2">Ваши токены</h2>
        <ul class="token-list">${tokenRows || '<li class="invite-meta">Пока нет токенов.</li>'}</ul>
      </section>
      <section class="panel" style="margin-top:1.25rem">
        <h2 class="h2">Журнал действий ИИ-клиентов</h2>
        <ul class="audit-list">${auditRows || '<li class="invite-meta">Вызовов пока не было.</li>'}</ul>
      </section>`;

    bindCopyButtons(main);

    document.getElementById("create-token").onclick = async () => {
      const err = document.getElementById("token-err");
      err.hidden = true;
      const name = document.getElementById("token-name").value.trim();
      if (!name) {
        err.hidden = false;
        err.textContent = "Укажите название токена";
        return;
      }
      const scopes = [];
      if (document.getElementById("scope-read").checked) scopes.push("read");
      if (document.getElementById("scope-write").checked) scopes.push("write");
      if (!scopes.length) {
        err.hidden = false;
        err.textContent = "Выберите хотя бы одно право";
        return;
      }
      try {
        const clientWhere = document.getElementById("client-where").value.trim();
        const loggingConsent = document.getElementById("logging-consent").checked;
        const res = await HandCheck.api("/api/integrations/tokens", {
          method: "POST",
          body: JSON.stringify({ name, scopes, clientWhere, loggingConsent }),
        });
        await loadAll(main, res.token);
      } catch (e) {
        err.hidden = false;
        err.textContent = HandCheck.formatApiError(e);
      }
    };
    main.querySelectorAll(".revoke-token").forEach((btn) => {
      btn.onclick = async () => {
        const name = btn.dataset.name || "токен";
        if (
          !confirm(`Отозвать токен «${name}»? Он перестанет работать в ИИ-клиентах.`)
        ) {
          return;
        }
        await HandCheck.api(`/api/integrations/tokens/${btn.dataset.id}`, { method: "DELETE" });
        await loadAll(main);
      };
    });
  }

  function mount(role) {
    const main = document.getElementById("main");
    loadAll(main).catch(() => {
      main.innerHTML = HandCheck.loadErrorState(
        "Не удалось загрузить интеграции",
        "Проверьте соединение или повторите запрос.",
        () => loadAll(main)
      );
    });
  }

  window.HandCheckIntegrations = { mount };
})();
