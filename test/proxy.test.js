import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { createProxyServer } from "../src/server.js";

const fakeTsreplace = fileURLToPath(new URL("./fixtures/fake-tsreplace.sh", import.meta.url));
const trackedTsreplace = fileURLToPath(new URL("./fixtures/tracked-tsreplace.sh", import.meta.url));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

function get(port, path, options = {}, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, ...options }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

const upstream = http.createServer(async (request, response) => {
  if (request.url === "/api/echo") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.end(JSON.stringify({
      method: request.method,
      body: Buffer.concat(chunks).toString(),
      priority: request.headers["x-mirakurun-priority"],
      privateHeader: request.headers["x-private"] ?? null,
    }));
    return;
  }
  if (request.url === "/api/unavailable") {
    request.socket.destroy();
    return;
  }
  if (request.url?.endsWith("?unavailable")) {
    response.writeHead(503);
    response.end("Upstream busy");
    return;
  }
  if (request.url === "/api/version?x=1") {
    response.writeHead(200, { "content-type": "application/json", "x-upstream": "yes" });
    response.end(JSON.stringify({ current: "test" }));
    return;
  }
  if (request.url?.includes("/stream")) {
    response.writeHead(200, {
      "content-type": "video/MP2T",
      "content-length": "7",
      "x-mirakurun-tuner-user-id": "test-user",
    });
    response.end(Buffer.from("TS-DATA"));
    return;
  }
  response.writeHead(404);
  response.end();
});
let upstreamPort;
before(async () => { upstreamPort = await listen(upstream); });
after(async () => { await close(upstream); });

function makeConfig(overrides = {}) {
  const config = loadConfig({
    MIRAKURUN_URL: `http://127.0.0.1:${upstreamPort}`,
    TSREPLACE_BIN: fakeTsreplace,
    QSVENC_BIN: "/unused/QSVEncC",
    PROXY_LOG_LEVEL: "error",
  });
  return { ...config, ...overrides };
}

test("ordinary Mirakurun APIs are transparently proxied", async () => {
  const proxy = createProxyServer(makeConfig());
  const port = await listen(proxy);
  try {
    const result = await get(port, "/api/version?x=1");
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["x-upstream"], "yes");
    assert.deepEqual(JSON.parse(result.body), { current: "test" });
  } finally {
    await close(proxy);
  }
});

test("service stream is sent through the transcoder process", async () => {
  const proxy = createProxyServer(makeConfig());
  const port = await listen(proxy);
  try {
    const result = await get(port, "/api/channels/GR/27/services/1024/stream?decode=1");
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["content-type"], "video/MP2T");
    assert.equal(result.headers["content-length"], undefined);
    assert.equal(result.headers["x-mirakurun-tuner-user-id"], "test-user");
    assert.equal(result.headers["x-transcode-proxy"], `${packageJson.name}/${packageJson.version}`);
    assert.equal(result.body.toString(), "TS-DATA");
  } finally {
    await close(proxy);
  }
});

test("channel-wide stream is rejected unless explicitly enabled", async () => {
  const proxy = createProxyServer(makeConfig());
  const port = await listen(proxy);
  try {
    const result = await get(port, "/api/channels/BS/BS15_0/stream");
    assert.equal(result.statusCode, 409);
    assert.match(JSON.parse(result.body).reason, /SERVICE_SPLIT=1/);
  } finally {
    await close(proxy);
  }
});

test("health endpoint reports capacity", async () => {
  const proxy = createProxyServer(makeConfig({ maxTranscodes: 3 }));
  const port = await listen(proxy);
  try {
    const result = await get(port, "/healthz");
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), {
      status: "ok",
      activeTranscodes: 0,
      maxTranscodes: 3,
    });
  } finally {
    await close(proxy);
  }
});

test("API methods, request bodies, and Mirakurun headers are forwarded", async () => {
  const proxy = createProxyServer(makeConfig());
  const port = await listen(proxy);
  try {
    const result = await get(port, "/api/echo", {
      method: "POST",
      headers: { "x-mirakurun-priority": "1", connection: "X-Private", "x-private": "remove" },
    }, "request-body");
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), {
      method: "POST", body: "request-body", priority: "1", privateHeader: null,
    });
  } finally {
    await close(proxy);
  }
});

