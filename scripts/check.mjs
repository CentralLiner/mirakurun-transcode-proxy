#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function filesIn(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(relative) : [relative];
  });
}

const sourceFiles = ["src", "scripts", "test"].flatMap(filesIn);
for (const filename of sourceFiles) {
  const args = /\.(js|mjs)$/.test(filename) ? [process.execPath, ["--check", filename]]
    : filename.endsWith(".sh") ? ["sh", ["-n", filename]] : null;
  if (!args) continue;
  const result = spawnSync(args[0], args[1], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Syntax check failed: ${filename}`);
}

const markdownFiles = readdirSync(root).filter((name) => name.endsWith(".md"))
  .concat(filesIn("docs").filter((name) => name.endsWith(".md")));
for (const filename of markdownFiles) {
  const content = readFileSync(path.join(root, filename), "utf8");
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target) || target.startsWith("/")) continue;
    assert.ok(existsSync(path.resolve(root, path.dirname(filename), decodeURIComponent(target))),
      `Broken documentation link in ${filename}: ${target}`);
  }
}

const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
const compose = readFileSync(path.join(root, "compose.yaml"), "utf8");
const notices = readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
const hash = dockerfile.match(/^ARG QSVENC_SHA256=([a-f0-9]{64})$/m)?.[1];
assert.ok(hash, "Dockerfile must pin the QSVEncC SHA-256");
assert.ok(compose.includes(`QSVENC_SHA256: ${hash}`), "Compose QSVEncC hash differs");
assert.ok(notices.includes(hash), "Third-party notice QSVEncC hash differs");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(packageJson.license, "MIT");
assert.ok(readFileSync(path.join(root, "LICENSE"), "utf8").startsWith("MIT License\n"));
console.log("JavaScript/shell syntax, documentation links, and release metadata passed.");
