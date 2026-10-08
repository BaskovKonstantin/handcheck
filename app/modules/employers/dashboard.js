"use strict";

const { getDb } = require("../../db");
const { loadCandidatesForNeed } = require("../matching/pool");
const { loadOpenBank } = require("../matching/open-bank");
const { CATEGORY_STATUS_UNCONFIRMED } = require("../../lib/category-status");
const { dbDateToIso } = require("../../lib/db-datetime");
const { formatSpecGradeLabel } = require("../../lib/spec-grade-label");
const { invitationStatusLabel } = require("../../lib/invitation-status");
const { publicCandidateDisplayName } = require("../../lib/public-candidate-name");

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
    totalOut > 0 ? Math.round((funnel.accepted / totalOut) * 100) : null;
  return {
    ...funnel,
    acceptanceShare,
    medianAnswerHours: medianHours(deltas),
  };
}

function buildBankComposition(employerUserId) {
  const tallies = new Map();
  let unconfirmed = 0;
  for (const row of loadOpenBank(employerUserId)) {
    if (row.categoryStatus === CATEGORY_STATUS_UNCONFIRMED) {
      unconfirmed += 1;
      continue;
    }
    const spec = row.specialization;
    const grade = row.grade || row.confirmedGrade;
    if (!spec || !grade) continue;
    const key = `${spec}\0${grade}`;
    tallies.set(key, (tallies.get(key) || 0) + 1);
  }
  const rows = [...tallies.entries()]
    .map(([key, count]) => {
      const [spec, grade] = key.split("\0");
      return {
        spec,
        grade,
        label: formatSpecGradeLabel(spec, grade),
        count,
      };
    })
    .sort((a, b) => b.count - a.count);
  if (unconfirmed > 0) {
    rows.push({
      spec: "",
      grade: "",
      label: "Без подтверждённой категории",
      count: unconfirmed,
    });
  }
  return rows;
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
      label: `Приглашение · ${invitationStatusLabel(r.status)}`,
      name: publicCandidateDisplayName(r.display_name, r.email),
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
      `SELECT i.id, cp.display_name, u.email, i.created_at
       FROM invitations i
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       JOIN users u ON u.id = i.candidate_user_id
       WHERE i.employer_user_id = ?
         AND i.status IN ('sent', 'viewed')
         AND datetime(i.created_at) < datetime('now', '-3 days')
       ORDER BY i.created_at ASC LIMIT 5`
    )
    .all(employerUserId);
  for (const r of stale) {
    actions.push({
      type: "stale_invite",
      label: `Нет ответа на приглашение · ${publicCandidateDisplayName(r.display_name, r.email)}`,
      href: "/employer/invitations",
    });
  }
  const analyzed = db
    .prepare(
      `SELECT c.id, cp.display_name, u.email
       FROM calls c
       JOIN invitations i ON i.id = c.invitation_id
       JOIN candidate_profiles cp ON cp.user_id = i.candidate_user_id
       JOIN users u ON u.id = i.candidate_user_id
       JOIN call_analyses a ON a.call_id = c.id
       WHERE i.employer_user_id = ? AND c.status = 'ended'
       ORDER BY c.ended_at DESC LIMIT 3`
    )
    .all(employerUserId);
  for (const r of analyzed) {
    actions.push({
      type: "call_analysis",
      label: `Разбор завершённого звонка · ${publicCandidateDisplayName(r.display_name, r.email)}`,
      href: `/employer/calls`,
    });
  }
  const deferred = db
    .prepare(
      `SELECT nr.candidate_user_id, cp.display_name, u.email, n.id AS need_id
       FROM need_reviews nr
       JOIN candidate_profiles cp ON cp.user_id = nr.candidate_user_id
       JOIN users u ON u.id = nr.candidate_user_id
       JOIN employer_needs n ON n.id = nr.need_id
       WHERE nr.employer_user_id = ? AND nr.decision = 'later'
       ORDER BY nr.updated_at DESC LIMIT 5`
    )
    .all(employerUserId);
  for (const r of deferred) {
    actions.push({
      type: "deferred",
      label: `Отложенный кандидат · ${publicCandidateDisplayName(r.display_name, r.email)}`,
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
    bankComposition: buildBankComposition(employerUserId),
    events: buildEvents(db, employerUserId),
    nextActions: buildNextActions(db, employerUserId),
  };
}

module.exports = { buildEmployerDashboard };
