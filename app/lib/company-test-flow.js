"use strict";

const { newId } = require("./ids");
const { httpError } = require("../middleware/errors");
const { companyTestStatusLabel } = require("./company-test-status");
const { choiceLabelsFromOptions } = require("./choice-labels");
const { publicCandidateDisplayName } = require("./public-candidate-name");
const {
  assertEmployerOwnsTest,
  candidateHasConfirmedCategory,
  gradeChoiceAnswer,
  mostlyPasted,
} = require("../modules/employer-tests/service");
const { keywordHits } = require("./russian-keyword-match");
const { COMPANY_ITEM_GRACE_MS, isItemExpired } = require("./company-test-timing");

const DEFAULT_DUE_DAYS = 3;

function defaultDueAtIso() {
  const d = new Date();
  d.setDate(d.getDate() + DEFAULT_DUE_DAYS);
  return d.toISOString();
}

function invitationNotAcceptedError() {
  return httpError(409, "invitation_not_accepted", {
    message: "Назначить тест можно только после принятия приглашения кандидатом",
  });
}

function assertInvitationAcceptedForAssign(inv) {
  if (!inv || inv.status !== "accepted") {
    throw invitationNotAcceptedError();
  }
}

function resolveInvitationForAssignment(db, employerUserId, candidateId, test, invitationId) {
  let resolved = invitationId ? String(invitationId) : "";
  if (resolved) {
    const inv = db
      .prepare(
        `SELECT * FROM invitations WHERE id = ? AND employer_user_id = ? AND candidate_user_id = ?`
      )
      .get(resolved, employerUserId, candidateId);
    if (!inv) throw httpError(404, "not_found");
    if (inv.need_id !== test.need_id) {
      throw httpError(400, "invalid_body", {
        fields: { testId: "Тест привязан к другой потребности" },
      });
    }
    assertInvitationAcceptedForAssign(inv);
    return resolved;
  }
  const latest = db
    .prepare(
      `SELECT id, status FROM invitations
       WHERE employer_user_id = ? AND candidate_user_id = ? AND need_id = ?
         AND status IN ('sent', 'viewed', 'accepted')
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(employerUserId, candidateId, test.need_id);
  if (!latest) return null;
  assertInvitationAcceptedForAssign(latest);
  return latest.id;
}

function cancelOpenAssignmentsForInvitation(db, invitationId) {
  db.prepare(
    `UPDATE employer_test_assignments
     SET status = 'cancelled', current_item_id = NULL
     WHERE invitation_id = ? AND status IN ('assigned', 'started')`
  ).run(invitationId);
}

function loadInvitationForAssignment(db, assignment) {
  if (!assignment.invitation_id) return null;
  return db.prepare("SELECT id, status FROM invitations WHERE id = ?").get(assignment.invitation_id);
}

function assertAssignmentPlayable(db, assignment) {
  if (assignment.status === "cancelled") {
    throw httpError(409, "assignment_closed", {
      message: "Приглашение закрыто — тест больше недоступен",
    });
  }
  if (assignment.status === "submitted" || assignment.status === "expired") return;
  const inv = loadInvitationForAssignment(db, assignment);
  if (inv && inv.status !== "accepted") {
    throw httpError(409, "assignment_closed", {
      message: "Приглашение закрыто — тест больше недоступен",
    });
  }
}

function findSubmittedAssignmentForTest(db, testId, candidateId) {
  return db
    .prepare(
      `SELECT id FROM employer_test_assignments
       WHERE test_id = ? AND candidate_user_id = ? AND status = 'submitted'
       LIMIT 1`
    )
    .get(testId, candidateId);
}

function findOpenAssignmentForTest(db, testId, candidateId) {
  return db
    .prepare(
      `SELECT id, status FROM employer_test_assignments
       WHERE test_id = ? AND candidate_user_id = ? AND status IN ('assigned', 'started')
       ORDER BY due_at DESC LIMIT 1`
    )
    .get(testId, candidateId);
}

function assignCompanyTest(db, employerUserId, testId, { candidateId, invitationId, dueAt }) {
  if (!candidateId) {
    throw httpError(400, "invalid_body", { fields: { candidateId: "Укажите кандидата" } });
  }
  if (!candidateHasConfirmedCategory(db, candidateId)) {
    throw httpError(409, "candidate_unconfirmed", {
      message: "Тест можно назначить только после подтверждённой категории на платформе",
    });
  }
  const test = assertEmployerOwnsTest(db, testId, employerUserId);
  if (test.status !== "published") {
    throw httpError(409, "test_not_published", { message: "Опубликуйте тест перед назначением" });
  }
  const existing = findOpenAssignmentForTest(db, testId, candidateId);
  if (existing) {
    throw httpError(409, "assignment_duplicate", {
      message: "Этот тест уже назначен кандидату",
      assignmentId: existing.id,
      status: existing.status,
    });
  }
  const submitted = findSubmittedAssignmentForTest(db, testId, candidateId);
  if (submitted) {
    throw httpError(409, "assignment_duplicate", {
      message: "Этот тест кандидат уже прошёл",
      assignmentId: submitted.id,
      status: "submitted",
    });
  }
  const linkedInvitationId = resolveInvitationForAssignment(
    db,
    employerUserId,
    candidateId,
    test,
    invitationId
  );
  if (!linkedInvitationId) {
    throw httpError(409, "invitation_required", {
      message: "Сначала отправьте приглашение кандидату по этой потребности",
    });
  }
  const due = dueAt ? String(dueAt) : defaultDueAtIso();
  const id = newId();
  db.prepare(
    `INSERT INTO employer_test_assignments (id, test_id, candidate_user_id, invitation_id, status, due_at)
     VALUES (?, ?, ?, ?, 'assigned', ?)`
  ).run(id, testId, candidateId, linkedInvitationId, due);
  return { id, status: "assigned", invitationId: linkedInvitationId };
}

function loadAssignmentForCandidate(db, assignmentId, candidateUserId) {
  const row = db
    .prepare(
      `SELECT a.*, t.title, t.intro, t.need_id, t.employer_user_id
       FROM employer_test_assignments a
       JOIN employer_tests t ON t.id = a.test_id
       WHERE a.id = ? AND a.candidate_user_id = ?`
    )
    .get(assignmentId, candidateUserId);
  if (!row) throw httpError(404, "not_found");
  return row;
}

function loadAssignmentForEmployer(db, assignmentId, employerUserId) {
  const row = db
    .prepare(
      `SELECT a.*, t.title, t.intro, t.need_id, t.employer_user_id
       FROM employer_test_assignments a
       JOIN employer_tests t ON t.id = a.test_id
       WHERE a.id = ? AND t.employer_user_id = ?`
    )
    .get(assignmentId, employerUserId);
  if (!row) throw httpError(404, "not_found");
  return row;
}

function listItems(db, testId) {
  return db
    .prepare("SELECT * FROM employer_test_items WHERE test_id = ? ORDER BY position ASC")
    .all(testId);
}

function assertAssignmentActive(db, assignment) {
  assertAssignmentPlayable(db, assignment);
  if (assignment.status === "submitted" || assignment.status === "expired") return;
  if (new Date(assignment.due_at).getTime() < Date.now()) {
    db.prepare("UPDATE employer_test_assignments SET status = 'expired' WHERE id = ?").run(assignment.id);
    throw httpError(409, "deadline_passed", { message: "Срок выполнения теста истёк" });
  }
}

function openCurrentItem(db, assignment, items) {
  assertAssignmentActive(db, assignment);
  let currentId = assignment.current_item_id;
  if (!currentId && items.length) currentId = items[0].id;
  if (!currentId) return null;
  const existing = db
    .prepare("SELECT * FROM employer_test_answers WHERE assignment_id = ? AND item_id = ?")
    .get(assignment.id, currentId);
  const now = new Date().toISOString();
  if (!existing) {
    db.prepare(
      `INSERT INTO employer_test_answers (assignment_id, item_id, opened_at) VALUES (?, ?, ?)`
    ).run(assignment.id, currentId, now);
  } else if (!existing.opened_at && !existing.submitted_at) {
    db.prepare(
      `UPDATE employer_test_answers SET opened_at = ? WHERE assignment_id = ? AND item_id = ?`
    ).run(now, assignment.id, currentId);
  }
  if (assignment.status === "assigned") {
    db.prepare(
      `UPDATE employer_test_assignments SET status = 'started', started_at = COALESCE(started_at, ?), current_item_id = ? WHERE id = ?`
    ).run(now, currentId, assignment.id);
  } else if (!assignment.current_item_id) {
    db.prepare("UPDATE employer_test_assignments SET current_item_id = ? WHERE id = ?").run(
      currentId,
      assignment.id
    );
  }
  return currentId;
}

function finalizeItemAnswer(db, assignment, item, { answerText, choiceJson, autoOk, pasteChars, typedChars, timedOut }) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE employer_test_answers SET answer_text = ?, choice_json = ?, auto_ok = ?, paste_chars = ?, typed_chars = ?, timed_out = ?, submitted_at = ? WHERE assignment_id = ? AND item_id = ?`
  ).run(
    answerText,
    choiceJson,
    autoOk,
    pasteChars,
    typedChars,
    timedOut ? 1 : 0,
    now,
    assignment.id,
    item.id
  );

  const items = listItems(db, assignment.test_id);
  const idx = items.findIndex((x) => x.id === item.id);
  const next = items[idx + 1];
  if (next) {
    db.prepare("UPDATE employer_test_assignments SET current_item_id = ? WHERE id = ?").run(
      next.id,
      assignment.id
    );
    const refreshed = db
      .prepare("SELECT * FROM employer_test_assignments WHERE id = ?")
      .get(assignment.id);
    openCurrentItem(db, refreshed, items);
  } else {
    db.prepare(
      `UPDATE employer_test_assignments SET status = 'submitted', submitted_at = ?, current_item_id = NULL WHERE id = ?`
    ).run(now, assignment.id);
  }
  return { ok: true, completed: !next, timedOut: Boolean(timedOut) };
}

