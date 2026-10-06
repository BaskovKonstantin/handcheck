"use strict";

const bcrypt = require("bcryptjs");
const { newId } = require("../lib/ids");
const config = require("../config");

const QUICK_RUBRIC = {
  keys: ["rest", "статус"],
  breadthKeys: ["идемпотентность"],
};

const WORK_RUBRIC = {
  keys: ["rest", "статус"],
  workItems: [{ id: "auth", phrases: ["авторизац", "токен"] }],
};

function seedCategories(db) {
  const specs = ["backend", "frontend", "qa"];
  const grades = ["junior", "middle", "senior"];
  const ins = db.prepare(
    "INSERT OR IGNORE INTO categories (id, specialization, grade, label) VALUES (?, ?, ?, ?)"
  );
  const SPEC = { backend: "Backend", frontend: "Frontend", qa: "QA" };
  const GR = { junior: "Junior", middle: "Middle", senior: "Senior" };
  for (const specialization of specs) {
    for (const grade of grades) {
      const label = `${SPEC[specialization]} × ${GR[grade]}`;
      ins.run(`${specialization}_${grade}`, specialization, grade, label);
    }
  }
}

function seedTasks(db) {
  const ins = db.prepare(
    `INSERT INTO tasks (id, type, specialization, grade, form_key, prompt, rubric_json, status, origin)
     VALUES (?, ?, 'backend', 'middle', ?, ?, ?, 'published', 'manual')`
  );
  for (const form of ["A", "B"]) {
    for (let i = 1; i <= 4; i++) {
      ins.run(
        newId(),
        "quick",
        form,
        `QuickProbe ${form}-${i}: опишите REST API и коды статуса.`,
        JSON.stringify(QUICK_RUBRIC)
      );
    }
    ins.run(
      newId(),
      "work",
      form,
      `WorkSim ${form}: спроектируйте сервис с авторизацией по токену и идемпотентными операциями.`,
      JSON.stringify(WORK_RUBRIC)
    );
  }
}

function seedDemoUsers(db) {
  if (!config.DEMO_MODE) return;
  const hash = bcrypt.hashSync(config.DEMO_PASSWORD, 10);
  const now = new Date().toISOString();

  const annaId = newId();
  const borisId = newId();
  const cafeId = newId();
  const otherEmpId = newId();

  const userIns = db.prepare(
    `INSERT INTO users (id, email, password_hash, role, email_confirmed_at) VALUES (?, ?, ?, ?, ?)`
  );
  userIns.run(annaId, "anna@demo.local", hash, "candidate", now);
  userIns.run(borisId, "boris@demo.local", hash, "candidate", now);
  userIns.run(cafeId, "cafe@demo.local", hash, "employer", now);
  userIns.run(otherEmpId, "other@demo.local", hash, "employer", now);

  db.prepare(
    `INSERT INTO candidate_profiles (user_id, display_name, stack_json, phone, contact_email, consent_at, availability)
     VALUES (?, ?, ?, ?, ?, ?, 'open')`
  ).run(annaId, "Анна", JSON.stringify(["node", "typescript"]), "+79001111111", "anna@demo.local", now);
  db.prepare(
    `INSERT INTO candidate_profiles (user_id, display_name, stack_json, phone, contact_email, consent_at, availability)
     VALUES (?, ?, ?, ?, ?, ?, 'open')`
  ).run(borisId, "Борис", JSON.stringify(["node", "go"]), "+79002222222", "boris@demo.local", now);

  db.prepare(
    `INSERT INTO background_episodes (id, candidate_user_id, role_title, domain, industry, note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    newId(),
    annaId,
    "backend-разработчик",
    "автоматизация работы официанта в ресторане",
    "HoReCa",
    "опыт зала + переход в разработку"
  );

  db.prepare(
    `INSERT INTO employer_profiles (user_id, company_name, description, industry, contact_email)
     VALUES (?, ?, ?, ?, ?)`
  ).run(cafeId, "Кафе Автомат", "Автоматизация зала", "HoReCa", "cafe@demo.local");
  db.prepare(
    `INSERT INTO employer_profiles (user_id, company_name, description, industry, contact_email)
     VALUES (?, ?, ?, ?, ?)`
  ).run(otherEmpId, "Другая компания", "", "IT", "other@demo.local");

  const catId = "backend_middle";
  const sharedScore = 0.72;
  const sharedMotivation = 0.85;
  const catIns = db.prepare(
    `INSERT INTO candidate_categories
     (candidate_user_id, category_id, specialization, grade, test_score, knowledge, breadth, motivation, assigned_at)
     VALUES (?, ?, 'backend', 'middle', ?, ?, ?, ?, ?)`
  );
  catIns.run(annaId, catId, sharedScore, 0.75, 0.68, sharedMotivation, now);
  catIns.run(borisId, catId, sharedScore, 0.75, 0.68, sharedMotivation, now);

  db.prepare(
    `INSERT INTO candidate_private (candidate_user_id, integrity, trust_ok) VALUES (?, 0.2, 1)`
  ).run(annaId);
  db.prepare(
    `INSERT INTO candidate_private (candidate_user_id, integrity, trust_ok) VALUES (?, 0.2, 1)`
  ).run(borisId);

  const needId = newId();
  db.prepare(
    `INSERT INTO employer_needs (id, employer_user_id, title, specialization, grade, stack_json, domain_text, notes, active)
     VALUES (?, ?, ?, 'backend', 'middle', ?, ?, ?, 1)`
  ).run(
    needId,
    cafeId,
    "Автоматизация работы официанта",
    JSON.stringify(["node"]),
    "автоматизация работы официанта в ресторане",
    ""
  );

  db.prepare(
    `INSERT INTO need_reviews (id, employer_user_id, need_id, candidate_user_id, decision, updated_at)
     VALUES (?, ?, ?, ?, 'later', ?)`
  ).run(newId(), cafeId, needId, borisId, now);
}

function seed(db) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM categories").get().c;
  if (count > 0) return;
  seedCategories(db);
  seedTasks(db);
  seedDemoUsers(db);
}

module.exports = { seed, QUICK_RUBRIC, WORK_RUBRIC };
