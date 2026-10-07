"use strict";

const { newId } = require("./ids");
const { httpError } = require("../middleware/errors");
const {
  assertEmployerOwnsTest,
  candidateHasConfirmedCategory,
  gradeChoiceAnswer,
  keywordHits,
  mostlyPasted,
} = require("../modules/employer-tests/service");

const DEFAULT_DUE_DAYS = 3;

function defaultDueAtIso() {
  const d = new Date();
  d.setDate(d.getDate() + DEFAULT_DUE_DAYS);
  return d.toISOString();
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
  if (invitationId) {
    const inv = db
      .prepare(
        `SELECT * FROM invitations WHERE id = ? AND employer_user_id = ? AND candidate_user_id = ?`
      )
      .get(invitationId, employerUserId, candidateId);
    if (!inv) throw httpError(404, "not_found");
    if (inv.need_id !== test.need_id) {
      throw httpError(400, "invalid_body", {
        fields: { testId: "Тест привязан к другой потребности" },
      });
    }
  }
  const due = dueAt ? String(dueAt) : defaultDueAtIso();
  const id = newId();
  db.prepare(
    `INSERT INTO employer_test_assignments (id, test_id, candidate_user_id, invitation_id, status, due_at)
     VALUES (?, ?, ?, ?, 'assigned', ?)`
  ).run(id, testId, candidateId, invitationId || null, due);
  return { id };
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

function openCurrentItem(db, assignment, items) {
  if (assignment.status === "submitted" || assignment.status === "expired") return;
  if (new Date(assignment.due_at).getTime() < Date.now()) {
    db.prepare("UPDATE employer_test_assignments SET status = 'expired' WHERE id = ?").run(assignment.id);
    throw httpError(409, "deadline_passed", { message: "Срок выполнения теста истёк" });
  }
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

function itemDeadlineMs(item, openedAt) {
  if (!openedAt || !item.time_limit_sec) return null;
  return new Date(openedAt).getTime() + item.time_limit_sec * 1000;
}

function assertItemTimeOpen(item, answerRow) {
  const deadline = itemDeadlineMs(item, answerRow.opened_at);
  if (deadline && Date.now() > deadline) {
    throw httpError(409, "quick_time_expired", {
      message: "Время на этот вопрос истекло",
    });
  }
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
  assertItemTimeOpen(item, answerRow);

  let autoOk = null;
  let answerText = "";
  let choiceJson = "[]";
  const pasteChars = Math.max(0, Number(body.pasteChars) || 0);
  const typedChars = Math.max(0, Number(body.typedChars) || 0);

  if (item.kind === "single" || item.kind === "multi") {
    const choiceIds = Array.isArray(body.choiceIds)
      ? body.choiceIds.map((x) => String(x))
      : body.choiceId
        ? [String(body.choiceId)]
        : [];
    choiceJson = JSON.stringify(choiceIds);
    const key = JSON.parse(item.answer_key_json || "{}");
    autoOk = gradeChoiceAnswer(item.kind, key, choiceIds) ? 1 : 0;
  } else {
    answerText = String(body.answerText ?? "").trim();
    const key = JSON.parse(item.rubric_keys_json || "{}");
    const hits = keywordHits(answerText, key.keywords || []);
    autoOk = hits.length > 0 ? 1 : 0;
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE employer_test_answers SET answer_text = ?, choice_json = ?, auto_ok = ?, paste_chars = ?, typed_chars = ?, submitted_at = ? WHERE assignment_id = ? AND item_id = ?`
  ).run(answerText, choiceJson, autoOk, pasteChars, typedChars, now, assignment.id, item.id);

  const items = listItems(db, assignment.test_id);
  const idx = items.findIndex((x) => x.id === item.id);
  const next = items[idx + 1];
  if (next) {
    db.prepare("UPDATE employer_test_assignments SET current_item_id = ? WHERE id = ?").run(
      next.id,
      assignment.id
    );
    openCurrentItem(db, { ...assignment, current_item_id: next.id, status: "started" }, items);
  } else {
    db.prepare(
      `UPDATE employer_test_assignments SET status = 'submitted', submitted_at = ?, current_item_id = NULL WHERE id = ?`
    ).run(now, assignment.id);
  }
  return { ok: true, completed: !next };
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
    dueAt: assignment.due_at,
    submittedAt: assignment.submitted_at,
    testTitle: assignment.title,
    candidateId: assignment.candidate_user_id,
    candidateName: candidate?.display_name || candidate?.email,
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
      return {
        itemId: it.id,
        position: it.position,
        kind,
        prompt: it.prompt,
        options: JSON.parse(it.options_json || "[]"),
        answerText: ans?.answer_text || "",
        choiceIds,
        choiceMark,
        keywordHits: hits,
        pasteInputMark: ans && mostlyPasted(ans.paste_chars, ans.typed_chars) ? { label: "Вставка" } : null,
      };
    }),
  };
}

module.exports = {
  assignCompanyTest,
  loadAssignmentForCandidate,
  loadAssignmentForEmployer,
  listItems,
  openCurrentItem,
  submitItemAnswer,
  buildEmployerReview,
  defaultDueAtIso,
};
