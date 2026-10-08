"use strict";

const COMPANY_TEST_STATUS_LABELS = {
  assigned: "Назначен",
  started: "В процессе",
  submitted: "Сдан",
  expired: "Истёк",
};

function companyTestStatusLabel(status) {
  return COMPANY_TEST_STATUS_LABELS[status] || status;
}

module.exports = { COMPANY_TEST_STATUS_LABELS, companyTestStatusLabel };
