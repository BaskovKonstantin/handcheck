"use strict";

const { getDb } = require("../../db");
const { loadCandidatesForNeed } = require("../matching/pool");
const { loadOpenBank } = require("../matching/open-bank");
const { dbDateToIso } = require("../../lib/db-datetime");

function poolGroupCounts(items, need) {
  let exact = 0;
  let otherGrade = 0;
  let unconfirmed = 0;
  for (const item of items) {
    const status = item.categoryStatus || "confirmed";
    if (status === "unconfirmed") {
      unconfirmed += 1;
      continue;
    }
    if (item.gradeRelation === "lower" || item.gradeRelation === "higher") {
      otherGrade += 1;
      continue;
    }
    exact += 1;
  }
  return { exact, otherGrade, unconfirmed };
}

function reviewCounts(items) {
  let invited = 0;
  let deferred = 0;
  let rejected = 0;
  for (const item of items) {
    const d = item.reviewDecision;
    if (d === "invited") invited += 1;
    else if (d === "later") deferred += 1;
    else if (d === "rejected" || d === "declined") rejected += 1;
  }
  return { invited, deferred, rejected };
}

function medianHours(deltas) {
  if (!deltas.length) return null;
  const sorted = [...deltas].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildInvitationFunnel(db, employerUserId) {
  const rows = db
    .prepare(
      `SELECT status, created_at FROM invitations WHERE employer_user_id = ?`
    )
    .all(employerUserId);
  const funnel = { sent: 0, viewed: 0, accepted: 0, declined: 0 };
  for (const r of rows) {
    if (r.status === "sent") funnel.sent += 1;
    else if (r.status === "viewed") funnel.viewed += 1;
    else if (r.status === "accepted") funnel.accepted += 1;
    else if (r.status === "declined") funnel.declined += 1;
  }
  const answered = db
    .prepare(
      `SELECT created_at, status FROM invitations
       WHERE employer_user_id = ? AND status IN ('accepted', 'declined')`
    )
    .all(employerUserId);
  const deltas = answered.map((r) => {
    const created = new Date(dbDateToIso(r.created_at)).getTime();
    return (Date.now() - created) / 3600000;
  });
  const totalOut = funnel.sent + funnel.viewed + funnel.accepted + funnel.declined;
  const acceptanceShare =
    totalOut > 0 ? Math.round((funnel.accepted / totalOut) * 100) : 0;
  return {
    ...funnel,
    acceptanceShare,
    medianAnswerHours: medianHours(deltas),
  };
}

function buildBankComposition(db) {
  return db
    .prepare(
      `SELECT cc.specialization AS spec, cc.grade AS grade, COUNT(*) AS c
       FROM candidate_categories cc
       JOIN candidate_profiles cp ON cp.user_id = cc.candidate_user_id
       JOIN candidate_private priv ON priv.candidate_user_id = cc.candidate_user_id
       JOIN users u ON u.id = cc.candidate_user_id
       WHERE cp.availability = 'open' AND priv.trust_ok = 1
         AND u.email_confirmed_at IS NOT NULL
       GROUP BY cc.specialization, cc.grade
       ORDER BY c DESC`
    )
    .all()
    .map((r) => ({ spec: r.spec, grade: r.grade, count: r.c }));
}

function buildEvents(db, employerUserId) {
  const events = [];
  const inv = db
    .prepare(
      `SELECT i.created_at, i.status, cp.display_name, u.email
       FROM invitations i
       JOIN users u ON u.id = i.candidate_user_id
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       WHERE i.employer_user_id = ?
       ORDER BY i.created_at DESC LIMIT 6`
    )
    .all(employerUserId);
  for (const r of inv) {
    events.push({
      at: dbDateToIso(r.created_at),
      kind: "invitation",
      label: `Приглашение · ${r.status}`,
      name: r.display_name || r.email,
    });
  }
  const calls = db
    .prepare(
      `SELECT c.ended_at, c.status, cp.display_name
       FROM calls c
       JOIN invitations i ON i.id = c.invitation_id
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       WHERE i.employer_user_id = ? AND c.status = 'ended'
       ORDER BY c.ended_at DESC LIMIT 4`
    )
    .all(employerUserId);
  for (const r of calls) {
    events.push({
      at: dbDateToIso(r.ended_at),
      kind: "call",
      label: "Звонок завершён",
      name: r.display_name,
    });
  }
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events.slice(0, 10);
}

function buildNextActions(db, employerUserId) {
  const actions = [];
  const stale = db
    .prepare(
      `SELECT i.id, cp.display_name, i.created_at
       FROM invitations i
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       WHERE i.employer_user_id = ?
         AND i.status IN ('sent', 'viewed')
         AND datetime(i.created_at) < datetime('now', '-3 days')
       ORDER BY i.created_at ASC LIMIT 5`
    )
    .all(employerUserId);
  for (const r of stale) {
    actions.push({
      type: "stale_invite",
      label: `Нет ответа на приглашение · ${r.display_name}`,
      href: "/employer/invitations",
    });
  }
  const analyzed = db
    .prepare(
      `SELECT c.id
       FROM calls c
       JOIN invitations i ON i.id = c.invitation_id
       JOIN call_analyses a ON a.call_id = c.id
       WHERE i.employer_user_id = ? AND c.status = 'ended'
       ORDER BY c.ended_at DESC LIMIT 3`
    )
    .all(employerUserId);
  for (const r of analyzed) {
    actions.push({
      type: "call_analysis",
      label: "Разбор завершённого звонка",
      href: `/employer/calls`,
    });
  }
  const deferred = db
    .prepare(
      `SELECT nr.candidate_user_id, cp.display_name, n.id AS need_id
       FROM need_reviews nr
       JOIN candidate_profiles cp ON cp.user_id = nr.candidate_user_id
       JOIN employer_needs n ON n.id = nr.need_id
       WHERE nr.employer_user_id = ? AND nr.decision = 'later'
       ORDER BY nr.updated_at DESC LIMIT 5`
    )
    .all(employerUserId);
  for (const r of deferred) {
    actions.push({
      type: "deferred",
      label: `Отложенный кандидат · ${r.display_name}`,
      href: `/employer/candidates?need=${r.need_id}&status=later`,
    });
  }
  return actions.slice(0, 8);
}

function buildEmployerDashboard(employerUserId) {
  const db = getDb();
  const profile = db
    .prepare("SELECT company_name FROM employer_profiles WHERE user_id = ?")
    .get(employerUserId);
  const needs = db
    .prepare("SELECT * FROM employer_needs WHERE employer_user_id = ? ORDER BY title")
    .all(employerUserId);

  const needSummaries = needs.map((need) => {
    const poolItems = loadCandidatesForNeed(need, employerUserId, { forDeck: false });
    const deckItems = loadCandidatesForNeed(need, employerUserId, { forDeck: true });
    const pool = poolGroupCounts(poolItems, need);
    const reviews = reviewCounts(poolItems);
    return {
      id: need.id,
      title: need.title,
      specialization: need.specialization,
      grade: need.grade,
      active: Boolean(need.active),
      pool,
      deckLeft: deckItems.length,
      ...reviews,
    };
  });

  const openBank = loadOpenBank(employerUserId).length;
  const funnel = buildInvitationFunnel(db, employerUserId);
  const calls = db
    .prepare(
      `SELECT c.status, COUNT(*) AS c
       FROM calls c
       JOIN invitations i ON i.id = c.invitation_id
       WHERE i.employer_user_id = ?
       GROUP BY c.status`
    )
    .all(employerUserId);
  const callCounts = { ready: 0, live: 0, ended: 0 };
  for (const row of calls) callCounts[row.status] = row.c;

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";

  return {
    greeting,
    companyName: profile?.company_name || "Компания",
    kpis: {
      needsActive: needs.filter((n) => n.active).length,
      deckLeft: needSummaries.reduce((s, n) => s + n.deckLeft, 0),
      openInvites: funnel.sent + funnel.viewed,
      bankOpen: openBank,
    },
    funnel,
    calls: callCounts,
    needs: needSummaries,
    bankComposition: buildBankComposition(db),
    events: buildEvents(db, employerUserId),
    nextActions: buildNextActions(db, employerUserId),
  };
}

module.exports = { buildEmployerDashboard };
