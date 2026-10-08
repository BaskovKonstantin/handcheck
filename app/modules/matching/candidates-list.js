"use strict";

const { getDb } = require("../../db");
const { parseSearchQuery } = require("../../lib/search-query");
const { stackMatchesFilter } = require("../../lib/stack-normalize");
const { loadCandidatesForNeed, publicMatchShape, loadEpisodesAndPhrases } = require("./pool");
const { loadOpenBank } = require("./open-bank");
const { buildExplanation } = require("./explain");
const { summarizeAiUsageForEmployer } = require("../../lib/ai-usage-summary");
const { getEmployerPasteInputMark } = require("../../lib/employer-paste-indicator");

const PAGE_SIZE = 30;

const STATUS_ORDER = { invited: 0, later: 1, declined: 2, rejected: 3, new: 4 };

function reviewStatusKey(decision) {
  if (!decision) return "new";
  if (decision === "invited") return "invited";
  if (decision === "later") return "later";
  if (decision === "declined") return "declined";
  if (decision === "rejected") return "rejected";
  return "new";
}

function matchesStatusFilter(item, statusFilter) {
  if (!statusFilter) return true;
  const key = reviewStatusKey(item.reviewDecision);
  if (statusFilter === "new") return key === "new";
  if (statusFilter === "later") return key === "later";
  if (statusFilter === "invited") return key === "invited";
  if (statusFilter === "rejected") return key === "rejected" || key === "declined";
  return true;
}

function matchesDomainFilter(item, domainQ) {
  if (!domainQ) return true;
  const q = String(domainQ).toLowerCase();
  const episodes = item.episodes || [];
  for (const e of episodes) {
    if (String(e.domain || "").toLowerCase().includes(q)) return true;
    if (String(e.industry || "").toLowerCase().includes(q)) return true;
    if (String(e.role_title || "").toLowerCase().includes(q)) return true;
  }
  const domains = item.backgroundDomains || [];
  return domains.some((d) => String(d).toLowerCase().includes(q));
}

function matchesFreeText(item, text) {
  if (!text) return true;
  const q = text.toLowerCase();
  if (String(item.displayName || "").toLowerCase().includes(q)) return true;
  if (String(item.categoryLabel || "").toLowerCase().includes(q)) return true;
  const episodes = item.episodes || [];
  for (const e of episodes) {
    const blob = [e.role_title, e.domain, e.industry].filter(Boolean).join(" ").toLowerCase();
    if (blob.includes(q)) return true;
  }
  return (item.stack || []).some((s) => String(s).toLowerCase().includes(q));
}

function mergeQueryFilters(query, parsed) {
  return {
    spec: query.spec || parsed.spec || "",
    grade: query.grade || parsed.grade || "",
    stack: query.stack || parsed.stack || "",
    fsp: query.fsp !== undefined && query.fsp !== "" ? query.fsp : parsed.fsp || "",
    domain: query.domain || "",
    status: query.status || "",
    text: parsed.text || "",
    q: query.q || "",
  };
}

function applyCandidateFilters(items, filters, parsed) {
  let list = items;
  if (filters.spec) {
    list = list.filter((c) => c.specialization === filters.spec);
  }
  if (filters.grade) {
    list = list.filter((c) => c.grade === filters.grade || c.confirmedGrade === filters.grade);
  }
  if (filters.stack) {
    list = list.filter((c) => stackMatchesFilter(c.stack, filters.stack));
  }
  if (filters.fsp === "1") list = list.filter((c) => c.hasFsp);
  if (filters.fsp === "0") list = list.filter((c) => !c.hasFsp);
  if (filters.status) list = list.filter((c) => matchesStatusFilter(c, filters.status));
  if (filters.domain) list = list.filter((c) => matchesDomainFilter(c, filters.domain));
  const leftover = (parsed && parsed.text) || filters.text || "";
  if (leftover) list = list.filter((c) => matchesFreeText(c, leftover));
  return list;
}

