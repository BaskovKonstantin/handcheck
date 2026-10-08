"use strict";

function companyTestStatusPillClass(status) {
  if (status === "submitted") return "status-pill accepted";
  if (status === "expired") return "status-pill declined";
  return "status-pill sent";
}

/**
 * @param {Array<{ id: string, title: string, status: string, statusLabel: string }>} companyTests
 * @param {(s: string) => string} esc
 */
function renderInvitationCompanyTestsHtml(companyTests, esc) {
  const list = companyTests || [];
  if (!list.length) {
    return { rowsHtml: "", reviewPanels: "" };
  }
  const rows = list
    .map((ct) => {
      if (ct.status === "pending_accept") {
        const line = ct.pendingMessage || ct.title;
        return `<div class="invite-company-test-row invite-company-test-row-pending">
  <span class="invite-company-test-title">${esc(line)}</span>
  <span class="status-pill sent">${esc(ct.statusLabel)}</span>
</div>`;
      }
      const pillCls = companyTestStatusPillClass(ct.status);
      const reviewBtn =
        ct.status === "submitted"
          ? `<button type="button" class="btn-ghost btn-sm" data-review-test="${esc(ct.id)}">Ответы</button>`
          : "";
      return `<div class="invite-company-test-row">
  <span class="invite-company-test-title">${esc(ct.title)}</span>
  <span class="${pillCls}">${esc(ct.statusLabel)}</span>
  ${reviewBtn}
</div>`;
    })
    .join("");
  const reviewPanels = list
    .filter((ct) => ct.status !== "pending_accept")
    .map((ct) => `<div class="employer-test-review-panel" id="review-${esc(ct.id)}" hidden></div>`)
    .join("");
  return {
    rowsHtml: `<div class="invite-company-tests">${rows}</div>`,
    reviewPanels,
  };
}

module.exports = {
  companyTestStatusPillClass,
  renderInvitationCompanyTestsHtml,
};
