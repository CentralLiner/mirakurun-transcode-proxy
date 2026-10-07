const VALID_QUALITY_PRESETS = new Set([
  "best",
  "higher",
  "high",
  "balanced",
  "fast",
  "faster",
  "fastest",
]);

const VALID_LOG_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "quiet"]);

const TUNING_PROFILES = Object.freeze({
  stable: Object.freeze({
    rateControl: "qvbr",
    bitrateKbps: 5500,
    maxBitrateKbps: 8000,
    vbvBufferKbits: 3000,
    qvbrQuality: 23,
    gopLength: 30,
    quality: "balanced",
    deinterlace: "normal",
    decoder: "software",
    inputAnalyzeSeconds: 3.0,
    inputProbeSize: 5000000,
    removeTyped: false,
  }),
  "low-load": Object.freeze({
    rateControl: "qvbr",
    bitrateKbps: 5500,
    maxBitrateKbps: 8000,
    vbvBufferKbits: 3000,
    qvbrQuality: 23,
    gopLength: 60,
    quality: "balanced",
    deinterlace: "none",
    decoder: "hardware",
    inputAnalyzeSeconds: 0.5,
    inputProbeSize: 1000000,
    removeTyped: false,
  }),
  "low-bandwidth": Object.freeze({
    rateControl: "qvbr",
    bitrateKbps: 4000,
    maxBitrateKbps: 6000,
    vbvBufferKbits: 2500,
    qvbrQuality: 24,
    gopLength: 60,
    quality: "balanced",
    deinterlace: "none",
    decoder: "hardware",
    inputAnalyzeSeconds: 0.5,
    inputProbeSize: 1000000,
    removeTyped: true,
  }),
});

function valueOrDefault(env, name, defaultValue) {
  const value = env[name];
  return value === undefined || value === "" ? String(defaultValue) : value;
}

function readInteger(env, name, defaultValue, minimum, maximum) {
  const raw = valueOrDefault(env, name, defaultValue);
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer`);
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function readFloat(env, name, defaultValue, minimum, maximum) {
  const raw = valueOrDefault(env, name, defaultValue);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function readEnum(env, name, defaultValue, allowed) {
  const value = valueOrDefault(env, name, defaultValue).toLowerCase();
  if (!allowed.has(value)) {
    throw new Error(`${name} must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function readBoolean(env, name, defaultValue) {
  const value = valueOrDefault(env, name, defaultValue ? "true" : "false").toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  throw new Error(`${name} must be a boolean (1/0, true/false, yes/no, or on/off)`);
}

function readStringArray(env, name) {
  const raw = env[name] ?? "[]";
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be a JSON array: ${error.message}`);
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be a JSON array of strings`);
  }
  return value;
}

function readUpstreamUrl(env) {
  const value = new URL(env.MIRAKURUN_URL ?? "http://host.docker.internal:40772");
  if (value.protocol !== "http:" && value.protocol !== "https:") {
    throw new Error("MIRAKURUN_URL must use http or https");
  }
  if (value.pathname !== "/" || value.search || value.hash) {
    throw new Error("MIRAKURUN_URL must contain only scheme, host, and optional port");
  }
  return value;
}

function buildRateControlArgs(
  rateControl,
  bitrateKbps,
  maxBitrateKbps,
  vbvBufferKbits,
  qvbrQuality,
) {
  if (rateControl === "cbr") {
    return ["--cbr", String(bitrateKbps), "--vbv-bufsize", String(vbvBufferKbits)];
  }
  if (rateControl === "qvbr") {
    return [
      "--qvbr",
      String(bitrateKbps),
      "--qvbr-quality",
      String(qvbrQuality),
      "--max-bitrate",
      String(maxBitrateKbps),
      "--vbv-bufsize",
      String(vbvBufferKbits),
    ];
  }
  return [
    "--vbr",
    String(bitrateKbps),
    "--max-bitrate",
    String(maxBitrateKbps),
    "--vbv-bufsize",
    String(vbvBufferKbits),
  ];
}

