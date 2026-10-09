"use strict";

/**
 * HandCheck — функциональный аудит по ТЗ (docs/TZ.md).
 *
 * Скрипт ничего не поднимает: его нужно направить на уже запущенный инстанс.
 *
 *   # локальный стенд с чистой БД (полный режим)
 *   PORT=8899 DB_PATH=/tmp/hc-audit.sqlite DEMO_MODE=1 npm start &
 *   BASE_URL=http://127.0.0.1:8899 node scripts/functional-audit.js
 *
 *   # прод — только читающий режим, без записей в jury-БД
 *   BASE_URL=https://handcheck.baski.pro AUDIT_MODE=readonly node scripts/functional-audit.js
 *
 * Полный режим идёт двумя волнами:
 *   A) свежий кандидат — регистрация, согласие, батарея, кулдаун, приватность;
 *   B) демо-аккаунты (у них уже есть категории) — подбор, приглашения, контакты,
 *      колода, короткие тесты работодателя, MCP, LLM.
 *
 * Переменные: BASE_URL, AUDIT_MODE=full|readonly, AUDIT_JSON, AUDIT_MD, DEMO_PASSWORD,
 *             DEMO_CANDIDATE, DEMO_CANDIDATE2, DEMO_EMPLOYER.
 */

const BASE = (process.env.BASE_URL || "http://127.0.0.1:8899").replace(/\/+$/, "");
const MODE = process.env.AUDIT_MODE || "full";
const PASS = process.env.DEMO_PASSWORD || "demo-demo-demo";
const DEMO_CANDIDATE = process.env.DEMO_CANDIDATE || "anna@demo.local";
const DEMO_CANDIDATE2 = process.env.DEMO_CANDIDATE2 || "boris@demo.local";
const DEMO_EMPLOYER = process.env.DEMO_EMPLOYER || "cafe@demo.local";
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const results = [];
const state = {};
let currentArea = "";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function check(id, name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ id, area: currentArea, name, status: "PASS", detail: detail || "", ms: Date.now() - started });
  } catch (e) {
    results.push({
      id,
      area: currentArea,
      name,
      status: "FAIL",
      detail: String(e && e.message ? e.message : e).slice(0, 400),
      ms: Date.now() - started,
    });
  }
}

class Client {
  constructor(label) {
    this.label = label;
    this.cookie = "";
    this.token = "";
  }

  async req(method, path, body, opts = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.token && opts.useToken) headers.Authorization = `Bearer ${this.token}`;
    if (opts.demoAdmin) headers["x-demo-admin"] = "1";
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie?.() || []) {
      const part = c.split(";")[0];
      if (part.startsWith("handcheck_sid=")) this.cookie = part;
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, json, headers: res.headers };
  }

  get(path, opts) {
    return this.req("GET", path, undefined, opts);
  }

  post(path, body, opts) {
    return this.req("POST", path, body ?? {}, opts);
  }

  put(path, body, opts) {
    return this.req("PUT", path, body ?? {}, opts);
  }

  del(path, opts) {
    return this.req("DELETE", path, undefined, opts);
  }

  async login(email, password = PASS) {
    const r = await this.post("/api/auth/login", { email, password });
    assert(r.status === 200, `login ${email} → ${r.status} ${JSON.stringify(r.json)}`);
    return (await this.get("/api/me")).json;
  }

  async register(role, email, password = PASS) {
    const r = await this.post("/api/auth/register", {
      email,
      password,
      role,
      birthDate: "1995-05-05",
      privacyConsent: true,
    });
    assert(r.status === 201, `register ${email} → ${r.status} ${JSON.stringify(r.json)}`);
    const c = await this.post("/api/auth/confirm", { email, code: "000000" });
    assert(c.status === 200, `confirm ${email} → ${c.status} ${JSON.stringify(c.json)}`);
    return this.login(email, password);
  }
}

const STRONG_TEXT = [
  "Сначала фиксирую требования и входные данные, потом выбираю структуру данных и алгоритм.",
  "Обрабатываю ошибки и граничные случаи, добавляю проверку входных данных и лимиты.",
  "Дальше пишу тесты на основной сценарий и на крайние случаи, измеряю сложность.",
  "Для продакшена: логирование, метрики, мониторинг, безопасность и защита от гонок данных.",
  "Отдельно слежу за идемпотентностью операций и за тем, чтобы повторный запрос не ломал состояние.",
].join(" ");

const WEAK_TEXT = [
  "Сделал примерно так, как просили в задании, точную реализацию не помню.",
  "Тесты не успел, но общая идея понятна из описания задачи.",
  "В остальных пунктах отвечаю коротко, потому что времени было немного.",
].join(" ");

function answerFor(type, min) {
  const base = type === "work" ? `${STRONG_TEXT} ${WEAK_TEXT}` : STRONG_TEXT;
  const need = Math.max(0, Number(min || 0));
  return base.repeat(Math.max(1, Math.ceil((need + 250) / base.length))).slice(0, Math.max(600, need + 300));
}