function sortCandidates(list, sortKey, relevanceOrder) {
  const sort = sortKey || "relevance";
  const orderMap = relevanceOrder || new Map();
  const copy = [...list];
  copy.sort((a, b) => {
    if (sort === "name") {
      return String(a.displayName || "").localeCompare(String(b.displayName || ""), "ru");
    }
    if (sort === "status") {
      const ak = STATUS_ORDER[reviewStatusKey(a.reviewDecision)] ?? 9;
      const bk = STATUS_ORDER[reviewStatusKey(b.reviewDecision)] ?? 9;
      if (ak !== bk) return ak - bk;
      return String(a.displayName || "").localeCompare(String(b.displayName || ""), "ru");
    }
    if (sort === "categoryDate") {
      const aAt = a.assignedAt ? new Date(a.assignedAt).getTime() : 0;
      const bAt = b.assignedAt ? new Date(b.assignedAt).getTime() : 0;
      if (aAt !== bAt) return bAt - aAt;
      return String(a.displayName || "").localeCompare(String(b.displayName || ""), "ru");
    }
    const ai = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
    const bi = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
    if (ai !== bi) return ai - bi;
    return String(a.displayName || "").localeCompare(String(b.displayName || ""), "ru");
  });
  return copy;
}

function enrichNeedItems(items, need) {
  const db = getDb();
  return items.map((c) => {
    const row = db
      .prepare(
        `SELECT cc.assigned_at, cc.specialization, cc.grade,
                (SELECT COUNT(*) FROM fsp_achievements f WHERE f.candidate_user_id = cc.candidate_user_id) AS fsp_c
         FROM candidate_categories cc WHERE cc.candidate_user_id = ?`
      )
      .get(c.id);
    return {
      ...c,
      assignedAt: row?.assigned_at || c.assigned_at || null,
      specialization: row?.specialization || need.specialization,
      grade: row?.grade || c.confirmedGrade || need.grade,
      confirmedGrade: c.confirmedGrade || row?.grade,
      hasFsp: (row?.fsp_c || 0) > 0,
      episodes: c.episodes,
    };
  });
}

function shapePublicRow(c, db, employerId, need) {
  const base = publicMatchShape(c);
  base.assignedAt = c.assignedAt || c.assigned_at || null;
  base.specialization = c.specialization || null;
  base.grade = c.grade || c.confirmedGrade || null;
  base.hasFsp = Boolean(c.hasFsp);
  base.stack = c.stack || [];
  if (need) {
    base.explanation = c.explanation || buildExplanation(c, need);
    if (base.reviewStatus === "invited") {
      const inv = db
        .prepare(
          `SELECT id FROM invitations
           WHERE employer_user_id = ? AND need_id = ? AND candidate_user_id = ?
             AND status IN ('sent', 'viewed', 'accepted')
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(employerId, need.id, c.id);
      if (inv) base.openInvitationId = inv.id;
    }
  }
  base.aiUsage = summarizeAiUsageForEmployer(employerId, c.id);
  const pasteInputMark = getEmployerPasteInputMark(db, c.id);
  if (pasteInputMark) base.pasteInputMark = pasteInputMark;
  return base;
}

function listEmployerCandidates(employerUserId, query) {
  const db = getDb();
  const parsed = parseSearchQuery(query.q || "");
  const filters = mergeQueryFilters(query, parsed);
  const needId = query.need || "";
  let items = [];
  const relevanceOrder = new Map();
  let need = null;

  if (needId) {
    need = db
      .prepare("SELECT * FROM employer_needs WHERE id = ? AND employer_user_id = ?")
      .get(needId, employerUserId);
    if (!need) return { error: "not_found" };
    items = loadCandidatesForNeed(need, employerUserId, { forDeck: false });
    items.forEach((c, idx) => relevanceOrder.set(c.id, idx));
    items = enrichNeedItems(items, need);
  } else {
    items = loadOpenBank(employerUserId, { needId: null });
    items.forEach((c, idx) => relevanceOrder.set(c.id, idx));
    items = items.map((c) => ({
      ...c,
      assignedAt: c.assigned_at,
      explanation: [],
    }));
  }

  items = items.map((c) => {
    if (c.episodes) return c;
    const { episodes } = loadEpisodesAndPhrases(db, c.id);
    return { ...c, episodes };
  });

  const beforeFilter = items.length;
  items = applyCandidateFilters(items, filters, parsed);
  items = sortCandidates(items, query.sort, relevanceOrder);

  const page = Math.max(1, parseInt(String(query.page || "1"), 10) || 1);
  const total = items.length;
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE).map((c) =>
    shapePublicRow(c, db, employerUserId, need)
  );

  return {
    items: pageItems,
    page,
    pageSize: PAGE_SIZE,
    total,
    parsedChips: parsed.chips,
    filtersApplied: filters,
    poolSize: beforeFilter,
  };
}

module.exports = { listEmployerCandidates, parseSearchQuery, PAGE_SIZE };