export function loadConfig(env = process.env) {
  const tuningProfile = readEnum(
    env,
    "TRANSCODE_TUNING_PROFILE",
    "stable",
    new Set(Object.keys(TUNING_PROFILES)),
  );
  const profile = TUNING_PROFILES[tuningProfile];
  const bitrateKbps = readInteger(
    env,
    "TRANSCODE_BITRATE_KBPS",
    profile.bitrateKbps,
    500,
    50000,
  );
  const maxBitrateKbps = readInteger(
    env,
    "TRANSCODE_MAX_BITRATE_KBPS",
    profile.maxBitrateKbps,
    500,
    50000,
  );
  if (maxBitrateKbps < bitrateKbps) {
    throw new Error("TRANSCODE_MAX_BITRATE_KBPS must not be lower than TRANSCODE_BITRATE_KBPS");
  }

  const vbvBufferKbits = readInteger(
    env,
    "TRANSCODE_VBV_BUFFER_KBITS",
    profile.vbvBufferKbits,
    100,
    50000,
  );
  const rateControl = readEnum(
    env,
    "TRANSCODE_RATE_CONTROL",
    profile.rateControl,
    new Set(["qvbr", "vbr", "cbr"]),
  );
  const qvbrQuality = readInteger(
    env,
    "TRANSCODE_QVBR_QUALITY",
    profile.qvbrQuality,
    0,
    51,
  );
  const quality = readEnum(env, "TRANSCODE_QUALITY", profile.quality, VALID_QUALITY_PRESETS);
  const deinterlace = readEnum(
    env,
    "TRANSCODE_DEINTERLACE",
    profile.deinterlace,
    new Set(["normal", "bob", "none"]),
  );
  const qsvLogLevel = readEnum(env, "QSVENC_LOG_LEVEL", "warn", VALID_LOG_LEVELS);
  const tsreplaceLogLevel = readEnum(env, "TSREPLACE_LOG_LEVEL", "warn", VALID_LOG_LEVELS);
  const tsreplaceSourceAnalyzeSeconds = readFloat(
    env,
    "TSREPLACE_SOURCE_ANALYZE_SECONDS",
    1.5,
    0.5,
    7.0,
  );
  const decoder = readEnum(
    env,
    "QSVENC_DECODER",
    profile.decoder,
    new Set(["software", "hardware"]),
  );
  const extraQsvencArgs = readStringArray(env, "EXTRA_QSVENC_ARGS_JSON");
  const inputAnalyzeSeconds = readFloat(
    env,
    "QSVENC_INPUT_ANALYZE_SECONDS",
    profile.inputAnalyzeSeconds,
    0,
    60,
  );
  const inputProbeSize = readInteger(
    env,
    "QSVENC_INPUT_PROBESIZE",
    profile.inputProbeSize,
    32768,
    100000000,
  );
  const cropBottom = readInteger(env, "TRANSCODE_CROP_BOTTOM", 0, 0, 64);
  if (cropBottom % 2 !== 0) {
    throw new Error("TRANSCODE_CROP_BOTTOM must be an even number");
  }

  const qsvencArgs = [
    decoder === "hardware" ? "--avhw" : "--avsw",
    "--va",
    "-i",
    "-",
    "--input-format",
    "mpegts",
    "--input-analyze",
    String(inputAnalyzeSeconds),
    "--input-probesize",
    String(inputProbeSize),
    "--tff",
  ];

  if (cropBottom > 0) {
    qsvencArgs.push(
      "--crop",
      `0,0,0,${cropBottom}`,
      "--vpp-pad",
      `0,0,0,${cropBottom}`,
    );
  }

  if (deinterlace !== "none") {
    // Japanese ISDB broadcasts are TFF.  Make the field order explicit so a
    // decoder/VPP auto-detection wobble cannot swap temporal field order.
    qsvencArgs.push(
      "--vpp-deinterlace",
      deinterlace === "bob" ? "bob_tff" : "normal_tff",
    );
  } else {
    // Preserve the original 60i field structure.  Picture-timing SEI makes
    // the field cadence explicit to DirectShow decoders used by TVTest.
    qsvencArgs.push("--pic-struct");
  }

  const gopLength = readInteger(
    env,
    "TRANSCODE_GOP_LENGTH",
    profile.gopLength,
    1,
    600,
  );
  const removeTyped = readBoolean(
    env,
    "TSREPLACE_REMOVE_TYPED",
    profile.removeTyped,
  );

  qsvencArgs.push(
    "-c",
    "h264",
    ...buildRateControlArgs(
      rateControl,
      bitrateKbps,
      maxBitrateKbps,
      vbvBufferKbits,
      qvbrQuality,
    ),
    "--quality",
    quality,
    "--mbbrc",
    "--profile",
    "high",
    "--level",
    "4.1",
    "--gop-len",
    String(gopLength),
    "--strict-gop",
    "--bframes",
    "0",
    "--ref",
    "1",
    "--scenario-info",
    "live_streaming",
    "--async-depth",
    "1",
    "--input-buf",
    "1",
    "--output-buf",
    "0",
    "--output-thread",
    "0",
    "--lowlatency",
    "--log-level",
    qsvLogLevel,
    ...extraQsvencArgs,
    "--output-format",
    "mpegts",
    "-o",
    "-",
  );

  return {
    listenHost: env.LISTEN_HOST ?? "0.0.0.0",
    listenPort: readInteger(env, "PORT", 40773, 1, 65535),
    upstreamUrl: readUpstreamUrl(env),
    upstreamConnectTimeoutMs: readInteger(env, "UPSTREAM_CONNECT_TIMEOUT_MS", 10000, 100, 120000),
    maxTranscodes: readInteger(env, "MAX_TRANSCODES", 2, 1, 16),
    channelStreamMode: readEnum(
      env,
      "CHANNEL_STREAM_MODE",
      "reject",
      new Set(["reject", "first", "passthrough"]),
    ),
    tsreplaceBin: env.TSREPLACE_BIN ?? "/usr/local/bin/tsreplace",
    qsvencBin: env.QSVENC_BIN ?? "/usr/bin/qsvencc",
    tsreplaceLogLevel,
    removeTyped,
    qsvencArgs,
    transcodeProfile: {
      tuningProfile,
      decoder,
      deinterlace,
      inputAnalyzeSeconds,
      inputProbeSize,
      tsreplaceSourceAnalyzeSeconds,
      rateControl,
      bitrateKbps,
      maxBitrateKbps,
      qvbrQuality,
      gopLength,
      removeTyped,
    },
    logLevel: readEnum(env, "PROXY_LOG_LEVEL", "info", new Set(["debug", "info", "warn", "error"])),
    gracefulShutdownMs: readInteger(env, "GRACEFUL_SHUTDOWN_MS", 5000, 100, 60000),
  };
}

export function buildTsreplaceArgs(config, serviceSelector) {
  return [
    "-i",
    "-",
    "-o",
    "-",
    "--service",
    serviceSelector,
    "--end-at-replace-eof",
    "0",
    "--replace-format",
    "mpegts",
    ...(config.removeTyped ? ["--remove-typed"] : []),
    "--log-level",
    config.tsreplaceLogLevel,
    "-e",
    config.qsvencBin,
    ...config.qsvencArgs,
  ];
}
