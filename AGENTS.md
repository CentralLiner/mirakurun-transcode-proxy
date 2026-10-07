# Repository Guidelines

## Project Structure & Module Organization

This dependency-free Node.js ES-module proxy forwards Mirakurun APIs and transcodes service/program streams with `tsreplace` and `QSVEncC`.

- `src/server.js`: HTTP routing, upstream forwarding, transcoder sessions, and shutdown.
- `src/config.js`: environment validation, tuning profiles, and encoder arguments.
- `test/*.test.js`: configuration and proxy tests; `test/fixtures/` contains the fake transcoder.
- `scripts/`: configuration, hardware preflight, smoke checks, and MPEG-TS inspection.
- `patches/`: upstream `tsreplace` fixes applied by `Dockerfile`; `examples/` contains BonDriver configuration.
- `compose.yaml`, `README.md`, and `CHANGELOG.md`: deployment and operating documentation.

## Build, Test, and Development Commands

Use Node.js 18+; no JavaScript compilation or dependency installation is required.

- `npm start`: start the proxy on port 40773. Supply environment variables directly; native Node startup does not load `.env`. Real transcoding requires installed encoder binaries and Intel QSV access.
- `npm run check`: syntax-check application files and the TS inspection script.
- `npm test`: run Node's built-in test suite.
- `docker compose build`: build the image and patched `tsreplace`; use `--no-cache` when validating patch changes.
- `docker compose up -d`: start the configured container.
- `./scripts/preflight.sh`: validate Compose, build the image, and check QSV hardware.
- `npm run check:ts -- sample.ts`: inspect captured transport-stream integrity.

## Coding Style & Naming Conventions

Use two-space indentation, double-quoted JavaScript strings, semicolons, and explicit ES-module imports. Use camelCase for functions and variables, and UPPER_SNAKE_CASE for constants and environment keys. Keep shell scripts POSIX-compatible with `#!/bin/sh` and `set -eu`. No dedicated formatter or linter is configured.

## Testing Guidelines

Use `node:test` and `node:assert/strict`; name files `test/<module>.test.js` and describe expected behavior in test names. Proxy tests use local HTTP servers and a fake transcoder without QSV hardware. Cover changed behavior and failure paths, and clean up servers/processes. No coverage threshold is configured. Verify encoder or patch changes on real QSV hardware with captured TS inspection.

## Commit & Pull Request Guidelines

Git history is unavailable in this checkout, so existing commit conventions cannot be verified. Use concise imperative subjects, such as `Fix upstream timeout handling`. PRs should explain behavior changes, link related issues, and report checks and hardware results. Update README/CHANGELOG for operating changes.

## Security & Configuration Tips

Keep `.env` and private recordings out of commits. Review `MIRAKURUN_URL` and `BIND_ADDRESS`; prefer a Tailscale address or firewall restrictions. Preserve AAC audio, ARIB subtitles, and timing/service metadata when changing transcoding.