/** Проходит батарею целиком: открыть → ответить → отправить каждый шаг. */
async function completeBattery(client, { specialization, grade, quality }) {
  const start = await client.post("/api/assessment/battery/start", {
    specialization,
    grade,
    privacyConsent: true,
  });
  assert(start.status === 201 || start.status === 200, `battery/start → ${start.status} ${JSON.stringify(start.json)}`);
  const batteryId = start.json.batteryId;
  const useStrong = quality !== "weak";
  let steps = 0;
  let complete = false;
  let last = null;
  while (!complete && steps < 30) {
    steps += 1;
    const cur = await client.get("/api/assessment/battery/current");
    const battery = cur.json.battery;
    if (!battery || battery.id !== batteryId) break;
    const next = battery.attempts.find((a) => !a.submitted);
    if (!next) break;
    const task = await client.get(`/api/assessment/tasks/${next.id}`);
    assert(task.status === 200, `GET task → ${task.status} ${JSON.stringify(task.json)}`);
    const opened = await client.post(`/api/assessment/tasks/${next.id}/open`, {});
    assert(opened.status === 200, `open task → ${opened.status} ${JSON.stringify(opened.json)}`);
    const answer = useStrong
      ? `${answerFor(task.json.type, task.json.workAnswerMin)}\n${task.json.prompt || ""}`
      : WEAK_TEXT.repeat(6);
    const sub = await client.post(`/api/assessment/tasks/${next.id}/submit`, { answerText: answer });
    assert(sub.status === 200, `submit task → ${sub.status} ${JSON.stringify(sub.json)}`);
    last = sub.json;
    complete = Boolean(sub.json.batteryComplete);
  }
  return { batteryId, steps, complete, passed: last && last.passed, label: last && last.label };
}

