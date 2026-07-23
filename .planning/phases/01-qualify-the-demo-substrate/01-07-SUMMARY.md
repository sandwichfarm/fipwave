---
phase: 01-qualify-the-demo-substrate
plan: 07
subsystem: production-runner
tags: [node, websocket, codec-cache, quiet-js, libfec, playwright]
requires:
  - phase: 01-05
    provides: FWAV binary protocol and qualification evidence conventions
  - phase: 01-06
    provides: exact-host TUN evidence contract used by Open-air gating
provides:
  - Loopback-only production runner with immutable qualification authority
  - Hash-locked, offline-verifiable Quiet/libfec/Cyrinx asset cache
  - Same-origin allowlisted asset server and real Chromium Quiet initialization proof
affects: [02-codec-neutral-fips-bridge, codec-qualification, demo-runtime]
tech-stack:
  added: []
  patterns:
    - Runner reads and verifies the complete codec lock before serving any browser asset.
    - Browser asset routes are exact filename allowlists with MIME, ETag, no-sniff, and canonical-path checks.
key-files:
  created:
    - codec-assets.lock.json
    - scripts/fetch-codec-assets.mjs
    - apps/modem-ui/e2e/codec-assets.spec.ts
    - playwright.production.config.ts
  modified:
    - packages/bridge/src/runner.ts
    - packages/bridge/src/server.ts
    - package.json
key-decisions:
  - "Cache Quiet/libfec/Cyrinx assets by exact URL, hash, size ceiling, MIME, revision, and license; Cyrinx remains non-browser-serving."
  - "The production runner verifies the entire cache before binding its loopback origin, then serves only browser-marked names."
  - "Quiet prefixes must be configured before the Emscripten script begins; the production Chromium test follows that real initialization order."
patterns-established:
  - "Executable third-party browser assets are fetched to a temporary sibling, validated offline, then promoted as the only codec cache."
requirements-completed: [CODEC-03, CODEC-04, WEB-01, WEB-03, WEB-07]
coverage:
  - id: D1
    description: Loopback production runner owns immutable identity, role, evidence mode, report target, and bridge routing.
    requirement: WEB-01
    verification:
      - kind: unit
        ref: tests/production-runner.test.ts#production runner
        status: pass
    human_judgment: false
  - id: D2
    description: Quiet, libfec, and Cyrinx source bytes plus redistributed notices are hash-locked and can be verified without network access.
    requirement: CODEC-03
    verification:
      - kind: other
        ref: npm run fetch:codecs:check
        status: pass
      - kind: other
        ref: node --test tests/codec-assets.test.mjs
        status: pass
    human_judgment: false
  - id: D3
    description: Production origin exposes only verified browser assets and real Chromium initializes Quiet with its same-origin memory, profiles, and libfec asset.
    requirement: CODEC-04
    verification:
      - kind: e2e
        ref: apps/modem-ui/e2e/codec-assets.spec.ts#production origin serves only immutable, allowlisted codec files with fixed MIME and hash identity
        status: pass
    human_judgment: false
  - id: D4
    description: Exact two-laptop open-air codec acquisition and Docker/TUN evidence are still unperformed physical qualification.
    requirement: WEB-07
    verification: []
    human_judgment: true
    rationale: Browser asset initialization proves no physical acoustic delivery, microphone behavior, or exact-host TUN result.
duration: 42min
completed: 2026-07-23
status: complete
---

# Phase 01 Plan 07: Production Codec Boundary Summary

**A loopback-only production runner now owns qualification authority and serves only hash-verified Quiet/libfec browser assets, with real Chromium initialization proof.**

## Performance

- **Duration:** 42 min
- **Completed:** 2026-07-23
- **Tasks:** 3/3
- **Files modified:** 11

## Accomplishments

- Added the compiled runner with immutable `/qualification-config`, binary same-origin `/bridge`, loopback-only binding, runner-stamped results, bounded epoch queues, and an explicit exact-host-only Open-air switch.
- Added an atomic, Node-core codec fetcher and schema lock for pinned Quiet, libfec, Cyrinx, and their required license/notice files; its offline check rejects missing, extra, symlinked, oversized, or altered cache entries.
- Added verified-cache startup checks and an exact `/codec-assets/{name}` allowlist with fixed MIME, `nosniff`, immutable cache headers, content length, and SHA-256 ETags.
- Proved an unmocked Chromium page loads the real Quiet scripts, memory file, profiles, and libfec asset from the production origin and completes `Quiet.init`.