function parseAnswerPayload(item, body) {
  const pasteChars = Math.max(0, Number(body.pasteChars) || 0);
  const typedChars = Math.max(0, Number(body.typedChars) || 0);
  if (item.kind === "single" || item.kind === "multi") {
    const choiceIds = Array.isArray(body.choiceIds)
      ? body.choiceIds.map((x) => String(x))
      : body.choiceId
        ? [String(body.choiceId)]
        : [];
    const key = JSON.parse(item.answer_key_json || "{}");
    const autoOk = gradeChoiceAnswer(item.kind, key, choiceIds) ? 1 : 0;
    return {
      answerText: "",
      choiceJson: JSON.stringify(choiceIds),
      autoOk,
      pasteChars,
      typedChars,
    };
  }
  const answerText = String(body.answerText ?? "").trim();
  const key = JSON.parse(item.rubric_keys_json || "{}");
  const hits = keywordHits(answerText, key.keywords || []);
  return {
    answerText,
    choiceJson: "[]",
    autoOk: hits.length > 0 ? 1 : 0,
    pasteChars,
    typedChars,
  };
}

function submitItemAnswer(db, assignment, item, body) {
  const answerRow = db
    .prepare("SELECT * FROM employer_test_answers WHERE assignment_id = ? AND item_id = ?")
    .get(assignment.id, item.id);
  if (!answerRow || !answerRow.opened_at) {
    throw httpError(409, "invalid_state", { message: "Сначала откройте вопрос" });
  }
  if (answerRow.submitted_at) {
    throw httpError(409, "already_submitted", { message: "Ответ на этот вопрос уже отправлен" });
  }

  const expired = isItemExpired(item, answerRow);
  if (expired) {
    const pasteChars = Math.max(0, Number(body.pasteChars) || 0);
    const typedChars = Math.max(0, Number(body.typedChars) || 0);
    return finalizeItemAnswer(db, assignment, item, {
      answerText: "",
      choiceJson: "[]",
      autoOk: null,
      pasteChars,
      typedChars,
      timedOut: true,
    });
  }
  const parsed = parseAnswerPayload(item, body);
  return finalizeItemAnswer(db, assignment, item, { ...parsed, timedOut: false });
}

