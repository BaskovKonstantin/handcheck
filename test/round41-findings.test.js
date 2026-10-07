"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const request = require("supertest");
const { registerPayload } = require("./register-payload");
const { createApp } = require("../app/server");
const {
  concatSessionWebmBuffers,
  ffmpegAvailable,
} = require("../app/lib/webm-ffmpeg");
const {
  looksLikeKeywordListAnswer,
  keywordTrapMultiplier,
  applyBatteryScoreGuards,
  aggregateBattery,
  scoreQuick,
  scoreWork,
} = require("../app/lib/rubric-score");
const { expireStaleOpenQuickAttempts } = require("../app/lib/assessment-auto-expire");
const { QUICK_PROMPTS, QUICK_PROMPTS_FORM_B } = require("../app/db/task-battery-content");
const honest = require("../scripts/fixtures/distinct-quick-answers");
const traps = require("../scripts/fixtures/keyword-trap-answers");
const config = require("../app/config");

function makeWebmFixture(seconds = 2, mapOrder = "va") {
  const out = path.join(os.tmpdir(), `hc-fixture-${process.pid}-${Date.now()}-${mapOrder}.webm`);
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=320x240:rate=15:duration=${seconds}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${seconds}`,
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "80k",
      "-c:a",
      "libopus",
      "-shortest",
      ...(mapOrder === "av" ? ["-map", "1:a:0", "-map", "0:v:0"] : []),
      out,
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0) return null;
  return fs.readFileSync(out);
}

function countFfmpegDecodeErrors(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hc-decode-"));
  const filePath = path.join(dir, "in.webm");
  fs.writeFileSync(filePath, buffer);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", filePath, "-f", "null", "-"], {
    encoding: "utf8",
  });
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  const err = String(r.stderr || "");
  const invalid = (err.match(/Invalid data found when processing input/g) || []).length;
  const vp9 = (err.match(/Invalid frame marker/g) || []).length;
  return invalid + vp9 + (r.status !== 0 ? 1 : 0);
}

const rubric = {
  keys: [
    ["api", "http", "rest", "endpoint", "запрос"],
    ["ошиб", "валидац", "400", "422", "статус", "код"],
    ["идемпот", "повтор", "ключ", "dedup"],
    ["кэш", "redis", "инвалида", "ttl"],
    ["jwt", "токен", "авторизац", "oauth", "рол"],
    ["очеред", "worker", "фон", "retry", "kafka", "rabbit"],
    ["миграц", "схем", "верси", "совместим"],
    ["метрик", "лог", "алерт", "монитор", "sentry", "prometheus"],
  ],
  minLength: 40,
};

function trapAttemptsFromTexts(texts) {
  return texts.map((text, i) => ({ id: `t${i}`, type: "quick", answer_text: text }));
}

describe("round41 findings (unit)", () => {
  it("P0-1: concat normalizes differing WebM track order (0 decode errors)", { skip: !ffmpegAvailable() }, () => {
    const s1 = makeWebmFixture(2, "va");
    const s2 = makeWebmFixture(2, "av");
    assert.ok(s1?.length && s2?.length, "fixtures");
    const merged = concatSessionWebmBuffers([s1, s2]);
    assert.ok(merged.length > 1000);
    const errors = countFfmpegDecodeErrors(merged);
    assert.equal(errors, 0, `decode errors ${errors}`);
  });

  it("P0-2: expireStaleOpenQuickAttempts closes overdue quick attempt", async () => {
    const tmpDb = path.join(os.tmpdir(), `hc-r41-${process.pid}-${Date.now()}.sqlite`);
    process.env.DB_PATH = tmpDb;
    process.env.DEMO_MODE = "1";
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/app/")) delete require.cache[key];
    }
    const { createApp: boot } = require("../app/server");
    const app = boot();
    const { getDb } = require("../app/db");
    const agent = request.agent(app);
    const email = `r41-expire-${Date.now()}@demo.local`;
    await agent.post("/api/auth/register").send(registerPayload({ email, role: "candidate" }));
    await agent.post("/api/auth/confirm").send({ email, code: "000000" });
    await agent.post("/api/auth/login").send({ email, password: "demo-demo-demo" });
    await agent.post("/api/assessment/battery/start").send({
      specialization: "backend",
      grade: "middle",
      privacyConsent: true,
    });
    let cur = await agent.get("/api/assessment/battery/current");
    assert.ok(cur.body.battery, "battery missing");
    let attemptId = cur.body.battery.attempts.find((a) => !a.submitted)?.id;
    assert.ok(attemptId, "open attempt missing");
    const opened = await agent.post(`/api/assessment/tasks/${attemptId}/open`).send({});
    assert.equal(opened.status, 200);
    cur = await agent.get("/api/assessment/battery/current");
    attemptId = cur.body.battery.attempts.find((a) => !a.submitted)?.id || attemptId;
    const db = getDb();
    const past = new Date(Date.now() - 120_000).toISOString();
    db.prepare("UPDATE attempts SET opened_at = ?, started_at = ? WHERE id = ?").run(past, past, attemptId);
    const batteryId = db.prepare("SELECT battery_id FROM attempts WHERE id = ?").get(attemptId).battery_id;
    const userId = db.prepare("SELECT candidate_user_id FROM attempts WHERE id = ?").get(attemptId)
      .candidate_user_id;
    const closed = expireStaleOpenQuickAttempts(db, userId, batteryId);
    assert.ok(closed >= 1);
    const row = db.prepare("SELECT submitted_at, timed_out FROM attempts WHERE id = ?").get(attemptId);
    assert.ok(row.submitted_at);
    assert.equal(row.timed_out, 1);
    try {
      fs.unlinkSync(tmpDb);
    } catch {
      /* ignore */
    }
  });

  it("P1-1: keyword-list trap variants fail; honest answers pass", () => {
    const variants = [
      traps.trapAnswersVariantPunkt(),
      traps.trapAnswersVariantComma(),
      traps.trapAnswersVariantYaIspolzuyu(),
      traps.trapAnswersVariantBare(),
    ];
    for (const texts of variants) {
      const attempts = trapAttemptsFromTexts(texts);
      for (const a of attempts) {
        assert.equal(looksLikeKeywordListAnswer(a.answer_text, rubric), true, a.answer_text.slice(0, 40));
      }
      const rubricsByAttemptId = new Map(attempts.map((a) => [a.id, rubric]));
      const mult = keywordTrapMultiplier(attempts, rubricsByAttemptId);
      assert.ok(mult < 0.5, `trap mult ${mult}`);
      const trapQuick = attempts.map((a) => scoreQuick(a.answer_text, rubric));
      const work = scoreWork(honest.workAnswer, rubric);
      let trapAgg = aggregateBattery(trapQuick, work);
      trapAgg = applyBatteryScoreGuards(trapAgg, attempts, { rubricsByAttemptId });
      const honestAttempts = [];
      for (let i = 0; i < 8; i += 1) {
        honestAttempts.push({ id: `h${i}`, type: "quick", answer_text: honest.quickAnswerForIndex(i) });
      }
      const honestRubrics = new Map(honestAttempts.map((a) => [a.id, rubric]));
      const honestMult = keywordTrapMultiplier(honestAttempts, honestRubrics);
      assert.equal(honestMult, 1);
      const honestQuick = honestAttempts.map((a) => scoreQuick(a.answer_text, rubric));
      let honestAgg = aggregateBattery(honestQuick, work);
      honestAgg = applyBatteryScoreGuards(honestAgg, honestAttempts, { rubricsByAttemptId: honestRubrics });
      assert.ok(trapAgg.test_score < honestAgg.test_score);
    }
  });

  it("P2-5: form B prompts differ from form A", () => {
    assert.notDeepEqual(QUICK_PROMPTS, QUICK_PROMPTS_FORM_B);
    assert.ok(QUICK_PROMPTS_FORM_B.length === QUICK_PROMPTS.length);
  });

  it("P2-6: health exposes git commit", async () => {
    const app = createApp();
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.ok(res.body.commit);
    assert.equal(res.body.commit, config.GIT_COMMIT);
  });

  it("P2-4: tasks UI does not count restored draft as typed input", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/public/candidate/tasks.html"), "utf8");
    assert.match(src, /let typedChars = restored\.length/);
  });

  it("P2-2: signaling notifies peer_left on disconnect", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/modules/calls/signaling.js"), "utf8");
    assert.match(src, /peer_left/);
    const client = fs.readFileSync(path.join(__dirname, "../app/public/call-room-webrtc.js"), "utf8");
    assert.match(client, /PEER_LEFT|peer_left/);
  });
});