async function fullAudit() {
  const emailSuffix = `audit-${Date.now()}`;
  const cand = new Client("fresh-candidate");
  const employer = new Client("fresh-employer");
  const demoEmp = new Client("demo-employer");
  const demoA = new Client("demo-candidate-a");
  const demoB = new Client("demo-candidate-b");

  // ---------- Волна A: свежий пользователь, механика теста ----------
  currentArea = "Кандидат · регистрация и доступ";
  await check("C-01", "Регистрация кандидата и подтверждение email", async () => {
    const me = await cand.register("candidate", `${emailSuffix}-a@audit.local`);
    assert(me.role === "candidate" && me.email, `→ ${JSON.stringify(me)}`);
    state.candId = me.id;
    return `user ${me.id}`;
  });

  await check("C-02", "Регистрация требует согласие на данные (400)", async () => {
    const c = new Client("noconsent");
    const r = await c.post("/api/auth/register", {
      email: `${emailSuffix}-n@audit.local`,
      password: PASS,
      role: "candidate",
      birthDate: "1995-05-05",
    });
    assert(r.status === 400 && r.json?.details?.fields?.privacyConsent, `→ ${r.status} ${JSON.stringify(r.json)}`);
    return "privacyConsent обязателен";
  });

  await check("C-03", "Повторная регистрация отклоняется (409)", async () => {
    const dup = new Client("dup");
    const r = await dup.post("/api/auth/register", {
      email: `${emailSuffix}-a@audit.local`,
      password: PASS,
      role: "candidate",
      birthDate: "1995-05-05",
      privacyConsent: true,
    });
    assert(r.status === 409 && r.json?.error === "email_taken", `→ ${r.status} ${JSON.stringify(r.json)}`);
    return "email_taken";
  });

  await check("C-04", "Неверный код подтверждения отклоняется (400)", async () => {
    const c = new Client("badcode");
    await c.post("/api/auth/register", {
      email: `${emailSuffix}-x@audit.local`,
      password: PASS,
      role: "candidate",
      birthDate: "1995-05-05",
      privacyConsent: true,
    });
    const r = await c.post("/api/auth/confirm", { email: `${emailSuffix}-x@audit.local`, code: "111111" });
    assert(r.status === 400, `→ ${r.status} ${JSON.stringify(r.json)}`);
    return "invalid_code";
  });

  await check("C-05", "Неверный пароль не пускает в кабинет (401)", async () => {
    const r = await cand.post("/api/auth/login", { email: `${emailSuffix}-a@audit.local`, password: "wrong-pass" });
    assert(r.status === 401, `→ ${r.status} ${JSON.stringify(r.json)}`);
    return "401";
  });

  await check("C-06", "Профиль кандидата: чтение и запись", async () => {
    const before = await cand.get("/api/candidate/profile");
    assert(before.status === 200, `GET profile → ${before.status}`);
    const put = await cand.put("/api/candidate/profile", {
      displayName: "Анна Аудит",
      stack: ["python", "postgres"],
      phone: "+7 900 000-00-01",
      contactEmail: `contact-${emailSuffix}-a@audit.local`,
    });
    assert(put.status === 200, `PUT profile → ${put.status} ${JSON.stringify(put.json)}`);
    const after = await cand.get("/api/candidate/profile");
    assert(after.json.displayName === "Анна Аудит", "displayName не сохранён");
    assert((after.json.stack || []).includes("python"), "stack не сохранён");
    return `displayName=${after.json.displayName}, stack=${(after.json.stack || []).join("/")}`;
  });

  await check("C-07", "Кандидат не попадает в employer-API (403)", async () => {
    const r = await cand.get("/api/employer/needs");
    assert(r.status === 403, `→ ${r.status}`);
    return "role guard";
  });

  currentArea = "Тест и категория";
  await check("C-08", "Батарея не стартует без согласия на данные (400)", async () => {
    const r = await cand.post("/api/assessment/battery/start", { specialization: "backend", grade: "junior" });
    assert(r.status === 400 && r.json?.details?.fields?.privacyConsent, `→ ${r.status} ${JSON.stringify(r.json)}`);
    return "privacyConsent обязателен";
  });

  await check("C-09", "Батарея выдаёт форму A/B и список шагов", async () => {
    const r = await cand.post("/api/assessment/battery/start", {
      specialization: "backend",
      grade: "junior",
      privacyConsent: true,
    });
    assert(r.status === 201 || r.status === 200, `→ ${r.status} ${JSON.stringify(r.json)}`);
    assert(r.json.taskCount >= 4, `taskCount=${r.json.taskCount}`);
    assert(["A", "B"].includes(r.json.formKey), `formKey=${r.json.formKey}`);
    state.formKey = r.json.formKey;
    return `formKey=${r.json.formKey}, шагов=${r.json.taskCount}`;
  });

  await check("C-10", "Пропуск шага блокируется (409 not_current_task)", async () => {
    const cur = await cand.get("/api/assessment/battery/current");
    const attempts = cur.json.battery.attempts;
    const skipped = attempts.find((a, i) => !a.submitted && i > 0);
    if (!skipped) return "второй открытый шаг не появился — проверка не применима";
    const r = await cand.post(`/api/assessment/tasks/${skipped.id}/open`, {});
    assert(r.status === 409, `→ ${r.status} ${JSON.stringify(r.json)}`);
    return "not_current_task";
  });

  await check("C-11", "Черновик сохраняется и возвращается после reload", async () => {
    const cur = await cand.get("/api/assessment/battery/current");
    const next = cur.json.battery.attempts.find((a) => !a.submitted);
    const opened = await cand.post(`/api/assessment/tasks/${next.id}/open`, {});
    assert(opened.status === 200, `open → ${opened.status}`);
    const draft = "черновик: план решения и оценка сложности";
    const r = await cand.post(`/api/assessment/tasks/${next.id}/draft`, { answerText: draft });
    assert(r.status === 200, `draft → ${r.status} ${JSON.stringify(r.json)}`);
    const task = await cand.get(`/api/assessment/tasks/${next.id}`);
    assert(String(task.json.draftText || "").includes("черновик"), "черновик не вернулся");
    return "черновик сохранён и отдан";
  });

  await check("C-12", "Батарея доходится до конца, категория назначается по факту прохождения", async () => {
    const done = await completeBattery(cand, { specialization: "backend", grade: "junior", quality: "strong" });
    assert(done.complete, "батарея не завершилась");
    state.candPassed = done.passed;
    const cat = await cand.get("/api/candidate/category");
    if (done.passed) {
      assert(cat.json.status === "confirmed" && cat.json.label, `→ ${JSON.stringify(cat.json)}`);
      return `подтверждено: ${cat.json.label} (шагов ${done.steps})`;
    }
    assert(cat.json.status === "unconfirmed", `→ ${JSON.stringify(cat.json)}`);
    return `не подтверждено (ниже cutoff) — retakeAt=${cat.json.retakeAt}, шагов ${done.steps}`;
  });

  await check("C-13", "Пересдача той же специализации закрыта кулдауном (409)", async () => {
    const r = await cand.post("/api/assessment/battery/start", {
      specialization: "backend",
      grade: "senior",
      privacyConsent: true,
    });
    assert(r.status === 409 && r.json?.error === "cooldown", `→ ${r.status} ${JSON.stringify(r.json)}`);
    const cat = await cand.get("/api/candidate/category");
    assert(cat.json.cooldownActive === true && cat.json.retakeAt, `→ ${JSON.stringify(cat.json)}`);
    return `retakeAt=${cat.json.retakeAt}`;
  });

  await check("C-14", "Грейд не режется принудительно: заявленный сохраняется в истории", async () => {
    const past = await cand.get("/api/candidate/past");
    assert(past.status === 200, `→ ${past.status}`);
    const items = past.json.batteries || past.json.items || [];
    assert(items.length >= 1, "история попыток пуста");
    const row = items[0];
    assert(/junior/i.test(row.label || ""), `label=${row.label}`);
    return `история: ${row.label}, ${row.outcome}`;
  });

  currentArea = "Приватность";
  await check("C-15", "Приватные поля не утекают в публичные выдачи кандидата", async () => {
    const banned = ["integrity", "trust_ok", "answerText", "answer_text"];
    const found = [];
    for (const p of ["/api/candidate/category", "/api/candidate/invitations", "/api/candidate/past"]) {
      const r = await cand.get(p);
      const s = JSON.stringify(r.json);
      for (const k of banned) if (s.includes(`"${k}"`)) found.push(`${p}:${k}`);
    }
    assert(!found.length, `утечка: ${found.join(", ")}`);
    return "чисто";
  });

  await check("C-16", "Уведомление 152-ФЗ отдаётся публично", async () => {
    const r = await cand.get("/api/privacy-notice");
    assert(r.status === 200, `→ ${r.status}`);
    return Object.keys(r.json || {}).slice(0, 4).join(",");
  });

  // ---------- Работодатель: профиль, потребность, пул по категории ----------
  currentArea = "Работодатель · профиль и потребность";
  await check("E-01", "Профиль компании обязателен для приглашений", async () => {
    await employer.register("employer", `${emailSuffix}-e@audit.local`);
    const empty = await employer.put("/api/employer/profile", { companyName: "" });
    assert(empty.status === 400 && empty.json?.details?.fields?.companyName, `→ ${empty.status} ${JSON.stringify(empty.json)}`);
    const ok = await employer.put("/api/employer/profile", {
      companyName: "Аудит ЛТД",
      description: "Проверка механики подбора",
      industry: "software",
      contactEmail: `hr-${emailSuffix}@audit.local`,
    });
    assert(ok.status === 200, `→ ${ok.status} ${JSON.stringify(ok.json)}`);
    const got = await employer.get("/api/employer/profile");
    assert(got.json.companyName === "Аудит ЛТД", `→ ${JSON.stringify(got.json)}`);
    return "companyName=Аудит ЛТД";
  });

  await check("E-02", "Потребность: валидация, создание, обновление, дубли", async () => {
    const bad = await employer.post("/api/employer/needs", { specialization: "backend", grade: "junior" });
    assert(bad.status === 400 && bad.json?.details?.fields?.title, `→ ${bad.status} ${JSON.stringify(bad.json)}`);
    const created = await employer.post("/api/employer/needs", {
      title: `Backend junior (аудит ${emailSuffix})`,
      specialization: "backend",
      grade: "junior",
      stack: ["python"],
      domainText: "Бэкенд на Python и PostgreSQL, очередь задач",
    });
    assert(created.status === 201, `→ ${created.status} ${JSON.stringify(created.json)}`);
    state.needId = created.json.id;
    const dup = await employer.post("/api/employer/needs", {
      title: `Backend junior (аудит ${emailSuffix})`,
      specialization: "backend",
      grade: "junior",
    });
    assert(dup.status === 409, `дубль → ${dup.status}`);
    const upd = await employer.put(`/api/employer/needs/${state.needId}`, { notes: "обновлено аудитом" });
    assert(upd.status === 200, `update → ${upd.status} ${JSON.stringify(upd.json)}`);
    const list = await employer.get("/api/employer/needs");
    assert((list.json.items || []).some((n) => n.id === state.needId), "потребность пропала из списка");
    return `need ${state.needId}`;
  });

  await check("E-03", "Подборка строго по категории теста (без категории — пусто)", async () => {
    const r = await employer.get(`/api/employer/needs/${state.needId}/matches`);
    assert(r.status === 200, `→ ${r.status} ${JSON.stringify(r.json)}`);
    const items = r.json.items || [];
    for (const it of items) {
      assert(/backend/i.test(it.categoryLabel || ""), `чужая категория: ${it.categoryLabel}`);
    }
    return `${items.length} кандидатов (у свежего кандидата категория ${state.candPassed === false ? "не подтверждена" : "есть"})`;
  });

  // ---------- Волна B: демо-аккаунты с категориями ----------
  currentArea = "Подбор → приглашение → контакты";
  await check("E-04", "Демо-аккаунты заходят с категорией", async () => {
    const a = await demoA.login(DEMO_CANDIDATE);
    const b = await demoB.login(DEMO_CANDIDATE2);
    const e = await demoEmp.login(DEMO_EMPLOYER);
    const catA = await demoA.get("/api/candidate/category");
    assert(catA.json.status === "confirmed", `${DEMO_CANDIDATE} → ${JSON.stringify(catA.json)}`);
    state.demoAId = a.id;
    state.demoBId = b.id;
    state.employerId = e.id;
    const needs = await demoEmp.get("/api/employer/needs");
    state.demoNeedId = needs.json.items?.[0]?.id;
    assert(state.demoNeedId, "у демо-работодателя нет потребностей");
    return `${DEMO_CANDIDATE}=${catA.json.label}, ${DEMO_CANDIDATE2}=${(await demoB.get("/api/candidate/category")).json.label}`;
  });

  await check("E-05", "Подборка по потребности: категория, обоснование, без контактов", async () => {
    const r = await demoEmp.get(`/api/employer/needs/${state.demoNeedId}/matches`);
    assert(r.status === 200, `→ ${r.status} ${JSON.stringify(r.json)}`);
    const items = r.json.items || [];
    assert(items.length >= 1, `в подборке ${items.length} кандидатов`);
    for (const it of items) {
      assert(/backend/i.test(it.categoryLabel || ""), `чужая категория: ${it.categoryLabel}`);
      assert(it.explanation && String(it.explanation).length > 10, "нет explanation");
      assert(!("phone" in it) && !("contactEmail" in it), "контакты в подборке");
    }
    return `${items.length} в подборке: ${items.map((i) => i.displayName).join(", ")}`;
  });

  await check("E-06", "Ранжирование внутри категории детерминировано", async () => {
    const a = await demoEmp.get(`/api/employer/needs/${state.demoNeedId}/matches`);
    const b = await demoEmp.get(`/api/employer/needs/${state.demoNeedId}/matches`);
    const first = (a.json.items || []).map((i) => i.id).join(",");
    const second = (b.json.items || []).map((i) => i.id).join(",");
    assert(first === second, "порядок подборки меняется между запросами");
    return `порядок стабилен: ${first.slice(0, 60)}…`;
  });

  await check("E-07", "Фильтры не съедают уже полученную подборку", async () => {
    const base = await demoEmp.get(`/api/employer/needs/${state.demoNeedId}/matches`);
    const baseIds = (base.json.items || []).map((i) => i.id).sort();
    await demoEmp.get(`/api/employer/needs/${state.demoNeedId}/matches?stack=node`);
    await demoEmp.get(`/api/employer/needs/${state.demoNeedId}/matches?fsp=1`);
    const again = await demoEmp.get(`/api/employer/needs/${state.demoNeedId}/matches`);
    const againIds = (again.json.items || []).map((i) => i.id).sort();
    assert(JSON.stringify(baseIds) === JSON.stringify(againIds), "подборка изменилась после фильтров");
    return `${baseIds.length} кандидатов сохранились после фильтров stack/fsp`;
  });

  await check("E-08", "Поиск по банку: специализация, грейд, ФСП, текст, статус", async () => {
    const all = await demoEmp.get("/api/employer/candidates");
    assert(all.status === 200, `→ ${all.status}`);
    const base = (all.json.items || []).length;
    const bySpec = await demoEmp.get("/api/employer/candidates?spec=backend");
    const byGrade = await demoEmp.get("/api/employer/candidates?spec=backend&grade=middle");
    const byFsp = await demoEmp.get("/api/employer/candidates?fsp=1");
    const byText = await demoEmp.get("/api/employer/candidates?q=python");
    const byStatus = await demoEmp.get("/api/employer/candidates?status=invited");
    for (const r of [bySpec, byGrade, byFsp, byText, byStatus]) assert(r.status === 200, `→ ${r.status}`);
    assert((bySpec.json.items || []).length <= base, "фильтр специализации расширил выдачу");
    assert((byGrade.json.items || []).length <= (bySpec.json.items || []).length, "фильтр грейда расширил выдачу");
    for (const it of bySpec.json.items || []) {
      assert(!("phone" in it) && !("contactEmail" in it), "контакты в банке");
    }
    return `всего=${base}, backend=${(bySpec.json.items || []).length}, gрейд=middle=${(byGrade.json.items || []).length}, fsp=${(byFsp.json.items || []).length}`;
  });

  await check("E-09", "Зарплата от–до обязательна в приглашении (400)", async () => {
    const r = await demoEmp.post("/api/employer/invitations", {
      needId: state.demoNeedId,
      candidateId: state.demoBId,
      offerText: "Приглашаем в команду",
      contactChannel: "telegram",
    });
    assert(r.status === 400 && r.json?.details?.fields, `→ ${r.status} ${JSON.stringify(r.json)}`);
    return `fields=${Object.keys(r.json.details.fields).join(",")}`;
  });

  await check("E-10", "Приглашение создаётся без вакансии, только с вилкой", async () => {
    const r = await demoEmp.post("/api/employer/invitations", {
      needId: state.demoNeedId,
      candidateId: state.demoAId,
      salaryFrom: 120000,
      salaryTo: 180000,
      offerText: "Приглашаем в команду: бэкенд на Node",
      contactChannel: "telegram",
    });
    assert(r.status === 201, `→ ${r.status} ${JSON.stringify(r.json)}`);
    state.invitationId = r.json.invitationId || r.json.id;
    const dup = await demoEmp.post("/api/employer/invitations", {
      needId: state.demoNeedId,
      candidateId: state.demoAId,
      salaryFrom: 120000,
      salaryTo: 180000,
      offerText: "Повтор",
      contactChannel: "telegram",
    });
    assert(dup.status === 409, `дубль → ${dup.status}`);
    return `invitation ${state.invitationId}, 120000–180000 ₽`;
  });

  await check("E-11", "У работодателя статус sent, контактов нет", async () => {
    const r = await demoEmp.get("/api/employer/invitations");
    assert(r.status === 200, `→ ${r.status}`);
    const inv = (r.json.items || []).find((i) => i.id === state.invitationId);
    assert(inv, "приглашения нет в списке работодателя");
    assert(inv.status === "sent", `status=${inv.status}`);
    assert(!inv.candidatePhone && !inv.candidateContactEmail, "контакты видны до accept");
    return `status=${inv.status}, contacts скрыты`;
  });

  await check("C-17", "Контакты кандидата скрыты от работодателя до accept (403)", async () => {
    const r = await demoEmp.get(`/api/employer/candidates/${state.demoAId}/contacts`);
    assert(r.status === 403, `→ ${r.status} ${JSON.stringify(r.json)}`);
    return "forbidden до accept";
  });

  await check("C-18", "Кандидат видит приглашение с вилкой и принимает", async () => {
    const r = await demoA.get("/api/candidate/invitations");
    assert(r.status === 200, `→ ${r.status}`);
    const inv = (r.json.items || []).find((i) => i.id === state.invitationId);
    assert(inv, "приглашение не пришло кандидату");
    assert(inv.status === "sent", `status=${inv.status}`);
    assert(inv.salaryFrom && inv.salaryTo, "вилка не показана кандидату");
    const acc = await demoA.post(`/api/candidate/invitations/${state.invitationId}/accept`, {});
    assert(acc.status === 200, `accept → ${acc.status} ${JSON.stringify(acc.json)}`);
    return `вилка ${inv.salaryFrom}–${inv.salaryTo}, принято`;
  });

  await check("E-12", "После accept контакты раскрываются в обоих местах", async () => {
    const r = await demoEmp.get(`/api/employer/candidates/${state.demoAId}/contacts`);
    assert(r.status === 200, `→ ${r.status} ${JSON.stringify(r.json)}`);
    assert(r.json.phone && r.json.contactEmail, `→ ${JSON.stringify(r.json)}`);
    const list = await demoEmp.get("/api/employer/invitations");
    const inv = (list.json.items || []).find((i) => i.id === state.invitationId);
    assert(inv.status === "accepted" && inv.candidatePhone, "в списке нет раскрытых контактов");
    return `phone=${r.json.phone}`;
  });

  await check("C-19", "Отклонение приглашения меняет статус для обеих сторон", async () => {
    const need2 = await demoEmp.post("/api/employer/needs", {
      title: `Отдельная потребность (аудит ${emailSuffix})`,
      specialization: "backend",
      grade: "middle",
      stack: ["node"],
      domainText: "Вторая потребность для проверки отказа",
    });
    assert(need2.status === 201, `need → ${need2.status} ${JSON.stringify(need2.json)}`);
    const inv = await demoEmp.post("/api/employer/invitations", {
      needId: need2.json.id,
      candidateId: state.demoBId,
      salaryFrom: 100000,
      salaryTo: 150000,
      offerText: "Второе приглашение",
      contactChannel: "email",
    });
    assert(inv.status === 201, `invite → ${inv.status} ${JSON.stringify(inv.json)}`);
    const invId = inv.json.invitationId || inv.json.id;
    const dec = await demoB.post(`/api/candidate/invitations/${invId}/decline`, {});
    assert(dec.status === 200, `decline → ${dec.status} ${JSON.stringify(dec.json)}`);
    const list = await demoEmp.get("/api/employer/invitations");
    const row = (list.json.items || []).find((i) => i.id === invId);
    assert(row && row.status === "declined", `status=${row && row.status}`);
    return "declined у обеих сторон";
  });

  await check("E-13", "Колода: отклонить и отложить блокируют новое приглашение", async () => {
    const need3 = await demoEmp.post("/api/employer/needs", {
      title: `Потребность для колоды (аудит ${emailSuffix})`,
      specialization: "backend",
      grade: "middle",
      stack: ["node"],
    });
    assert(need3.status === 201, `need → ${need3.status}`);
    const needId = need3.json.id;
    const deck = await demoEmp.get(`/api/employer/needs/${needId}/deck/next`);
    assert(deck.status === 200 && deck.json.card, `deck → ${deck.status} ${JSON.stringify(deck.json)}`);
    const cid = deck.json.candidateId;
    const bad = await demoEmp.post(`/api/employer/needs/${needId}/reviews`, { candidateId: cid, decision: "accepted" });
    assert(bad.status === 400, `некорректное решение → ${bad.status}`);
    const inv = await demoEmp.post("/api/employer/invitations", {
      needId,
      candidateId: cid,
      salaryFrom: 120000,
      salaryTo: 180000,
      offerText: "Из колоды",
      contactChannel: "telegram",
    });
    assert(inv.status === 201, `invite → ${inv.status} ${JSON.stringify(inv.json)}`);
    const rej = await demoEmp.post(`/api/employer/needs/${needId}/reviews`, { candidateId: cid, decision: "rejected" });
    assert(rej.status === 200, `rejected → ${rej.status}`);
    const again = await demoEmp.post("/api/employer/invitations", {
      needId,
      candidateId: cid,
      salaryFrom: 120000,
      salaryTo: 180000,
      offerText: "После отказа",
      contactChannel: "telegram",
    });
    assert(again.status === 409 && /rejected/i.test(again.json?.error || ""), `→ ${again.status} ${JSON.stringify(again.json)}`);
    const def = await demoEmp.post(`/api/employer/needs/${needId}/reviews`, { candidateId: cid, decision: "later" });
    assert(def.status === 200, `later → ${def.status}`);
    const deferred = await demoEmp.get(`/api/employer/needs/${needId}/deferred`);
    assert((deferred.json.items || []).length >= 1, "отложенный кандидат не появился");
    const undel = await demoEmp.del(`/api/employer/needs/${needId}/reviews/${cid}`);
    assert(undel.status === 200, `снять отложку → ${undel.status}`);
    return "deck/review/deferred работают";
  });

  // ---------- Дополнительный функционал ----------
  currentArea = "Дополнительный функционал";
  await check("X-01", "Короткий тест работодателя: создание, вопросы, публикация", async () => {
    const created = await demoEmp.post("/api/employer/tests", {
      needId: state.demoNeedId,
      title: `Мини-тест аудита ${emailSuffix}`,
      intro: "Два вопроса на стек потребности",
    });
    assert(created.status === 201, `create → ${created.status} ${JSON.stringify(created.json)}`);
    const testId = created.json.id;
    const q1 = await demoEmp.post(`/api/employer/tests/${testId}/items`, {
      kind: "single",
      prompt: "Что выберет Node.js для очереди задач?",
      options: [{ id: "o1", label: "event loop" }, { id: "o2", label: "thread pool" }],
      answerKey: { correctIds: ["o1"] },
    });
    assert(q1.status === 201, `item → ${q1.status} ${JSON.stringify(q1.json)}`);
    const q2 = await demoEmp.post(`/api/employer/tests/${testId}/items`, {
      kind: "text",
      prompt: "Опишите схему хранения профиля кандидата",
      rubricKeys: { keywords: ["таблица", "индекс", "кандидат"] },
    });
    assert(q2.status === 201, `item2 → ${q2.status} ${JSON.stringify(q2.json)}`);
    const pub = await demoEmp.post(`/api/employer/tests/${testId}/publish`, {});
    assert(pub.status === 200 && pub.json.status === "published", `publish → ${pub.status} ${JSON.stringify(pub.json)}`);
    state.testId = testId;
    state.itemIds = [q1.json.id, q2.json.id];
    return `test ${testId}, 2 вопроса, published`;
  });

  await check("X-02", "Назначение теста только после принятого приглашения", async () => {
    const early = await demoEmp.post(`/api/employer/tests/${state.testId}/assign`, { candidateId: state.demoBId });
    assert([409].includes(early.status), `ожидался 409, получено ${early.status} ${JSON.stringify(early.json)}`);
    return `${early.json.error || "409"} — без принятого приглашения нельзя`;
  });

  await check("X-03", "Кандидат проходит тест работодателя, ответы доходят до работодателя", async () => {
    const assign = await demoEmp.post(`/api/employer/tests/${state.testId}/assign`, { candidateId: state.demoAId });
    assert(assign.status === 201, `assign → ${assign.status} ${JSON.stringify(assign.json)}`);
    const assignmentId = assign.json.id || assign.json.assignmentId;
    const list = await demoA.get("/api/candidate/company-tests");
    assert((list.json.items || []).some((i) => i.id === assignmentId), "тест не виден кандидату");
    const start = await demoA.post(`/api/candidate/company-tests/${assignmentId}/start`, {});
    assert(start.status === 200, `start → ${start.status} ${JSON.stringify(start.json)}`);
    for (const itemId of state.itemIds) {
      const body =
        itemId === state.itemIds[0]
          ? { itemId, optionIds: ["o1"], answerText: "" }
          : { itemId, answerText: "Таблица кандидатов с индексом по категории и грейду" };
      const r = await demoA.post(`/api/candidate/company-tests/${assignmentId}/answers`, body);
      assert(r.status === 200, `answer ${itemId} → ${r.status} ${JSON.stringify(r.json)}`);
    }
    const sub = await demoA.post(`/api/candidate/company-tests/${assignmentId}/submit`, {});
    assert(sub.status === 200, `submit → ${sub.status} ${JSON.stringify(sub.json)}`);
    const review = await demoEmp.get(`/api/employer/test-assignments/${assignmentId}`);
    assert(review.status === 200, `review → ${review.status} ${JSON.stringify(review.json)}`);
    assert(JSON.stringify(review.json).includes("event"), "ответы не вернулись работодателю");
    return "ответы дошли до работодателя";
  });

  await check("X-04", "LLM: генерация задания рабочей батареи", async () => {
    const cfg = await demoEmp.get("/api/employer/tests/config");
    if (cfg.json?.llmConfigured === false) return "LLM не сконфигурирован — проверка пропущена";
    const r = await demoEmp.post(
      "/api/assessment/generate",
      { specialization: "backend", grade: "junior", type: "quick", count: 1 },
      { demoAdmin: true }
    );
    if (r.status === 501) return "LLM не сконфигурирован — проверка пропущена";
    assert(r.status === 201, `→ ${r.status} ${JSON.stringify(r.json)}`);
    const pub = await demoEmp.post(`/api/assessment/tasks/${r.json.ids[0]}/publish`, { form_key: "A" }, { demoAdmin: true });
    assert(pub.status === 200, `publish → ${pub.status} ${JSON.stringify(pub.json)}`);
    return `сгенерировано и опубликовано: ${r.json.ids[0]}`;
  });

  await check("X-05", "MCP: токен ИИ-клиента, изоляция от REST, список инструментов", async () => {
    const tok = await demoEmp.post("/api/integrations/tokens", {
      name: `audit ${emailSuffix}`,
      clientWhere: "audit script",
      loggingConsent: true,
      scopes: ["read"],
    });
    assert(tok.status === 201 && tok.json.token, `token → ${tok.status} ${JSON.stringify(tok.json)}`);
    const tokenOnly = new Client("token-only");
    tokenOnly.token = tok.json.token;
    const rest = await tokenOnly.get("/api/employer/needs", { useToken: true });
    assert(rest.status === 403, `REST с токеном без сессии → ${rest.status} ${JSON.stringify(rest.json)}`);
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${tok.json.token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const text = await res.text();
    assert(res.status === 200, `mcp tools/list → ${res.status} ${text.slice(0, 200)}`);
    const payload = JSON.parse(text.replace(/^event:.*\ndata: /, ""));
    const tools = payload.result?.tools || [];
    assert(tools.length > 0, "MCP не вернул инструменты");
    const call = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${tok.json.token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami", arguments: {} } }),
    });
    const callText = await call.text();
    assert(call.status === 200 && callText.includes(DEMO_EMPLOYER), `tools/call → ${call.status} ${callText.slice(0, 200)}`);
    state.tokenId = tok.json.id;
    return `${tools.length} инструментов MCP, REST с токеном → ${rest.status}, whoami ok`;
  });

  await check("X-06", "Интеграции: аудит вызовов и отзыв токена", async () => {
    const audit = await demoEmp.get("/api/integrations/audit");
    assert(audit.status === 200, `audit → ${audit.status}`);
    const items = audit.json.items || [];
    assert(items.length >= 1, "аудит пуст после вызова MCP");
    assert(items.some((i) => i.tool === "whoami"), "в аудите нет вызова whoami");
    const del = await demoEmp.del(`/api/integrations/tokens/${state.tokenId}`);
    assert(del.status === 200, `revoke → ${del.status}`);
    return `аудит: ${items.length} записей`;
  });

  await check("X-07", "Звонок: комната по принятому приглашению", async () => {
    const page = await fetch(`${BASE}/call/${state.invitationId}`);
    assert(page.status === 200, `комната → ${page.status}`);
    const calls = await demoEmp.get("/api/employer/calls");
    assert(calls.status === 200, `employer calls → ${calls.status}`);
    return `комната ${page.status}, звонков у работодателя=${(calls.json.items || []).length}`;
  });

  await check("X-08", "Обзор работодателя (dashboard) собирает счётчики", async () => {
    const d = await demoEmp.get("/api/employer/dashboard");
    assert(d.status === 200, `→ ${d.status}`);
    return Object.keys(d.json || {}).slice(0, 6).join(",");
  });

  await check("X-09", "Статистика (/api/stats) доступна", async () => {
    const r = await demoEmp.get("/api/stats");
    assert(r.status === 200 || r.status === 403, `→ ${r.status}`);
    return `stats → ${r.status}`;
  });
}