## Task Commits

1. **Task 1: Carry the built browser through runner-owned config and its real bridge** - `bb872d8` (test), `671a3c7` (feat)
2. **Task 2: Fetch an atomic hash-locked codec and license cache** - `4f8ac4e` (test), `8aca7bd` (feat)
3. **Task 3: Serve and initialize only allowlisted cached browser assets** - `574805c` (test), `619d8f4` (feat)

## Files Created/Modified

- `packages/bridge/src/runner.ts` - Production option validation, immutable configuration, exact-host Open-air gate, and full cache verification.
- `packages/bridge/src/server.ts` - Same-origin UI/bridge/config server plus traversal-safe hash-verified asset route.
- `codec-assets.lock.json` - Immutable upstream URL, byte, size, MIME, revision, and license metadata.
- `scripts/fetch-codec-assets.mjs` - HTTPS download, temporary cache validation, atomic promotion, and network-free check.
- `apps/modem-ui/e2e/codec-assets.spec.ts` - Real production Chromium verification without codec or network mocks.
- `playwright.production.config.ts` - Compiled runner harness for the production-only browser test.

## Decisions Made

- Browser-visible codec files remain a small subset of the locked cache: Quiet runtime, libfec, profiles, memory, and notices. Cyrinx's archive and source notices are verified build inputs but never served.
- Asset identity is established by the runner's startup cache verification and rechecked at response time; a byte mismatch fails closed rather than serving an altered file.
- The Chromium proof calls `Quiet.init` before loading its Emscripten runtime, as required for its memory and libfec prefixes to take effect.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Resolved the production runner's compiled project-root path**
- **Found during:** Task 3
- **Issue:** The original relative root calculation resolved to `dist/server` after TypeScript compilation, so the runner could not find `dist/modem-ui`.
- **Fix:** Walk upward to the repository's `package.json`/codec-lock root from either source or compiled module location.
- **Files modified:** `packages/bridge/src/runner.ts`, `packages/bridge/src/server.ts`
- **Verification:** `npm run build`, `npm run test:unit -- tests/production-runner.test.ts`, and the production Chromium test passed.
- **Committed in:** `619d8f4`

**2. [Rule 1 - Bug] Kept the production-only browser test out of the development-server suite**
- **Found during:** Task 3
- **Issue:** The general Playwright configuration attempted the port-4173 production test against its Vite server on port 5173.
- **Fix:** Explicitly excluded the production test from the development configuration while retaining it in `playwright.production.config.ts`.
- **Files modified:** `playwright.config.ts`
- **Verification:** `npm run check` and `npm run test:browser:production -- apps/modem-ui/e2e/codec-assets.spec.ts` passed.
- **Committed in:** `619d8f4`

**Total deviations:** 2 auto-fixed Rule 1 bugs. Both make the planned production verification runnable without weakening cache, origin, or physical-evidence constraints.

## Automated Checks

- `npm run fetch:codecs && npm run fetch:codecs:check && node --test tests/codec-assets.test.mjs` — passed.
- `npm run build && npm run test:unit -- tests/production-runner.test.ts` — passed.
- `npm run test:browser:production -- apps/modem-ui/e2e/codec-assets.spec.ts` — passed.
- `npm run check` — passed (47 unit tests, 5 development browser tests, build, corpus, fixture, and Compose checks).

## Known Stubs

None. The physical codec session is deliberately not represented as a fixture success and remains gated by exact-laptop evidence.

## User Setup Required

The codec cache is ignored and must be populated on each demo laptop with `npm run fetch:codecs` before starting the runner. The next operation still requires the planned exact-laptop microphone/speaker and Docker/TUN procedure; no physical acoustic success is claimed here.

## Next Phase Readiness

The production browser/bridge/codec asset boundary is ready for real local and two-laptop qualification. The remaining blocker is the irreducible physical evidence gate, not a simulated UI result.

## Self-Check: PASSED

Confirmed the runner, server, lock, fetcher, production Playwright config, and Chromium test exist. Confirmed task commits `bb872d8`, `671a3c7`, `4f8ac4e`, `8aca7bd`, `574805c`, and `619d8f4` exist in git history.
