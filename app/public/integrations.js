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

  function clientTabPanels(cfg, tokenPlaceholder) {
    const token = tokenPlaceholder || "hc_ВАШ_ТОКЕН";
    const cursorJson = filledCursorSnippet(cfg, token);
    const claudeCmd = filledClaudeCommand(cfg, token);
    return `
      <div class="integrations-client-tabs" role="tablist">
        <button type="button" class="active" data-client-tab="cursor">Cursor</button>
        <button type="button" data-client-tab="claude-code">Claude Code</button>
        <button type="button" data-client-tab="claude-desktop">Claude Desktop</button>
      </div>
      <div class="client-tab-panel" data-client-panel="cursor">
        <p class="invite-meta">Вставьте в <code>.cursor/mcp.json</code> (подставьте свой токен):</p>
        <div class="copy-row copy-row-block">
          <pre id="tab-cursor-snippet" class="code-pre">${escapeHtml(cursorJson)}</pre>
          ${copyButton("tab-cursor-snippet")}
        </div>
      </div>
      <div class="client-tab-panel" data-client-panel="claude-code" hidden>
        <div class="copy-row copy-row-block">
          <pre id="tab-claude-cmd" class="code-pre">${escapeHtml(claudeCmd)}</pre>
          ${copyButton("tab-claude-cmd")}
        </div>
      </div>
      <div class="client-tab-panel" data-client-panel="claude-desktop" hidden>
        <p class="invite-meta">URL сервера:</p>
        <div class="copy-row copy-row-block">
          <code id="tab-desktop-url" class="code-block">${escapeHtml(cfg.mcpUrl)}</code>
          ${copyButton("tab-desktop-url")}
        </div>
      </div>`;
  }

  function bindClientTabs(root) {
    const tabs = root.querySelectorAll("[data-client-tab]");
    const panels = root.querySelectorAll("[data-client-panel]");
    tabs.forEach((btn) => {
      btn.onclick = () => {
        tabs.forEach((t) => t.classList.toggle("active", t === btn));
        panels.forEach((p) => {
          p.hidden = p.dataset.clientPanel !== btn.dataset.clientTab;
        });
      };
    });
  }

  async function loadAll(main, justCreatedToken) {
    main.innerHTML = HandCheck.skeletonBlocks(3);
    const [cfg, tokens, audit] = await Promise.all([
      HandCheck.api("/api/integrations/config"),
      HandCheck.api("/api/integrations/tokens"),
      HandCheck.api("/api/integrations/audit?limit=30"),
    ]);
    const allTokens = tokens.items || [];
    const activeTokens = allTokens.filter((t) => !t.revoked);
    const revokedTokens = allTokens.filter((t) => t.revoked);

    function tokenRow(t, muted) {
      const used = t.lastUsedAt
        ? ` · последнее использование ${HandCheck.formatDateTimeMoscow(t.lastUsedAt)}`
        : "";
      const cls = muted ? "token-row token-row-revoked" : "token-row";
      return `<li class="${cls}">
          <strong>${escapeHtml(t.name)}</strong>
          <span class="invite-meta">${escapeHtml(t.prefix)} · ${scopeLabelList(t.scopes)}${used}</span>
          ${
            t.revoked
              ? ""
              : `<button type="button" class="btn-ghost btn-sm revoke-token" data-id="${t.id}" data-name="${escapeHtml(t.name)}">Отозвать</button>`
          }
        </li>`;
    }

    const activeRows = activeTokens.map((t) => tokenRow(t, false)).join("");
    const revokedRows = revokedTokens.map((t) => tokenRow(t, true)).join("");
    const revokedBlock = revokedTokens.length
      ? `<details class="token-revoked-archive">
          <summary class="invite-meta">Отозванные (${revokedTokens.length})</summary>
          <ul class="token-list token-list-revoked">${revokedRows}</ul>
        </details>`
      : "";
    const tokenListBlock = `<ul class="token-list">${activeRows || '<li class="invite-meta">Пока нет активных токенов.</li>'}</ul>${revokedBlock}`;
    const auditRows = (audit.items || [])
      .map((a) => {
        const status = a.ok ? "Успешно" : "Ошибка";
        return `<li class="audit-row">
          <span class="invite-meta audit-row-time">${HandCheck.formatAuditLogTime(a.at)}</span>
          <div class="audit-row-main">
            <p class="audit-row-title">${escapeHtml(a.text || a.tool)}</p>
            <p class="audit-row-meta">${escapeHtml(a.client || "ИИ-клиент")} · ${status}</p>
          </div>
        </li>`;
      })
      .join("");

    main.innerHTML = `
      <div class="integrations-steps">
        <section class="panel">
          <span class="integrations-step-badge">Шаг 1</span>
          <h2 class="h2">Токен и подключение</h2>
          <p class="invite-meta">URL MCP-сервера</p>
          <div class="copy-row copy-row-block">
            <code id="mcp-url" class="code-block">${escapeHtml(cfg.mcpUrl)}</code>
            ${copyButton("mcp-url")}
          </div>
          <h3 class="h3" style="margin-top:1rem">Новый токен</h3>
          <label>Название (например, «Cursor на ноутбуке»)
            <input id="token-name" maxlength="80" />
          </label>
          <label>Где подключаете (Cursor / Claude Desktop / Claude Code / другое)
            <input id="client-where" maxlength="120" placeholder="Cursor на рабочем ноутбуке" />
          </label>
          <label class="scope-option consent-option">
            <input type="checkbox" id="logging-consent" />
            <span>Согласен на обработку данных ИИ-клиента (имя клиента, вызовы инструментов без секретов, краткое описание запроса, хэш IP и user-agent) по <a href="/privacy" target="_blank" rel="noopener">уведомлению 152-ФЗ</a>.</span>
          </label>
          <fieldset class="scope-fieldset">
            <legend>Права</legend>
            <label class="scope-option"><input type="checkbox" id="scope-read" checked /> <span>Чтение</span></label>
            <label class="scope-option"><input type="checkbox" id="scope-write" /> <span>Запись</span></label>
          </fieldset>
          <p class="field-error" id="token-err" hidden></p>
          ${renderTokenOnce(justCreatedToken, cfg)}
          <button type="button" class="btn-primary" id="create-token">Создать токен</button>
          <h3 class="h3" style="margin-top:1.25rem">Ваши токены</h3>
          ${tokenListBlock}
        </section>
        <section class="panel">
          <span class="integrations-step-badge">Шаг 2</span>
          <h2 class="h2">Клиент</h2>
          <p class="invite-meta">Выберите среду и скопируйте готовую конфигурацию.</p>
          ${clientTabPanels(cfg, justCreatedToken || null)}
        </section>
        <section class="panel">
          <span class="integrations-step-badge">Шаг 3</span>
          <h2 class="h2">Журнал действий ИИ-клиентов</h2>
          <ul class="audit-list">${auditRows || '<li class="invite-meta">Вызовов пока не было.</li>'}</ul>
        </section>
      </div>`;

    bindCopyButtons(main);
    bindClientTabs(main);

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
    if (main) {
      main.innerHTML = HandCheck.skeletonBlocks(3);
    }
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
