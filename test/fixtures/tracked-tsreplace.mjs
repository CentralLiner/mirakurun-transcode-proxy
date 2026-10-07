import { writeFileSync } from "node:fs";

// The fake encoder's -e argument is a temporary PID marker, never an executable.
const markerIndex = process.argv.indexOf("-e");
if (markerIndex === -1 || !process.argv[markerIndex + 1]) {
  throw new Error("This fixture requires an -e PID marker argument");
}
const marker = process.argv[markerIndex + 1];
writeFileSync(marker, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
if (marker.endsWith("ignore-term.json")) {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
}
process.stdin.pipe(process.stdout);
