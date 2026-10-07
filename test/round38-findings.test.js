"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const {
  finalizeMergedWebm,
  mergeBuffers,
  groupChunkBuffersIntoSessions,
} = require("../app/lib/recording-store");
const { createRecordingChunkQueue } = require("../app/lib/recording-chunk-queue");
const { ffmpegAvailable, readDurationSecondsFromBuffer } = require("../app/lib/webm-ffmpeg");
const { formatMinutesAboutRu, durationPhrase } = require("../app/lib/call-analysis-summary");
const {
  looksLikeKeywordListAnswer,
  applyBatteryScoreGuards,
  aggregateBattery,
  scoreQuick,
  scoreWork,
} = require("../app/lib/rubric-score");
const { privacyNoticeShort } = require("../app/lib/privacy-policy");
const honest = require("../scripts/fixtures/distinct-quick-answers");
const { MIN_PLAYABLE_RECORDING_BYTES } = require("../app/lib/call-recording");

function fakeEbml(size = MIN_PLAYABLE_RECORDING_BYTES + 200) {
  const buf = Buffer.alloc(size, 0xab);
  buf[0] = 0x1a;
  buf[1] = 0x45;
  buf[2] = 0xdf;
  buf[3] = 0xa3;
  return buf;
}

function makeWebmFixture(seconds = 2) {
  const out = path.join(os.tmpdir(), `hc-fixture-${process.pid}-${Date.now()}.webm`);
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
      out,
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0) return null;
  return fs.readFileSync(out);
}

describe("round38 findings (unit)", () => {
  it("privacy notice has no bracket placeholders when env unset", () => {
    delete process.env.PRIVACY_OPERATOR_NAME;
    delete process.env.PRIVACY_OPERATOR_INN;
    delete process.env.PRIVACY_OPERATOR_EMAIL;
    const text = privacyNoticeShort();
    assert.ok(!text.includes("[УКАЖИТЕ"));
    assert.match(text, /HandCheck|оператор платформы/i);
  });

  it("minutes plural helper uses genitive after «Около»", () => {
    assert.equal(formatMinutesAboutRu(1), "минуты");
    assert.match(durationPhrase(60), /минуты разговора/);
    assert.match(durationPhrase(120), /2 минут разговора/);
  });

  it("keyword-list trap fails while honest distinct answers pass guard", () => {
    const rubric = {
      keys: [
        "api",
        "http",
        "rest",
        "endpoint",
        "ошибки",
        "валидация",
        "400",
        "422",
        "postgres",
        "sql",
        "jwt",
        "очередь",
        "кэш",
        "redis",
        "миграции",
        "метрики",
        "логи",
        "идемпотентность",
      ],
      minLength: 40,
    };
    const keywordBlob =
      "api http rest endpoint запрос ошибки валидация 400 422 postgres sql jwt очередь кэш redis миграции метрики логи идемпотентность пагинация версия токен роли";
    const trapAttempts = [];
    for (let i = 0; i < 8; i += 1) {
      const text = `Пункт ${i + 1}. ${keywordBlob}`;
      trapAttempts.push({ id: `t${i}`, type: "quick", answer_text: text });
      assert.equal(looksLikeKeywordListAnswer(text, rubric), true, `q${i}`);
    }
    const rubricsByAttemptId = new Map(trapAttempts.map((a) => [a.id, rubric]));
    const trapMult = require("../app/lib/rubric-score").keywordTrapMultiplier(trapAttempts, rubricsByAttemptId);
    assert.ok(trapMult < 0.5, `trap mult ${trapMult}`);

    const honestAttempts = [];
    for (let i = 0; i < 8; i += 1) {
      honestAttempts.push({
        id: `h${i}`,
        type: "quick",
        answer_text: honest.quickAnswerForIndex(i),
      });
    }
    const honestRubrics = new Map(honestAttempts.map((a) => [a.id, rubric]));
    const honestMult = require("../app/lib/rubric-score").keywordTrapMultiplier(
      honestAttempts,
      honestRubrics
    );
    assert.equal(honestMult, 1, `honest mult ${honestMult}`);

    const trapQuick = trapAttempts.map((a) => scoreQuick(a.answer_text, rubric));
    const trapWork = scoreWork(honest.workAnswer, rubric);
    let trapAgg = aggregateBattery(trapQuick, trapWork);
    trapAgg = applyBatteryScoreGuards(trapAgg, trapAttempts, { rubricsByAttemptId });
    const honestQuick = honestAttempts.map((a) => scoreQuick(a.answer_text, rubric));
    let honestAgg = aggregateBattery(honestQuick, trapWork);
    honestAgg = applyBatteryScoreGuards(honestAgg, honestAttempts, { rubricsByAttemptId: honestRubrics });
    assert.ok(trapAgg.test_score < honestAgg.test_score, "trap should score lower than honest");
  });

  it("recording chunk queue keeps blobs emitted during upload", async () => {
    const uploaded = [];
    const queue = createRecordingChunkQueue({
      uploadBlob: async (parts) => {
        await new Promise((r) => setTimeout(r, 30));
        uploaded.push(parts.length);
      },
    });
    queue.push({ size: 1, type: "video/webm" });
    queue.push({ size: 2, type: "video/webm" });
    const flushPromise = queue.flush();
    queue.push({ size: 9, type: "video/webm" });
    await flushPromise;
    await queue.flush();
    await queue.waitForIdle();
    assert.equal(uploaded.reduce((sum, n) => sum + n, 0), 3, `upload batches: ${uploaded.join(",")}`);
  });

  it("concurrent flush calls upload each blob once", async () => {
    const uploadedSizes = [];
    const queue = createRecordingChunkQueue({
      uploadBlob: async (parts) => {
        uploadedSizes.push(parts.length);
        await new Promise((r) => setTimeout(r, 10));
      },
    });
    for (let i = 0; i < 5; i += 1) queue.push({ size: i + 1, type: "video/webm" });
    await Promise.all([queue.flush(), queue.flush()]);
    await queue.waitForIdle();
    assert.equal(uploadedSizes.reduce((s, n) => s + n, 0), 5);
  });

  it("groups reload sessions on EBML boundaries", () => {
    const a = fakeEbml(5000);
    const b = fakeEbml(5000);
    const sessions = groupChunkBuffersIntoSessions([a, b]);
    assert.equal(sessions.length, 2);
  });

  it("mergeChunksToFinal yields finite duration for ffmpeg WebM fixture", { skip: !ffmpegAvailable() }, () => {
    const part = makeWebmFixture(2);
    assert.ok(part && part.length > 1000, "fixture");
    const merged = finalizeMergedWebm([part], 2000);
    assert.ok(merged && merged.length >= MIN_PLAYABLE_RECORDING_BYTES);
    const dur = readDurationSecondsFromBuffer(merged);
    assert.ok(dur && dur > 0.5 && dur < 4, `duration ${dur}`);
  });

  it("client flush does not wipe recorderChunks array wholesale", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/public/call-room-webrtc.js"), "utf8");
    assert.match(src, /createRecordingChunkQueue/);
    assert.doesNotMatch(src, /recorderChunks\s*=\s*\[\]/);
  });

  it("recording-store does not import browser fix-webm-duration", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/lib/recording-store.js"), "utf8");
    assert.doesNotMatch(src, /fix-webm-duration/);
    assert.match(src, /webm-ffmpeg/);
  });
});