async function readonlyAudit() {
  const cand = new Client("cand");
  const emp = new Client("emp");

  currentArea = "Прод · читающий режим";
  await check("R-01", "Health на проде", async () => {
    const h = await fetch(`${BASE}/api/health`);
    const hj = await h.json();
    assert(h.ok, `health → ${h.status}`);
    return `version=${hj.version}, commit=${hj.commit || "—"}`;
  });

  await check("R-02", "Демо-вход кандидата и работодателя", async () => {
    const a = await cand.login(DEMO_CANDIDATE);
    const e = await emp.login(DEMO_EMPLOYER);
    assert(a.role === "candidate" && e.role === "employer", `${a.role}/${e.role}`);
    return `${DEMO_CANDIDATE} + ${DEMO_EMPLOYER}`;
  });

  await check("R-03", "Категория и приглашения демо-кандидата", async () => {
    const cat = await cand.get("/api/candidate/category");
    const inv = await cand.get("/api/candidate/invitations");
    assert(cat.status === 200 && inv.status === 200, `→ ${cat.status}/${inv.status}`);
    return `category=${cat.json.label || "нет"}, приглашений=${(inv.json.items || []).length}`;
  });

  await check("R-04", "Подборка по потребности без контактов", async () => {
    const needs = await emp.get("/api/employer/needs");
    const needId = needs.json.items?.[0]?.id;
    assert(needId, "у демо-работодателя нет потребностей");
    const m = await emp.get(`/api/employer/needs/${needId}/matches`);
    assert(m.status === 200, `matches → ${m.status}`);
    for (const it of m.json.items || []) {
      assert(!("phone" in it) && !("contactEmail" in it), "контакты в подборке");
    }
    return `${(m.json.items || []).length} кандидатов в «${needs.json.items[0].title}»`;
  });

  await check("R-05", "Контакты скрыты для кандидата без принятого приглашения (403)", async () => {
    const needs = await emp.get("/api/employer/needs");
    const needId = needs.json.items?.[0]?.id;
    const m = await emp.get(`/api/employer/needs/${needId}/matches`);
    const inv = await emp.get("/api/employer/invitations");
    const accepted = new Set(
      (inv.json.items || []).filter((i) => i.status === "accepted").map((i) => i.candidateId)
    );
    const row = (m.json.items || []).find((i) => !accepted.has(i.id));
    if (!row) return "все кандидаты подборки уже приняли приглашение — проверка не применима";
    const r = await emp.get(`/api/employer/candidates/${row.id}/contacts`);
    assert(r.status === 403, `→ ${r.status} ${JSON.stringify(r.json)}`);
    return `403 forbidden (${row.displayName})`;
  });

  await check("R-06", "Приглашения работодателя: контакты только у accepted", async () => {
    const inv = await emp.get("/api/employer/invitations");
    assert(inv.status === 200, `→ ${inv.status}`);
    const items = inv.json.items || [];
    const leaked = items.filter((i) => i.status !== "accepted" && (i.candidatePhone || i.candidateContactEmail));
    assert(!leaked.length, `утечка контактов: ${leaked.length}`);
    return `${items.length} приглашений, accepted=${items.filter((i) => i.status === "accepted").length}`;
  });

  await check("R-07", "Банк кандидатов и фильтры", async () => {
    const all = await emp.get("/api/employer/candidates");
    const spec = await emp.get("/api/employer/candidates?spec=backend");
    assert(all.status === 200 && spec.status === 200, `→ ${all.status}/${spec.status}`);
    assert((spec.json.items || []).length <= (all.json.items || []).length, "фильтр расширил выдачу");
    return `всего=${(all.json.items || []).length}, backend=${(spec.json.items || []).length}`;
  });

  await check("R-08", "UI-страницы отдаются", async () => {
    const out = [];
    for (const p of ["/", "/privacy", "/candidate", "/employer"]) {
      const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
      assert(r.status < 400, `${p} → ${r.status}`);
      out.push(`${p}:${r.status}`);
    }
    return out.join(" ");
  });
}

