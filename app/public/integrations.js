function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function scopeCheck(id, value, label, checked) {
  return `<label class="checkbox-row"><input type="checkbox" id="${id}" value="${value}" ${checked ? "checked" : ""} /> ${label}</label>`;
}

function configSnippets(mcpUrl, tokenPlaceholder) {
  const tok = tokenPlaceholder || "hc_ВАШ_ТОКЕН";
  const cursor = JSON.stringify(
    {
      mcpServers: {
        handcheck: {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${tok}` },
        },
      },
    },
    null,
    2
  );
  const claudeDesktop = `# Claude Desktop (~/.config/claude/claude_desktop_config.json)
{
  "mcpServers": {
    "handcheck": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ${tok}" }
    }
  }
}`;
  const claudeCli = `claude mcp add --transport http handcheck ${mcpUrl} --header "Authorization: Bearer ${tok}"`;
  const stdio = `# Клиенты только со stdio:
HANDCHECK_API_TOKEN=${tok} npx handcheck-mcp`;
  return { cursor, claudeDesktop, claudeCli, stdio, generic: mcpUrl };
}

async function mount(root) {
  root.innerHTML = HandCheck.skeletonBlocks(2);
  const [cfg, tokens, audit] = await Promise.all([
    HandCheck.api("/api/integrations/config"),
    HandCheck.api("/api/integrations/tokens"),
    HandCheck.api("/api/integrations/audit?limit=30"),
  ]);
  const snippets = configSnippets(cfg.mcpUrl, "hc_…");

  root.innerHTML = `
    <section class="panel">
      <h2 class="h2">Новый токен</h2>
      <label>Название (например, «Cursor на ноутбуке»)
        <input id="tok-name" maxlength="80" placeholder="Cursor" />
      </label>
      <fieldset class="scope-fieldset">
        <legend>Права</legend>
        ${scopeCheck("scope-read", "read", "Чтение (профиль, списки, whoami)", true)}
        ${scopeCheck("scope-write", "write", "Запись (ответы, решения по колоде, профиль)", false)}
      </fieldset>
      <p class="field-error" id="tok-err" hidden></p>
      <button type="button" class="btn-primary" id="tok-create">Создать токен</button>
      <div id="tok-reveal" hidden class="token-reveal panel-inner">
        <p class="invite-meta">Скопируйте токен сейчас — повторно он не показывается.</p>
        <code class="code-block" id="tok-plain"></code>
        <button type="button" class="btn-ghost btn-sm" id="tok-copy">Скопировать</button>
      </div>
    </section>

    <section class="panel" style="margin-top:1.25rem">
      <h2 class="h2">Активные токены</h2>
      <div id="tok-list">${renderTokenList(tokens.items)}</div>
    </section>

    <section class="panel" style="margin-top:1.25rem">
      <h2 class="h2">Подключение MCP</h2>
      <p class="invite-meta">URL сервера: <code>${escapeHtml(cfg.mcpUrl)}</code></p>
      <h3 class="h3">Cursor — <code>.cursor/mcp.json</code></h3>
      <pre class="code-block"><code>${escapeHtml(snippets.cursor)}</code></pre>
      <h3 class="h3">Claude Desktop</h3>
      <pre class="code-block"><code>${escapeHtml(snippets.claudeDesktop)}</code></pre>
      <h3 class="h3">Claude Code</h3>
      <pre class="code-block"><code>${escapeHtml(snippets.claudeCli)}</code></pre>
      <h3 class="h3">Stdio-мост</h3>
      <pre class="code-block"><code>${escapeHtml(snippets.stdio)}</code></pre>
    </section>

    <section class="panel" style="margin-top:1.25rem">
      <h2 class="h2">Журнал вызовов MCP</h2>
      <div id="audit-list">${renderAudit(audit.items)}</div>
    </section>`;

  document.getElementById("tok-create").onclick = async () => {
    const err = document.getElementById("tok-err");
    err.hidden = true;
    const scopes = [];
    if (document.getElementById("scope-read").checked) scopes.push("read");
    if (document.getElementById("scope-write").checked) scopes.push("write");
    try {
      const created = await HandCheck.api("/api/integrations/tokens", {
        method: "POST",
        body: JSON.stringify({ name: document.getElementById("tok-name").value, scopes }),
      });
      document.getElementById("tok-plain").textContent = created.token;
      document.getElementById("tok-reveal").hidden = false;
      HandCheck.toast("Токен создан");
      const list = await HandCheck.api("/api/integrations/tokens");
      document.getElementById("tok-list").innerHTML = renderTokenList(list.items);
    } catch (e) {
      err.textContent = HandCheck.formatApiError(e);
      err.hidden = false;
    }
  };

  document.getElementById("tok-copy")?.addEventListener("click", () => {
    const text = document.getElementById("tok-plain").textContent;
    navigator.clipboard.writeText(text).then(() => HandCheck.toast("Токен скопирован"));
  });

  root.querySelectorAll(".revoke-tok").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Отозвать этот токен? Клиенты перестанут подключаться.")) return;
      await HandCheck.api(`/api/integrations/tokens/${btn.dataset.id}`, { method: "DELETE" });
      const list = await HandCheck.api("/api/integrations/tokens");
      document.getElementById("tok-list").innerHTML = renderTokenList(list.items);
      HandCheck.toast("Токен отозван");
    });
  });
}

function renderTokenList(items) {
  const active = (items || []).filter((t) => !t.revoked);
  if (!active.length) {
    return '<p class="invite-meta">Пока нет токенов — создайте первый для AI-клиента.</p>';
  }
  return `<ul class="row-list">${active
    .map(
      (t) => `<li class="row-link">
        <div>
          <strong>${escapeHtml(t.name)}</strong>
          <span class="invite-meta">${escapeHtml(t.prefix)}… · ${t.scopes.join(", ")}</span>
        </div>
        <span class="invite-meta">${t.lastUsedAt ? `Был использован: ${new Date(t.lastUsedAt).toLocaleString("ru")}` : "Ещё не использовался"}</span>
        <button type="button" class="btn-ghost btn-sm revoke-tok" data-id="${t.id}">Отозвать</button>
      </li>`
    )
    .join("")}</ul>`;
}

function renderAudit(items) {
  if (!items?.length) {
    return '<p class="invite-meta">Пока нет вызовов MCP — они появятся после первого подключения клиента.</p>';
  }
  return `<ul class="row-list">${items
    .map(
      (a) => `<li class="row-link">
        <div><strong>${escapeHtml(a.tool)}</strong>
          <span class="invite-meta">${escapeHtml(a.summary)}</span></div>
        <span class="invite-meta">${new Date(a.at).toLocaleString("ru")}${a.tokenName ? ` · ${escapeHtml(a.tokenName)}` : ""}</span>
      </li>`
    )
    .join("")}</ul>`;
}

window.HandCheckIntegrations = { mount };