test("foreign request targets are rejected without forwarding", async () => {
  const proxy = createProxyServer(makeConfig());
  const port = await listen(proxy);
  try {
    for (const target of ["http://other.invalid/api/version", "//other.invalid/api/version"]) {
      const result = await get(port, target);
      assert.equal(result.statusCode, 400);
      assert.equal(JSON.parse(result.body).reason, "Invalid request URL");
    }
  } finally {
    await close(proxy);
  }
});

test("upstream failures return 502", async () => {
  const proxy = createProxyServer(makeConfig());
  const port = await listen(proxy);
  try {
    assert.equal((await get(port, "/api/unavailable")).statusCode, 502);
  } finally {
    await close(proxy);
  }
});

test("a rejected upstream stream releases its transcoder slot", async () => {
  const proxy = createProxyServer(makeConfig());
  const port = await listen(proxy);
  try {
    const result = await get(port, "/api/services/1024/stream?unavailable");
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.toString(), "Upstream busy");
    assert.equal(proxy.proxyState.activeTranscodes, 0);
  } finally {
    await close(proxy);
  }
});

test("a missing transcoder returns 502 and releases its slot", async () => {
  const proxy = createProxyServer(makeConfig({ tsreplaceBin: "/unused/missing-tsreplace" }));
  const port = await listen(proxy);
  try {
    const result = await get(port, "/api/services/1024/stream");
    assert.equal(result.statusCode, 502);
    assert.equal(proxy.proxyState.activeTranscodes, 0);
  } finally {
    await close(proxy);
  }
});

function openStream(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/api/services/1024/stream" }, (response) => {
      response.on("error", () => {});
      response.once("data", () => resolve({ request, response }));
    });
    request.on("error", reject);
  });
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for cleanup");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function liveProxy(t, overrides = {}) {
  const liveUpstream = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "video/MP2T" });
    response.write("TS-DATA");
  });
  const port = await listen(liveUpstream);
  const proxy = createProxyServer(makeConfig({
    upstreamUrl: new URL(`http://127.0.0.1:${port}`), ...overrides,
  }));
  t.after(async () => {
    proxy.proxyState.stopSessions();
    await close(proxy);
    await close(liveUpstream);
  });
  return { proxy, port: await listen(proxy) };
}

test("capacity limits return 503 and disconnecting releases capacity", { timeout: 6000 }, async (t) => {
  const { proxy, port } = await liveProxy(t, { maxTranscodes: 1 });
  const stream = await openStream(port);
  assert.equal(stream.response.statusCode, 200);
  assert.equal(proxy.proxyState.activeTranscodes, 1);
  const rejected = await get(port, "/api/services/1024/stream");
  assert.equal(rejected.statusCode, 503);
  assert.equal(rejected.headers["retry-after"], "2");
  stream.request.destroy();
  await waitUntil(() => proxy.proxyState.activeTranscodes === 0);
});

async function trackedProxy(t, markerName) {
  const directory = await mkdtemp(path.join(tmpdir(), "mirakurun-proxy-test-"));
  const marker = path.join(directory, markerName);
  let pid;
  t.after(async () => {
    if (pid && processExists(pid)) process.kill(-pid, "SIGKILL");
    await rm(directory, { recursive: true, force: true });
  });
  const result = await liveProxy(t, { tsreplaceBin: trackedTsreplace, qsvencBin: marker });
  const stream = await openStream(result.port);
  pid = JSON.parse(await readFile(marker, "utf8")).pid;
  return { ...result, stream, pid };
}

test("disconnecting terminates the transcoder process", { timeout: 6000 }, async (t) => {
  const { proxy, stream, pid } = await trackedProxy(t, "process.json");
  assert.ok(processExists(pid));
  stream.request.destroy();
  await waitUntil(() => !processExists(pid));
  assert.equal(proxy.proxyState.activeTranscodes, 0);
});

test("stopping sessions force-kills a transcoder that ignores SIGTERM", { timeout: 6000 }, async (t) => {
  const { proxy, pid } = await trackedProxy(t, "ignore-term.json");
  proxy.proxyState.stopSessions();
  await waitUntil(() => !processExists(pid));
  assert.equal(proxy.proxyState.activeTranscodes, 0);
});
