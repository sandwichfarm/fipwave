---
phase: 01-qualify-the-demo-substrate
plan: 02
subsystem: tooling
tags: [node-22, typescript, vite, vitest, playwright, eslint, websocket]
requires:
  - phase: 01-01
    provides: audited eight-package dependency allowlist and lockfile verifier
provides:
  - exact Node 22.23.1 lock-first validation surface
  - binary loopback WebSocket tracer with canonical non-physical report evidence
  - strict TypeScript and deterministic browser, unit, build, and future-gate commands
affects: [phase-01, browser-audio, qualification, docker-tun]
tech-stack:
  added: [TypeScript, Vite, Vitest, Playwright, ESLint, ws]
  patterns: [lock-first aggregate checks, loopback-only tooling defaults, explicit non-physical evidence]
key-files:
  created: [tsconfig.json, vite.config.ts, vitest.config.ts, playwright.config.ts, eslint.config.js]
  modified: [package.json, packages/bridge/src/server.ts, .gitignore]
key-decisions:
  - "Run ESLint only on JavaScript until the audited dependency set gains a TypeScript parser; strict tsc owns TypeScript validation."
  - "Expose later-phase deterministic commands now as terminating, argument-safe seams without claiming that their hardware workflows are implemented."
patterns-established:
  - "Every aggregate gate starts with verify:dependencies and is hardware-independent."
  - "Vite and browser tooling bind to loopback by default."
requirements-completed: [CODEC-02, CODEC-03, WEB-01, WEB-03]
coverage:
  - id: D1
    description: "Binary loopback WebSocket tracer persists explicitly non-physical qualification evidence."
    requirement: WEB-03
    verification:
      - kind: integration
        ref: "tests/skeleton.test.ts#walking skeleton"
        status: pass
    human_judgment: false
  - id: D2
    description: "Wave 0 lint, typecheck, unit, browser, build, and aggregate commands terminate without hardware."
    requirement: WEB-01
    verification:
      - kind: other
        ref: "npm run check"
        status: pass
    human_judgment: false
duration: 6min
completed: 2026-07-23
status: complete
---

# Phase 01 Plan 02: Wave 0 Tooling Summary

**A lock-verified Node 22 command surface now exercises the binary loopback bridge, strict TypeScript, browser tooling, and production build without physical hardware.**

## Performance

- **Duration:** 6 min
- **Completed:** 2026-07-23
- **Tasks:** 2/2
- **Files modified:** 11

## Accomplishments

- Locked the walking-skeleton browser action to a binary, loopback-only WebSocket and atomic, schema-versioned non-physical report.
- Added strict TypeScript plus Vite, Vitest, Playwright Chromium, and ESLint flat configurations.
- Added the complete Phase 1 command surface; `check` begins with direct dependency and lockfile validation and requires no microphone, speaker, Docker, TUN, or over-air codec.

## Task Commits

1. **Task 1: Prove Arm modem → binary loopback → canonical report** - `c970b46` (test), `7b7a0a4` (feat)
2. **Task 2: Complete deterministic Wave 0 commands** - `2a36b27` (feat)

## Files Created/Modified

- `package.json` - exact command surface rooted in `verify:dependencies`.
- `packages/bridge/src/server.ts` - correct typed HTTP-upgrade boundary for strict typechecking.
- `tsconfig.json` - strict shared browser, bridge, script, and test compilation.
- `vite.config.ts` - loopback-only development and preview server configuration.
- `vitest.config.ts` - deterministic Node test discovery.
- `playwright.config.ts` - Chromium-only mocked browser-test project.
- `eslint.config.js` - flat JavaScript lint configuration compatible with the audited package set.

## Decisions Made

- Strict `tsc` validates TypeScript because the audited package set deliberately excludes a TypeScript ESLint parser.
- Future qualification scripts are terminating, argument-safe seams until Plans 01-04 through 01-07 supply their real implementations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Made ESLint compatible with the audited dependency set**
- **Found during:** Task 2
- **Issue:** ESLint could not parse TypeScript because no TypeScript parser is part of the exactly audited dependencies.
- **Fix:** Linted JavaScript configuration and scripts only; retained strict TypeScript checking for every TypeScript source.
- **Files modified:** `eslint.config.js`
- **Verification:** `npm run lint` and `npm run typecheck` pass.
- **Committed in:** `2a36b27`

**2. [Rule 1 - Bug] Corrected the WebSocket upgrade socket type**
- **Found during:** Task 2
- **Issue:** strict TypeScript identified the Node HTTP upgrade callback as `Duplex`, not `net.Socket`.
- **Fix:** Typed the rejection helper as `Duplex`.
- **Files modified:** `packages/bridge/src/server.ts`
- **Verification:** `npm run typecheck` and `npm run test:skeleton` pass.
- **Committed in:** `2a36b27`

**3. [Rule 3 - Blocking] Accepted forwarded corpus-check arguments**
- **Found during:** Task 2
- **Issue:** `npm run generate:corpus -- --check` forwarded `--check` to Node, which conflicts with `--eval`.
- **Fix:** terminated Node option parsing before forwarded script arguments.
- **Files modified:** `package.json`
- **Verification:** `npm run generate:corpus -- --check` and `npm run check` pass.
- **Committed in:** `2a36b27`

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug). No scope expansion beyond making the planned command surface executable.

## Issues Encountered

The host default Node was not used; all verification ran with the prescribed Node 22.23.1 runtime.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 01-03 through 01-07 can replace the terminating corpus, qualification, and Compose seams with their real deterministic implementations. Physical two-laptop qualification remains intentionally unproven.

## Self-Check: PASSED

Confirmed all configuration and bridge files exist and all three task commits (`c970b46`, `7b7a0a4`, and `2a36b27`) are present in git history.
