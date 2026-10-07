"use strict";

/** Adult birth date for tests (18+). */
const TEST_ADULT_BIRTH_DATE = "1992-03-20";

/** Birth date for candidate aged 16 (parental consent required). */
const TEST_MINOR_BIRTH_DATE = "2010-06-01";

/** Birth date for under-15 rejection tests. */
const TEST_TOO_YOUNG_BIRTH_DATE = "2015-01-01";

function registerPayload(overrides = {}) {
  const role = overrides.role || "candidate";
  return {
    email: overrides.email || `user-${Date.now()}@demo.local`,
    password: overrides.password || "demo-demo-demo",
    role,
    birthDate: overrides.birthDate ?? TEST_ADULT_BIRTH_DATE,
    privacyConsent: overrides.privacyConsent !== undefined ? overrides.privacyConsent : true,
    parentalConsent:
      overrides.parentalConsent !== undefined ? overrides.parentalConsent : undefined,
    ...overrides,
  };
}

module.exports = {
  TEST_ADULT_BIRTH_DATE,
  TEST_MINOR_BIRTH_DATE,
  TEST_TOO_YOUNG_BIRTH_DATE,
  registerPayload,
};
