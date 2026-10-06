(function () {
  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  async function loadAll(main) {
    main.innerHTML = HandCheck.skeletonBlocks(3);
    const [cfg, tokens, audit] = await Promise.all([
      HandCheck.api("/api/integrations/config"),
      HandCheck.api("/api/integrations/tokens"),
      HandCheck.api("/api/integrations/audit?limit=30"),
    ]);
    const cursorJson = JSON.stringify(cfg.cursorSnippet, null, 2);
    const tokenRows = (tokens.items || [])
      .map((t) => {
        const revoked = t.revoked ? " · отозван" : "";
        const used = t.lastUsedAt ? ` · последний вход ${t.lastUsedAt}` : "";
        return `<li class="token-row">
          <strong>${escapeHtml(t.name)}</strong>
          <span class="invite-meta">${escapeHtml(t.prefix)} · ${(t.scopes || []).join(", ")}${used}${revoked}</span>
          ${
            t.revoked
              ? ""
              : `<button type="button" class="btn-ghost btn-sm revoke-token" data-id="${t.id}">Отозвать</button>`
          }
        </li>`;
      })
      .join("");
    const auditRows = (audit.items || [])
      .map(
        (a) =>
          `<li class="audit-row"><span class="invite-meta">${a.at}</span> · <code>${escapeHtml(a.tool)}</code> · ${
            a.ok ? "успех" : "ошибка"
          }${a.summary ? ` — ${escapeHtml(a.summary)}` : ""}</li>`
      )
      .join("");
    main.innerHTML = `
      <section class="panel">
        <h2 class="h2">Подключение</h2>
        <p class="invite-meta">URL MCP-сервера</p>
        <p><code class="code-block">${escapeHtml(cfg.mcpUrl)}</code></p>
        <p class="invite-meta">Cursor — фрагмент для <code>.cursor/mcp.json</code></p>
        <pre class="code-pre">${escapeHtml(cursorJson)}</pre>
        <p class="invite-meta">Claude Code</p>
        <pre class="code-pre">${escapeHtml(cfg.claudeCodeCommand)}</pre>
      </section>
      <section class="panel" style="margin-top:1.25rem">
        <h2 class="h2">Новый токен</h2>
        <label>Название (например, «Cursor на ноутбуке»)
          <input id="token-name" maxlength="80" />
        </label>
        <fieldset class="scope-fieldset">
          <legend>Права</legend>
          <label><input type="checkbox" id="scope-read" checked /> Чтение</label>
          <label><input type="checkbox" id="scope-write" /> Запись</label>
        </fieldset>
        <p class="field-error" id="token-err" hidden></p>
        <div id="token-once" hidden class="token-once panel-accent">
          <p><strong>Скопируйте токен сейчас</strong> — больше он не покажется.</p>
          <code id="token-raw" class="code-block"></code>
        </div>
        <button type="button" class="btn-primary" id="create-token">Создать токен</button>
      </section>
      <section class="panel" style="margin-top:1.25rem">
        <h2 class="h2">Ваши токены</h2>
        <ul class="token-list">${tokenRows || '<li class="invite-meta">Пока нет токенов.</li>'}</ul>
      </section>
      <section class="panel" style="margin-top:1.25rem">
        <h2 class="h2">Журнал MCP</h2>
        <ul class="audit-list">${auditRows || '<li class="invite-meta">Вызовов пока не было.</li>'}</ul>
      </section>`;

    document.getElementById("create-token").onclick = async () => {
      const err = document.getElementById("token-err");
      err.hidden = true;
      const scopes = [];
      if (document.getElementById("scope-read").checked) scopes.push("read");
      if (document.getElementById("scope-write").checked) scopes.push("write");
      try {
        const res = await HandCheck.api("/api/integrations/tokens", {
          method: "POST",
          body: JSON.stringify({ name: document.getElementById("token-name").value, scopes }),
        });
        document.getElementById("token-once").hidden = false;
        document.getElementById("token-raw").textContent = res.token;
        await loadAll(main);
      } catch (e) {
        err.hidden = false;
        err.textContent = HandCheck.formatApiError(e);
      }
    };
    main.querySelectorAll(".revoke-token").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Токен перестанет работать в ИИ-клиентах")) return;
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
