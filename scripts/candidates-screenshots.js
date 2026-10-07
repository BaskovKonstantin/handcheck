"use strict";

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "handcheck-ui", "employer-candidates");
const PASS = "demo-demo-demo";

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn("node", ["app/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DEMO_MODE: "1",
      DEMO_PASSWORD: PASS,
      PORT: "8811",
      DB_PATH: path.join(ROOT, "data", "candidates-shots.sqlite"),
    },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 900));
  const base = "http://127.0.0.1:8811";
  const browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/auth`);
    await page.fill("#email", "cafe@demo.local");
    await page.fill("#password", PASS);
    await page.click("#primary-action");
    await page.waitForURL(/employer/);
    await page.goto(`${base}/employer/candidates`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(OUT, `candidates-${width}.png`), fullPage: true });
    await page.close();
  }
  await browser.close();
  srv.kill("SIGTERM");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
