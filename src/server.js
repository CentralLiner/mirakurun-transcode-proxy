import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { buildTsreplaceArgs, loadConfig } from "./config.js";

const { name: packageName, version: packageVersion } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const LOG_LEVEL_VALUE = { debug: 10, info: 20, warn: 30, error: 40 };

function classifyRoute(pathname) {
  let match = pathname.match(
    /^\/api\/channels\/[^/]+\/[^/]+\/services\/(\d+)\/stream\/?$/,
  );
  if (match) {
    return { type: "service", selector: match[1] };
  }

  if (/^\/api\/services\/\d+\/stream\/?$/.test(pathname)) {
    return { type: "service", selector: "1st" };
  }
  if (/^\/api\/programs\/\d+\/stream\/?$/.test(pathname)) {
    return { type: "program", selector: "1st" };
  }
  if (/^\/api\/channels\/[^/]+\/[^/]+\/stream\/?$/.test(pathname)) {
    return { type: "channel", selector: "1st" };
  }
  return null;
}

function stripHopByHopHeaders(headers) {
  const blocked = new Set(HOP_BY_HOP_HEADERS);
  const connection = headers.connection;
  const connectionValue = Array.isArray(connection) ? connection.join(",") : connection;
  if (connectionValue) {
    for (const token of connectionValue.split(",")) {
      blocked.add(token.trim().toLowerCase());
    }
  }

  return Object.fromEntries(
    Object.entries(headers).filter(([name, value]) => value !== undefined && !blocked.has(name.toLowerCase())),
  );
}

function transcodeResponseHeaders(upstreamHeaders) {
  const headers = stripHopByHopHeaders(upstreamHeaders);
  for (const name of [
    "content-length",
    "content-encoding",
    "etag",
    "last-modified",
    "accept-ranges",
  ]) {
    delete headers[name];
  }
  headers["content-type"] = "video/MP2T";
  headers["cache-control"] = "no-store";
  headers["x-accel-buffering"] = "no";
  headers["x-transcode-proxy"] = `${packageName}/${packageVersion}`;
  return headers;
}

function sendJson(response, statusCode, value, extraHeaders = {}) {
  if (response.headersSent || response.destroyed) {
    return;
  }
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(body);
}

function targetFor(config, requestUrl) {
  // Accept only HTTP origin-form targets. Absolute URLs, network-path URLs,
  // and backslashes must never select a host other than the configured server.
  if (typeof requestUrl !== "string" || !requestUrl.startsWith("/")
    || requestUrl.startsWith("//") || requestUrl.includes("\\")) {
    throw new TypeError("Only origin-form request URLs are supported");
  }
  const target = new URL(requestUrl, config.upstreamUrl);
  if (target.origin !== config.upstreamUrl.origin) {
    throw new TypeError("Request URL must use the configured upstream origin");
  }
  return target;
}

function transportFor(target) {
  return target.protocol === "https:" ? https : http;
}

function upstreamRequestOptions(request, target) {
  const headers = stripHopByHopHeaders(request.headers);
  headers.host = target.host;
  return { method: request.method, headers };
}

function terminateProcessGroup(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // The process may already have exited between the checks above.
  }
}