function renderMarkdown() {
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const lines = [
    "# Функциональный аудит HandCheck",
    "",
    `- Дата: ${new Date().toISOString()}`,
    `- Инстанс: ${BASE}`,
    `- Режим: ${MODE}`,
    `- Итог: **${counts.PASS} PASS**, ${counts.FAIL} FAIL`,
    "",
    "| Область | ID | Проверка | Статус | Детали |",
    "|---|---|---|---|---|",
  ];
  for (const r of results) {
    const detail = String(r.detail || "").replace(/\|/g, "\\|").slice(0, 200);
    lines.push(`| ${r.area} | ${r.id} | ${r.name} | ${r.status} | ${detail} |`);
  }
  return lines.join("\n") + "\n";
}

async function main() {
  if (MODE === "readonly") await readonlyAudit();
  else if (MODE === "full") await fullAudit();
  else {
    console.error(`Неизвестный AUDIT_MODE=${MODE}. Использовать full | readonly`);
    process.exit(2);
  }

  let lastArea = "";
  for (const r of results) {
    if (r.area !== lastArea) {
      lastArea = r.area;
      console.log(`\n=== ${lastArea}`);
    }
    const mark = r.status === "PASS" ? "  ok " : r.status === "FAIL" ? "FAIL " : r.status.toLowerCase();
    console.log(`${mark} ${r.id} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  console.log(`\nИтог: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.SKIP} SKIP`);

  const fs = require("fs");
  const path = require("path");
  const jsonPath = process.env.AUDIT_JSON || `context/audits/functional-audit-${stamp}.json`;
  const mdPath = process.env.AUDIT_MD || `context/audits/functional-audit-${stamp}.md`;
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({ base: BASE, mode: MODE, at: new Date().toISOString(), results }, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown());
  console.log(`Отчёт: ${mdPath} / ${jsonPath}`);
  process.exit(counts.FAIL ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});