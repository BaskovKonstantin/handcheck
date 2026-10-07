"use strict";

const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

function envBool(name, def = false) {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return v === "1" || v.toLowerCase() === "true";
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "handcheck-dev.sqlite");
const DATA_DIR = path.dirname(DB_PATH);

function resolveSessionSecret() {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const secretPath = path.join(DATA_DIR, "session.secret");
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, "utf8").trim();
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const secret = require("crypto").randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

/** 152-ФЗ operator notice: PRIVACY_OPERATOR_NAME, PRIVACY_OPERATOR_INN, PRIVACY_OPERATOR_EMAIL */
const APP_BASE_URL = process.env.APP_BASE_URL || "http://127.0.0.1:8810";

function cookieSecureFromAppUrl(baseUrl) {
  try {
    return new URL(baseUrl).protocol === "https:";
  } catch {
    return false;
  }
}

module.exports = {
  PORT: Number(process.env.PORT || 8810),
  DB_PATH,
  DATA_DIR,
  SESSION_SECRET: resolveSessionSecret(),
  GRADE_COOLDOWN_DAYS: Number(process.env.GRADE_COOLDOWN_DAYS || 90),
  APP_BASE_URL,
  COOKIE_SECURE: cookieSecureFromAppUrl(APP_BASE_URL),
  DEMO_MODE: envBool("DEMO_MODE", false),
  DEMO_PASSWORD: process.env.DEMO_PASSWORD || "demo-demo-demo",
  LLM_BASE_URL: process.env.LLM_BASE_URL || "",
  LLM_API_KEY: process.env.LLM_API_KEY || "",
  COOKIE_NAME: "handcheck_sid",
  CALLS_DIR: path.join(DATA_DIR, "calls"),
  MCP_RATE_LIMIT_PER_MIN: Number(process.env.MCP_RATE_LIMIT_PER_MIN || 120),
};
