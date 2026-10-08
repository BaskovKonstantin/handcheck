"use strict";

const INVITATION_STATUS_LABEL = {
  sent: "Отправлено",
  viewed: "Просмотрено",
  accepted: "Принято",
  declined: "Отклонено",
};

function invitationStatusLabel(status) {
  return INVITATION_STATUS_LABEL[status] || status;
}

module.exports = {
  INVITATION_STATUS_LABEL,
  invitationStatusLabel,
};
