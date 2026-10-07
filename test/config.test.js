import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTsreplaceArgs, loadConfig } from "../src/config.js";

function valueAfter(args, option) {
  const index = args.indexOf(option);
  assert.notEqual(index, -1, `${option} was not found`);
  return args[index + 1];
}

test("quality-stable low-latency defaults are generated", () => {
  const config = loadConfig({});
  const args = config.qsvencArgs;

  assert.ok(args.includes("--avsw"));
  assert.ok(!args.includes("--avhw"));
  assert.equal(valueAfter(args, "--qvbr"), "5500");
  assert.equal(valueAfter(args, "--qvbr-quality"), "23");
  assert.equal(valueAfter(args, "--max-bitrate"), "8000");
  assert.equal(valueAfter(args, "--vbv-bufsize"), "3000");
  assert.equal(valueAfter(args, "--input-analyze"), "3");
  assert.equal(valueAfter(args, "--input-probesize"), "5000000");
  assert.equal(config.transcodeProfile.tsreplaceSourceAnalyzeSeconds, 1.5);
  assert.equal(valueAfter(args, "--vpp-deinterlace"), "normal_tff");
  assert.equal(valueAfter(args, "--output-buf"), "0");
  assert.ok(args.includes("--mbbrc"));
});

test("bob mode uses an explicit TFF field order", () => {
  const args = loadConfig({ TRANSCODE_DEINTERLACE: "bob" }).qsvencArgs;

  assert.equal(valueAfter(args, "--vpp-deinterlace"), "bob_tff");
});

test("interlaced H.264 remains opt-in but bypasses deinterlacing", () => {
  const args = loadConfig({ TRANSCODE_DEINTERLACE: "none" }).qsvencArgs;

  assert.ok(!args.includes("--vpp-deinterlace"));
  assert.ok(args.includes("--pic-struct"));
});

test("hardware MPEG-2 decode can override the stable profile", () => {
  const args = loadConfig({ QSVENC_DECODER: "hardware" }).qsvencArgs;

  assert.ok(args.includes("--avhw"));
  assert.ok(!args.includes("--avsw"));
  assert.equal(valueAfter(args, "--input-analyze"), "3");
  assert.equal(valueAfter(args, "--input-probesize"), "5000000");
});

test("bottom-strip workaround crops and restores the output height", () => {
  const args = loadConfig({ TRANSCODE_CROP_BOTTOM: "8" }).qsvencArgs;

  assert.equal(valueAfter(args, "--crop"), "0,0,0,8");
  assert.equal(valueAfter(args, "--vpp-pad"), "0,0,0,8");
});

test("bottom crop must preserve chroma alignment", () => {
  assert.throws(
    () => loadConfig({ TRANSCODE_CROP_BOTTOM: "7" }),
    /must be an even number/,
  );
});

test("low-load profile uses full QSV and preserves interlacing", () => {
  const config = loadConfig({ TRANSCODE_TUNING_PROFILE: "low-load" });
  const args = config.qsvencArgs;

  assert.ok(args.includes("--avhw"));
  assert.ok(!args.includes("--vpp-deinterlace"));
  assert.ok(args.includes("--pic-struct"));
  assert.equal(valueAfter(args, "--input-analyze"), "0.5");
  assert.equal(valueAfter(args, "--input-probesize"), "1000000");
  assert.equal(valueAfter(args, "--gop-len"), "60");
  assert.equal(valueAfter(args, "--qvbr"), "5500");
  assert.equal(config.removeTyped, false);
  assert.equal(valueAfter(buildTsreplaceArgs(config, "1024"), "--replace-format"), "mpegts");
});

test("low-bandwidth profile reduces video rate and removes Type-D data", () => {
  const config = loadConfig({ TRANSCODE_TUNING_PROFILE: "low-bandwidth" });
  const qsvArgs = config.qsvencArgs;
  const replaceArgs = buildTsreplaceArgs(config, "1024");

  assert.equal(valueAfter(qsvArgs, "--qvbr"), "4000");
  assert.equal(valueAfter(qsvArgs, "--max-bitrate"), "6000");
  assert.equal(valueAfter(qsvArgs, "--qvbr-quality"), "24");
  assert.ok(replaceArgs.includes("--remove-typed"));
});

test("explicit settings override profile defaults", () => {
  const config = loadConfig({
    TRANSCODE_TUNING_PROFILE: "low-bandwidth",
    TRANSCODE_BITRATE_KBPS: "4500",
    TSREPLACE_REMOVE_TYPED: "off",
  });

  assert.equal(valueAfter(config.qsvencArgs, "--qvbr"), "4500");
  assert.ok(!buildTsreplaceArgs(config, "1024").includes("--remove-typed"));
});

test("empty compose values fall back to the selected profile", () => {
  const config = loadConfig({
    TRANSCODE_TUNING_PROFILE: "low-load",
    QSVENC_DECODER: "",
    TRANSCODE_DEINTERLACE: "",
    TRANSCODE_BITRATE_KBPS: "",
  });

  assert.ok(config.qsvencArgs.includes("--avhw"));
  assert.equal(valueAfter(config.qsvencArgs, "--qvbr"), "5500");
});

test("invalid Type-D switch is rejected", () => {
  assert.throws(
    () => loadConfig({ TSREPLACE_REMOVE_TYPED: "maybe" }),
    /must be a boolean/,
  );
});

test("source analysis duration is configurable but bounded", () => {
  const config = loadConfig({ TSREPLACE_SOURCE_ANALYZE_SECONDS: "2.5" });
  assert.equal(config.transcodeProfile.tsreplaceSourceAnalyzeSeconds, 2.5);
  assert.throws(
    () => loadConfig({ TSREPLACE_SOURCE_ANALYZE_SECONDS: "0.3" }),
    /must be between 0.5 and 7/,
  );
});
