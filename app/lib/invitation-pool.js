"use strict";

const { getDb } = require("../db");
const { loadCandidatesForNeed } = require("../modules/matching/pool");
const { httpError } = require("../middleware/errors");

function isCandidateInNeedPool(employerUserId, need, candidateId) {
  const db = getDb();
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(candidateId);
  if (!user || user.role !== "candidate") return false;
  const pool = loadCandidatesForNeed(need, employerUserId, { forDeck: false });
  return pool.some((c) => c.id === candidateId);
}

function assertCandidateInNeedPool(employerUserId, need, candidateId) {
  const db = getDb();
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(candidateId);
  if (!user || user.role !== "candidate") {
    throw httpError(404, "not_found");
  }
  if (!isCandidateInNeedPool(employerUserId, need, candidateId)) {
    throw httpError(409, "candidate_not_in_pool", {
      message: "Кандидат не подходит под эту потребность",
    });
  }
}

module.exports = { isCandidateInNeedPool, assertCandidateInNeedPool };
