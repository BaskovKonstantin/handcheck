"use strict";

function employerCandidateView(viewerEmployerId, candidate, invitation) {
  const base = {
    id: candidate.id,
    displayName: candidate.displayName,
    categoryLabel: candidate.categoryLabel,
    stack: candidate.stack,
    backgroundDomains: candidate.backgroundDomains,
    explanation: candidate.explanation,
    taskPhrases: candidate.taskPhrases,
    integrationNote: candidate.integrationNote || null,
  };
  if (
    invitation &&
    invitation.status === "accepted" &&
    invitation.employer_user_id === viewerEmployerId
  ) {
    return {
      ...base,
      phone: candidate.phone,
      contact_email: candidate.contact_email,
    };
  }
  return base;
}

module.exports = { employerCandidateView };
