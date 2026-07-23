---
phase: 01-qualify-the-demo-substrate
plan: 04
subsystem: protocol
tags: [fwav, qualification, corpus, sha256, validation, evidence]
requires:
  - phase: 01-02
    provides: loopback-only bridge skeleton and deterministic Node validation surface
  - phase: 01-03
    provides: epoch-aware browser audio preflight and PCM boundary
provides:
  - FWAV v1 binary encoder/decoder with strict caps and PCM validation
  - atomic schema-validated machine reports and fail-closed exact-host selection
  - committed seed-derived bidirectional corpus with SHA-256 drift detection
affects: [phase-01, codec-adapters, qualification-console, fips-transport]
tech-stack:
  added: []
  patterns: [little-endian-versioned-envelope, schema-validated-evidence, seed-derived-fixture-corpus, fail-closed-physical-selection]
key-files:
  created: [packages/bridge/src/protocol.ts, packages/bridge/src/report.ts, scripts/generate-corpus.mjs, fixtures/corpus/manifest.json]
  modified: [package.json, tsconfig.json]
key-decisions:
  - "Treat Fixture and Loopback reports as valid diagnostic evidence but never as physical selection evidence."
  - "Bind the corpus to a single committed seed and reject any manifest drift rather than trusting mutable fixture files."
patterns-established:
  - "All bridge messages use the fixed 32-byte FWAV v1 header and reject unsupported metadata before processing payloads."
  - "Selection accepts only two exact named hosts with Open air reports, zero queue discontinuities, and MTU at least 1357."
requirements-completed: [CODEC-02, CODEC-03, CODEC-04]
coverage:
  - id: D1
    description: "FWAV qualification frames preserve seeded corpus evidence through an atomic machine report."
    requirement: CODEC-02
    verification:
      - kind: integration
        ref: "tests/qualification-evidence-tracer.test.ts#carries a committed 256-byte fixture case through FWAV and an atomic non-physical report"
        status: pass
    human_judgment: false
  - id: D2
    description: "Malformed, oversized, stale, duplicate, and non-physical protocol/report evidence fails closed."
    requirement: CODEC-03
    verification:
      - kind: unit
        ref: "packages/bridge/test/protocol.test.ts and packages/bridge/test/report.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The exact bidirectional 256-byte and 1536-byte corpus is deterministically regenerated and drift-checked."
    requirement: CODEC-04
    verification:
      - kind: unit
        ref: "tests/corpus.test.ts and npm run generate:corpus -- --check"
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-07-23
status: complete
---

# Phase 01 Plan 04: FWAV Evidence Contract Summary

**A strict FWAV v1 envelope, atomic qualification evidence contract, and 50-case seeded bidirectional corpus now give every codec path a replayable fail-closed gate.**

## Performance

- **Duration:** 4 min
- **Completed:** 2026-07-23
- **Tasks:** 3/3
- **Files modified:** 10

## Accomplishments

- Added complete typed FWAV v1 encode/decode support for all eight message types, payload caps, PCM declarations, and epoch/sequence replay rejection.
- Added schema-versioned machine report persistence and a selection merge that needs two exact named `Open air` hosts; Fixture/Loopback evidence returns `human_needed`.
- Frozen 20 unique 256-byte and five unique 1536-byte SHA-256 cases per literal direction, with manifest check mode that rejects every identity or digest edit.

## Task Commits

1. **Task 1: Carry one corpus case through FWAV and canonical report persistence** - `47fcf19` (test), `14e6fa7` (feat)
2. **Task 2: Harden every FWAV and report rejection boundary** - `bab12bb` (feat)
3. **Task 3: Complete and freeze the bidirectional corpus** - `12f9519` (test), `382ca6b` (feat)

## Files Created/Modified

- `packages/bridge/src/protocol.ts` - FWAV v1 encoding, decoding, PCM validation, and epoch tracker.
- `packages/bridge/src/report.ts` - machine-report validation, atomic persistence, and exact-host selection merge.
- `scripts/generate-corpus.mjs` - deterministic seed-driven corpus generation and drift validation.
- `fixtures/corpus/manifest.json` - committed 50-case direction/size/pattern/digest corpus.
- `packages/bridge/test/protocol.test.ts` and `packages/bridge/test/report.test.ts` - rejection boundary coverage.
- `tests/qualification-evidence-tracer.test.ts` and `tests/corpus.test.ts` - end-to-end evidence and immutable corpus coverage.

## Decisions Made

- Fixture and loopback paths are useful diagnostics only; they never become physical qualification or a selected profile.
- The maximum bridge message is 256 KiB including its header; report queues use matching byte bounds plus a five-second time ceiling.
- Corpus payload bytes are derived in memory from a committed seed; the manifest is the immutable evidence record, not an editable source of truth.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected machine-identity field validation**
- **Found during:** Task 2
- **Issue:** The field/key iteration initially validated identity property names instead of their values, allowing an empty host name.
- **Fix:** Validated each identity value and added a rejection test for empty host names.
- **Files modified:** `packages/bridge/src/report.ts`, `packages/bridge/test/report.test.ts`
- **Verification:** `npm run test:unit -- packages/bridge/test/report.test.ts`
- **Committed in:** `bab12bb`

**2. [Rule 3 - Blocking] Enabled TypeScript to infer the checked JavaScript corpus module**
- **Found during:** Task 1
- **Issue:** Strict TypeScript could not type-check tests importing the planned `.mjs` generator.
- **Fix:** Enabled `allowJs` while retaining strict checking, so the deterministic script exports remain checked at the test boundary.
- **Files modified:** `tsconfig.json`
- **Verification:** `npm run typecheck`
- **Committed in:** `14e6fa7`

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking). Both preserve the planned trust boundary and no scope was added.

## Issues Encountered

The host default Node runtime was not used; all checks ran under the locked Node 22.23.1 executable.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 01-05 can route codec adapter results through the canonical evidence and selection APIs. The corpus and reports deliberately remain non-physical until the exact two-laptop Open air procedure in 01-07.

## Self-Check: PASSED

Confirmed all protocol, report, corpus, and test artifacts exist; task commits `47fcf19`, `14e6fa7`, `bab12bb`, `12f9519`, and `382ca6b` are present in git history; the full `npm run check` suite passed.
