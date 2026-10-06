"use strict";

const BASE = process.env.BASE_URL || "https://handcheck.baski.pro";
const PASS = process.env.DEMO_PASSWORD || "demo-demo-demo";

const issues = [];

function fail(msg) {
  issues.push({ severity: "fail", msg });
  console.error("FAIL:", msg);
}

function warn(msg) {
  issues.push({ severity: "warn", msg });
  console.warn("WARN:", msg);
}

class Client {
  constructor() {
    this.cookie = "";
  }

  async req(method, path, body) {
    const headers = { Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const part = c.split(";")[0];
      if (part.startsWith("handcheck_sid=")) this.cookie = part;
    }
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 120) };
    }
    return { status: res.status, json, headers: res.headers };
  }

  async login(email) {
    const r = await this.req("POST", "/api/auth/login", { email, password: PASS });
    if (r.status !== 200) fail(`login ${email}: ${r.status}`);
    return r;
  }
}

async function main() {
  const h = await fetch(`${BASE}/api/health`);
  if (!h.ok) fail("health");
  else console.log("health OK");

  const anna = new Client();
  await anna.login("anna@demo.local");
  const me = await anna.req("GET", "/api/me");
  if (me.json.role !== "candidate") fail("anna role");

  const privKeys = ["integrity", "test_score", "motivation", "trust_ok"];
  for (const path of ["/api/candidate/category", "/api/candidate/invitations"]) {
    const r = await anna.req("GET", path);
    const s = JSON.stringify(r.json);
    for (const k of privKeys) {
      if (s.includes(`"${k}"`)) fail(`${path} leaks ${k}`);
    }
  }

  const cafe = new Client();
  await cafe.login("cafe@demo.local");
  const needs = await cafe.req("GET", "/api/employer/needs");
  const needId = needs.json.items?.[0]?.id;
  if (!needId) fail("cafe need missing");

  const matches = await cafe.req("GET", `/api/employer/needs/${needId}/matches`);
  if (matches.status !== 200) fail(`matches ${matches.status}`);
  const items = matches.json.items || [];
  if (items.length < 1) warn("no matches for cafe need");
  const annaRow = items.find((i) => /anna/i.test(i.displayName || ""));
  const borisRow = items.find((i) => /boris|борис/i.test(i.displayName || ""));
  if (annaRow && borisRow && items.indexOf(annaRow) > items.indexOf(borisRow)) {
    fail("M1 prod: Anna should rank above Boris on cafe need");
  }
  for (const row of items) {
    if (row.explanation && /\d/.test(String(row.explanation))) warn("match explanation has digits");
  }

  const deck = await cafe.req("GET", `/api/employer/needs/${needId}/deck/next`);
  if (deck.status !== 200) fail(`deck ${deck.status}`);

  const other = new Client();
  await other.login("other@demo.local");
  const beforeAccept = await other.req(
    "GET",
    `/api/employer/invitations`
  );
  void beforeAccept;

  console.log("\nIssues:", issues.length);
  console.log(JSON.stringify(issues, null, 2));
  if (issues.some((i) => i.severity === "fail")) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