function expireCurrentItemIfNeeded(db, assignment, items) {
  if (assignment.status !== "started") return assignment;
  let current = assignment;
  for (let guard = 0; guard < items.length + 1; guard += 1) {
    const itemId = current.current_item_id;
    if (!itemId) break;
    const item = items.find((x) => x.id === itemId);
    const answerRow = db
      .prepare("SELECT * FROM employer_test_answers WHERE assignment_id = ? AND item_id = ?")
      .get(current.id, itemId);
    if (!item || !answerRow || answerRow.submitted_at || !isItemExpired(item, answerRow)) break;
    const empty = parseAnswerPayload(item, { answerText: "", choiceIds: [], pasteChars: 0, typedChars: 0 });
    finalizeItemAnswer(db, current, item, { ...empty, timedOut: true });
    current = db.prepare("SELECT * FROM employer_test_assignments WHERE id = ?").get(current.id);
    if (current.status === "submitted") break;
  }
  return current;
}

function buildCandidateAssignmentJson(db, assignment, { syncExpiry = false } = {}) {
  const items = listItems(db, assignment.test_id);
  let current = assignment;
  if (syncExpiry && current.status === "started") {
    current = expireCurrentItemIfNeeded(db, current, items);
  }
  const answers = db
    .prepare("SELECT * FROM employer_test_answers WHERE assignment_id = ?")
    .all(current.id);
  const byItem = new Map(answers.map((a) => [a.item_id, a]));
  const currentId = current.current_item_id;
  return {
    id: current.id,
    status: current.status,
    statusLabel: companyTestStatusLabel(current.status),
    dueAt: current.due_at,
    title: current.title,
    intro: current.intro,
    currentItemId: currentId,
    items: items.map((it) => {
      const ans = byItem.get(it.id);
      const opened = ans?.opened_at;
      const deadline =
        opened && it.time_limit_sec
          ? new Date(new Date(opened).getTime() + it.time_limit_sec * 1000).toISOString()
          : null;
      return {
        id: it.id,
        position: it.position,
        kind: it.kind,
        prompt: it.prompt,
        options: JSON.parse(it.options_json || "[]"),
        timeLimitSec: it.time_limit_sec,
        openedAt: opened || null,
        deadlineAt: deadline,
        submitted: Boolean(ans?.submitted_at),
        timedOut: Boolean(ans?.timed_out),
      };
    }),
  };
}

