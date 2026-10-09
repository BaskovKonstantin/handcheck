"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const {
  concatSessionWebmBuffers,
  ffmpegAvailable,
  readDurationSecondsFromBuffer,
  maxPacketGapSeconds,
  decodeWebmClean,
  ffprobeDurationSeconds,
  remuxWebmFile,
} = require("../app/lib/webm-ffmpeg");
const { formatMinutesAboutRu, durationPhrase } = require("../app/lib/call-analysis-summary");

const FIXTURE_DIR = path.join(__dirname, "fixtures/recording-sessions-call-R");

function sessionDurationSum(prefix, count) {
  let sum = 0;
  for (let i = 1; i <= count; i += 1) {
    const filePath = path.join(FIXTURE_DIR, `${prefix}_S${i}.webm`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hc-dur-"));
    const remux = path.join(tmp, "r.webm");
    remuxWebmFile(filePath, remux);
    const d = ffprobeDurationSeconds(remux);
    fs.rmSync(tmp, { recursive: true, force: true });
    assert.ok(d && d > 0, `duration for ${prefix}_S${i}`);
    sum += d;
  }
  return sum;
}

function writeBufferProbe(buffer, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hc-r45-${label}-`));
  const filePath = path.join(dir, "merged.webm");
  fs.writeFileSync(filePath, buffer);
  return { dir, filePath };
}

describe("round45 findings (unit)", () => {
  it("formatMinutesAboutRu uses genitive after «Около»", () => {
    assert.equal(formatMinutesAboutRu(1), "минуты");
    assert.equal(formatMinutesAboutRu(2), "2 минут");
    assert.equal(formatMinutesAboutRu(3), "3 минут");
    assert.equal(formatMinutesAboutRu(5), "5 минут");
    assert.equal(formatMinutesAboutRu(11), "11 минут");
    assert.equal(formatMinutesAboutRu(21), "21 минуты");
    assert.equal(formatMinutesAboutRu(22), "22 минут");
    assert.match(durationPhrase(120), /Около 2 минут разговора/);
  });

  it("deploy workflow runs disk guard before build and after health", () => {
    const wf = fs.readFileSync(path.join(__dirname, "../.github/workflows/deploy.yml"), "utf8");
    assert.match(wf, /handcheck-deploy-disk\.sh precheck/);
    assert.match(wf, /handcheck-deploy-disk\.sh tag-rollback/);
    assert.match(wf, /handcheck-deploy-disk\.sh post-prune/);
    const script = fs.readFileSync(path.join(__dirname, "../bin/handcheck-deploy-disk.sh"), "utf8");
    assert.match(script, /Недостаточно места на сервере/);
    assert.doesNotMatch(script, /prune --volumes/);
  });

  it("deploy disk precheck fails with fake low df", () => {
    const scriptPath = path.join(__dirname, "../bin/handcheck-deploy-disk.sh");
    const r = spawnSync("bash", [scriptPath, "precheck"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.join(__dirname, "../test/fixtures/fake-df-bin")}:${process.env.PATH}`,
        HANDCHECK_DEPLOY_MIN_GB: "3",
        FAKE_DF_KB: "1048576",
      },
    });
    assert.equal(r.status, 42);
    assert.match(r.stdout + r.stderr, /Недостаточно места на сервере/i);
  });

  it(
    "P0-1: multi-session merge duration matches sum and has no packet gaps",
    { skip: !ffmpegAvailable() },
    () => {
      assert.ok(fs.existsSync(FIXTURE_DIR), "recording fixtures missing");
      const employerBuffers = [1, 2, 3, 4, 5].map((i) =>
        fs.readFileSync(path.join(FIXTURE_DIR, `employer_S${i}.webm`))
      );
      const merged = concatSessionWebmBuffers(employerBuffers);
      const expected = sessionDurationSum("employer", 5);
      const { dir, filePath } = writeBufferProbe(merged, "emp");
      try {
        const dur = readDurationSecondsFromBuffer(merged);
        assert.ok(dur, "merged duration");
        assert.ok(Math.abs(dur - expected) <= 0.5, `dur ${dur} vs expected ${expected}`);
        const gap = maxPacketGapSeconds(filePath);
        assert.ok(gap <= 0.5, `max packet gap ${gap}s`);
        assert.ok(decodeWebmClean(filePath), "ffmpeg decode");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }

      const candBuffers = [1, 2, 3].map((i) =>
        fs.readFileSync(path.join(FIXTURE_DIR, `candidate_S${i}.webm`))
      );
      const candMerged = concatSessionWebmBuffers(candBuffers);
      const expectedCand = sessionDurationSum("candidate", 3);
      const candProbe = writeBufferProbe(candMerged, "cand");
      try {
        const dur = readDurationSecondsFromBuffer(candMerged);
        assert.ok(Math.abs(dur - expectedCand) <= 0.5, `cand dur ${dur} vs ${expectedCand}`);
        assert.ok(maxPacketGapSeconds(candProbe.filePath) <= 0.5);
        assert.ok(decodeWebmClean(candProbe.filePath));
      } finally {
        fs.rmSync(candProbe.dir, { recursive: true, force: true });
      }
    }
  );

  it("employer calls recording pill keeps capitalization", () => {
    const html = fs.readFileSync(path.join(__dirname, "../app/public/employer/calls.html"), "utf8");
    assert.match(html, /status-pill-asis">Есть запись/);
  });

  it("bootCabinetPage defers load when cached role mismatches", () => {
    const app = fs.readFileSync(path.join(__dirname, "../app/public/app.js"), "utf8");
    assert.match(app, /getCachedMeRole\(\) === role/);
    assert.match(app, /refreshCabinetMeEmail\(role\)\.then\(\(ok\)/);
  });

  it("integrations shell renders skeleton before async load", () => {
    const html = fs.readFileSync(path.join(__dirname, "../app/public/candidate/integrations.html"), "utf8");
    assert.match(html, /id="main"[\s\S]*skeleton-card/);
    const js = fs.readFileSync(path.join(__dirname, "../app/public/integrations.js"), "utf8");
    assert.match(js, /skeletonBlocks\(3\)/);
  });

  it("tasks page uses compact progress strip CSS on mobile", () => {
    const css = fs.readFileSync(path.join(__dirname, "../app/public/styles.css"), "utf8");
    assert.match(css, /\.battery-progress-compact[\s\S]*display: block/);
    assert.match(css, /\.battery-steps\.battery-steps-full[\s\S]*display: none/);
    const tasks = fs.readFileSync(path.join(__dirname, "../app/public/candidate/tasks.html"), "utf8");
    assert.match(tasks, /battery-progress-compact/);
    assert.match(tasks, /telemetryOpen = false/);
  });
});
