import assert from "node:assert/strict";
import { test } from "node:test";
import { createProxyServer, stripHopByHopHeaders, targetFor } from "../src/server.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig({ MIRAKURUN_URL: "http://mirakurun.invalid:40772" });

test("upstream targets preserve paths, queries, and the configured host", () => {
  const target = targetFor(config, "/api/services/1024/stream?decode=1&url=http://other.invalid");
  assert.equal(target.origin, config.upstreamUrl.origin);
  assert.equal(target.pathname, "/api/services/1024/stream");
  assert.equal(target.search, "?decode=1&url=http://other.invalid");
});

test("absolute URLs, network paths, and backslashes cannot change the upstream", () => {
  for (const path of [
    "http://other.invalid/api/version",
    "https://mirakurun.invalid:40772/api/version",
    "//other.invalid/api/version",
    "/\\other.invalid/api/version",
    "\\\\other.invalid/api/version",
    "api/version",
    "*",
    "",
    undefined,
  ]) {
    assert.throws(() => targetFor(config, path), TypeError);
  }
});

test("invalid request targets return 400 before making an upstream request", () => {
  const server = createProxyServer(config);
  let statusCode;
  let body;
  server.emit("request", { url: "http://other.invalid/api/version", method: "GET" }, {
    writeHead(status) { statusCode = status; },
    end(value) { body = JSON.parse(value); },
  });
  assert.equal(statusCode, 400);
  assert.equal(body.reason, "Invalid request URL");
});

test("Connection-nominated headers are stripped as well as standard hop-by-hop headers", () => {
  assert.deepEqual(stripHopByHopHeaders({
    connection: "keep-alive, X-Private",
    "keep-alive": "timeout=5",
    "x-private": "remove",
    "x-mirakurun-priority": "0",
  }), { "x-mirakurun-priority": "0" });
});
