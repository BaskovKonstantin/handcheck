import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = process.env.BASE || "http://127.0.0.1:8811";
const OUT = path.join("handcheck-ui", "round14", "pr");
fs.mkdirSync(OUT, { recursive: true });

async function login(page, email) {
  await page.goto(`${BASE}/auth`);
  await page.fill("#email", email);
  await page.fill("#password", "demo-demo-demo");
  await page.click("#primary-action");
  await page.waitForURL(/\/(candidate|employer)\//);
}

const shots = [
  ["cafe-list-1280", "/employer/list", "cafe@demo.local", 1280],
  ["cafe-list-390", "/employer/list", "cafe@demo.local", 390],
  ["cafe-integrations-1280", "/employer/integrations", "cafe@demo.local", 1280],
  ["anna-integrations-390", "/candidate/integrations", "anna@demo.local", 390],
  ["anna-past-1280", "/candidate/past", "anna@demo.local", 1280],
];

const browser = await chromium.launch();
for (const [name, route, email, width] of shots) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await login(page, email);
  await page.goto(`${BASE}${route}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  await page.close();
}
await browser.close();
console.log("saved to", OUT);