function buildEmployerReview(db, assignment) {
  const items = listItems(db, assignment.test_id);
  const answers = db
    .prepare("SELECT * FROM employer_test_answers WHERE assignment_id = ?")
    .all(assignment.id);
  const byItem = new Map(answers.map((a) => [a.item_id, a]));
  const candidate = db
    .prepare(
      `SELECT cp.display_name, u.email FROM candidate_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.user_id = ?`
    )
    .get(assignment.candidate_user_id);
  return {
    id: assignment.id,
    status: assignment.status,
    statusLabel: companyTestStatusLabel(assignment.status),
    dueAt: assignment.due_at,
    submittedAt: assignment.submitted_at,
    testTitle: assignment.title,
    candidateId: assignment.candidate_user_id,
    candidateName: publicCandidateDisplayName(candidate?.display_name, candidate?.email),
    items: items.map((it) => {
      const ans = byItem.get(it.id);
      const kind = it.kind;
      const choiceIds = ans ? JSON.parse(ans.choice_json || "[]") : [];
      const keywords = JSON.parse(it.rubric_keys_json || "{}").keywords || [];
      const hits = ans ? keywordHits(ans.answer_text, keywords) : [];
      let choiceMark = null;
      if (kind === "single" || kind === "multi") {
        choiceMark = ans?.auto_ok === 1 ? "ok" : ans?.auto_ok === 0 ? "bad" : null;
      }
      const pasteInputMark =
        ans && mostlyPasted(ans.paste_chars, ans.typed_chars) ? { label: "Вставка" } : null;
      const options = JSON.parse(it.options_json || "[]");
      return {
        itemId: it.id,
        position: it.position,
        kind,
        prompt: it.prompt,
        options,
        answerText: ans?.answer_text || "",
        choiceIds,
        choiceLabels: choiceLabelsFromOptions(options, choiceIds),
        choiceMark,
        keywordHits: hits,
        pasteInputMark,
        pasteChars: ans?.paste_chars ?? 0,
        typedChars: ans?.typed_chars ?? 0,
        timedOut: Boolean(ans?.timed_out),
      };
    }),
  };
}

module.exports = {
  assignCompanyTest,
  resolveInvitationForAssignment,
  cancelOpenAssignmentsForInvitation,
  assertAssignmentPlayable,
  findOpenAssignmentForTest,
  findSubmittedAssignmentForTest,
  COMPANY_ITEM_GRACE_MS,
  loadAssignmentForCandidate,
  loadAssignmentForEmployer,
  listItems,
  openCurrentItem,
  submitItemAnswer,
  expireCurrentItemIfNeeded,
  buildCandidateAssignmentJson,
  buildEmployerReview,
  defaultDueAtIso,
  isItemExpired,
};