export function createProxyServer(config = loadConfig()) {
  let activeTranscodes = 0;
  let requestSequence = 0;
  const sessions = new Set();

  const log = (level, message, fields = {}) => {
    if (LOG_LEVEL_VALUE[level] < LOG_LEVEL_VALUE[config.logLevel]) {
      return;
    }
    const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
    (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
  };

  function makeUpstreamRequest(request, target, onResponse) {
    const upstream = transportFor(target).request(
      target,
      upstreamRequestOptions(request, target),
      onResponse,
    );
    upstream.setTimeout(config.upstreamConnectTimeoutMs, () => {
      upstream.destroy(new Error("upstream connection timed out"));
    });
    upstream.once("response", () => upstream.setTimeout(0));
    return upstream;
  }

  function proxyNormally(request, response, target) {
    const upstream = makeUpstreamRequest(request, target, (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        stripHopByHopHeaders(upstreamResponse.headers),
      );
      upstreamResponse.pipe(response);
    });

    upstream.on("error", (error) => {
      log("warn", "upstream proxy request failed", { error: error.message, url: request.url });
      sendJson(response, 502, { code: 502, reason: "Mirakurun upstream request failed" });
    });
    response.on("close", () => {
      if (!response.writableEnded) {
        upstream.destroy();
      }
    });
    request.pipe(upstream);
  }

  function transcode(request, response, route, target) {
    if (activeTranscodes >= config.maxTranscodes) {
      sendJson(
        response,
        503,
        { code: 503, reason: "No transcoder slot is currently available" },
        { "retry-after": "2" },
      );
      return;
    }

    activeTranscodes += 1;
    requestSequence += 1;
    const requestId = requestSequence;
    let released = false;
    let upstreamResponse;
    let child;
    let forceKillTimer;
    let cleanedUp = false;

    const release = () => {
      if (!released) {
        released = true;
        activeTranscodes -= 1;
      }
    };

    const session = {
      stop() {
        cleanup({ killChild: true });
      },
    };
    sessions.add(session);

    const cleanup = ({ killChild = false } = {}) => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (killChild && child && child.exitCode === null) {
        terminateProcessGroup(child);
        forceKillTimer = setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 1500);
        forceKillTimer.unref();
      }
      upstreamResponse?.destroy();
      upstream.destroy();
      sessions.delete(session);
      release();
    };

    const upstream = makeUpstreamRequest(request, target, (incoming) => {
      upstreamResponse = incoming;
      const statusCode = incoming.statusCode ?? 502;
      if (statusCode !== 200) {
        sessions.delete(session);
        release();
        response.writeHead(statusCode, stripHopByHopHeaders(incoming.headers));
        incoming.pipe(response);
        return;
      }

      const args = buildTsreplaceArgs(config, route.selector);
      child = spawn(config.tsreplaceBin, args, {
        detached: process.platform !== "win32",
        env: { ...process.env, LIBVA_DRIVER_NAME: process.env.LIBVA_DRIVER_NAME ?? "iHD" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderrBuffer = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderrBuffer = `${stderrBuffer}${chunk}`.slice(-8192);
        if (config.logLevel === "debug") {
          process.stderr.write(`[transcode:${requestId}] ${chunk}`);
        }
      });
      child.stdin.on("error", (error) => {
        if (error.code !== "EPIPE") {
          log("warn", "transcoder input failed", { requestId, error: error.message });
        }
      });

      child.once("spawn", () => {
        log("info", "transcode started", {
          requestId,
          path: request.url,
          selector: route.selector,
          activeTranscodes,
        });
        response.writeHead(200, transcodeResponseHeaders(incoming.headers));
        incoming.pipe(child.stdin);
        child.stdout.pipe(response);
      });

      child.once("error", (error) => {
        log("error", "could not start transcoder", { requestId, error: error.message });
        sendJson(response, 502, { code: 502, reason: "Could not start transcoder" });
        cleanup({ killChild: true });
      });

      child.once("close", (code, signal) => {
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        if (!response.writableEnded && !response.destroyed) {
          response.end();
        }
        const stderrTail = stderrBuffer.trim().slice(-2000);
        log(code === 0 || signal === "SIGTERM" ? "info" : "warn", "transcode stopped", {
          requestId,
          code,
          signal,
          stderrTail: stderrTail || undefined,
        });
        cleanup();
      });
    });

    upstream.once("error", (error) => {
      log("warn", "upstream stream request failed", { requestId, error: error.message });
      sendJson(response, 502, { code: 502, reason: "Mirakurun upstream stream failed" });
      cleanup({ killChild: true });
    });

    const clientClosed = () => {
      if (!response.writableEnded) {
        log("debug", "stream client disconnected", { requestId });
        cleanup({ killChild: true });
      }
    };
    request.once("aborted", clientClosed);
    response.once("close", clientClosed);
    request.pipe(upstream);
  }

  const server = http.createServer((request, response) => {
    let target;
    try {
      target = targetFor(config, request.url);
    } catch {
      sendJson(response, 400, { code: 400, reason: "Invalid request URL" });
      return;
    }

    if (request.url === "/healthz" || request.url === "/healthz/") {
      sendJson(response, 200, {
        status: "ok",
        activeTranscodes,
        maxTranscodes: config.maxTranscodes,
      });
      return;
    }

    const route = request.method === "GET" ? classifyRoute(target.pathname) : null;
    if (!route) {
      proxyNormally(request, response, target);
      return;
    }

    if (route.type === "channel") {
      if (config.channelStreamMode === "passthrough") {
        proxyNormally(request, response, target);
        return;
      }
      if (config.channelStreamMode === "reject") {
        sendJson(response, 409, {
          code: 409,
          reason: "Channel-wide streams are disabled; set BonDriver_Mirakurun SERVICE_SPLIT=1",
        });
        return;
      }
    }

    transcode(request, response, route, target);
  });

  server.requestTimeout = 0;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.proxyState = {
    get activeTranscodes() {
      return activeTranscodes;
    },
    stopSessions() {
      for (const session of [...sessions]) {
        session.stop();
        sessions.delete(session);
      }
    },
  };

  return server;
}

export async function start(config = loadConfig()) {
  const server = createProxyServer(config);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.listenPort, config.listenHost, resolve);
  });
  process.stdout.write(
    `${JSON.stringify({
      time: new Date().toISOString(),
      level: "info",
      message: "proxy listening",
      address: `${config.listenHost}:${config.listenPort}`,
      upstream: config.upstreamUrl.origin,
      maxTranscodes: config.maxTranscodes,
      channelStreamMode: config.channelStreamMode,
      transcodeProfile: config.transcodeProfile,
    })}\n`,
  );

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdout.write(
      `${JSON.stringify({ time: new Date().toISOString(), level: "info", message: "shutting down", signal })}\n`,
    );
    server.close(() => process.exit(0));
    server.proxyState.stopSessions();
    const timer = setTimeout(() => process.exit(1), config.gracefulShutdownMs);
    timer.unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ time: new Date().toISOString(), level: "error", message: error.message })}\n`,
    );
    process.exit(1);
  });
}

export { classifyRoute, stripHopByHopHeaders, targetFor };
