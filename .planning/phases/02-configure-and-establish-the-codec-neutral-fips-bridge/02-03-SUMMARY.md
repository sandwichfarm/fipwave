---
phase: 02-configure-and-establish-the-codec-neutral-fips-bridge
plan: 03
subsystem: configuration
tags: [typescript, configuration, resource-lifecycle, bridge, vitest]
requires:
  - phase: 02-01
    provides: initial A/B config projection and loopback bridge authority
provides:
  - Complete immutable A/B defaults and exact-schema override validation
  - Nsec-free public configuration projection for runner consumers
  - Idempotent reverse-order ownership cleanup for started local resources
affects: [02-04, 02-05, 02-06, 02-07, demo launcher]
tech-stack:
  added: []
  patterns: [deep-frozen validated config authority, explicit public allowlist, registered-handle resource ownership]
key-files:
  created: [packages/bridge/src/resource-owner.ts, packages/bridge/test/resource-owner.test.ts]
  modified: [packages/bridge/src/demo-config.ts, packages/bridge/test/demo-config.test.ts, packages/bridge/src/runner.ts, tests/production-runner.test.ts]
key-decisions:
  - "Canonical roles keep fixed safe ports while optional overrides must use an exact nested schema and preserve complementary peer mappings."
  - "Production runner cleanup is restricted to returned close handles registered after successful startup."
patterns-established:
  - "Private identity tables are consumed only by resolver internals; browser-facing runner state is an explicit nsec-free projection."
  - "Startup failures invoke owned cleanup and collapse internal errors to a bounded safe runner error."
requirements-completed: [CONFIG-02, FIPS-01, WEB-05]
coverage:
  - id: D1
    description: Immutable complete A/B configuration authority with safe override rejection
    requirement: CONFIG-02
    verification:
      - kind: unit
        ref: packages/bridge/test/demo-config.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Registered-only runner resource cleanup and public resolved configuration
    requirement: WEB-05
    verification:
      - kind: unit
        ref: packages/bridge/test/resource-owner.test.ts
        status: pass
      - kind: integration
        ref: tests/production-runner.test.ts
        status: pass
    human_judgment: false
duration: 6min
completed: 2026-07-24
status: complete
---

# Phase 02 Plan 03: Validated A/B authority and runner ownership Summary

**A single deep-frozen A/B authority now supplies role, peer, port, codec, audio, calibration, retry, heartbeat, and MTU values while the runner exposes only public state and closes only resources it owns.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-24T01:27:03Z
- **Completed:** 2026-07-24T01:32:45Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Expanded the tracer resolver into the sole source for complementary identities, local bridge/FIPS endpoints, sound MTU, codec capability, audio defaults, calibration candidates, retries, and heartbeat thresholds.
- Added exact nested override validation with safe stable errors, deep freezing, fixed peer mappings, and nsec-free public projections.
- Added `ResourceOwner` to register returned close handles only, clean them up in reverse order exactly once, and aggregate cleanup failures without exposing child error content.
- Refactored the runner to consume resolved config, use its heartbeat threshold, publish a safe projection, and unwind its bridge after partial startup failure.

## Task Commits

1. **Task 1: Complete the validated A/B defaults and override authority** - `c6b5a81` (test), `08c0149` (feat)
2. **Task 2: Feed resolved config into the runner and own its lifecycle explicitly** - `bd9934c` (test), `cea662d` (feat)

## Files Created/Modified

- `packages/bridge/src/demo-config.ts` - Frozen full A/B defaults, exact overrides, and public allowlist.
- `packages/bridge/test/demo-config.test.ts` - Canonical, override, safety, and nsec-redaction coverage.
- `packages/bridge/src/resource-owner.ts` - Registered-handle ownership and idempotent cleanup primitive.
- `packages/bridge/test/resource-owner.test.ts` - Cleanup order, idempotency, and safe aggregation tests.
- `packages/bridge/src/runner.ts` - Resolved config consumption and owned bridge lifecycle.
- `tests/production-runner.test.ts` - Runner projection and partial startup cleanup integration tests.

## Decisions Made

- Kept port `0` only as the existing runner test seam; canonical demo config uses validated non-zero distinct browser and FIPS ports.
- Preserved current runner qualification evidence/cache behavior while sourcing its role and dead-link threshold from resolved config.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved the existing safe literal-role error contract**
- **Found during:** Task 1 green verification
- **Issue:** The expanded resolver changed the existing human-readable safe role rejection text, breaking its tracer assertion.
- **Fix:** Restored the stable `demo config role must be literal a or b` message while retaining the new fail-closed error format elsewhere.
- **Files modified:** `packages/bridge/src/demo-config.ts`
- **Verification:** Configuration authority tests pass.
- **Committed in:** `08c0149`

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** Preserved compatibility without weakening validation or secret redaction.

## TDD Gate Compliance

- Task 1 RED/GREEN: `c6b5a81` → `08c0149`.
- Task 2 RED/GREEN: `bd9934c` → `cea662d`.

## Known Stubs

None. The pre-existing test title's word “placeholder” describes qualification evidence and is not a runtime stub.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

- The launcher and Compose plans can consume canonical A/B configuration without duplicating identities, endpoint choices, or timing defaults.
- Subsequent lifecycle work can reuse `ResourceOwner` to stop exactly the bridge and child handles it registered.

---
*Phase: 02-configure-and-establish-the-codec-neutral-fips-bridge*
*Completed: 2026-07-24*

## Self-Check: PASSED

- All six planned configuration, ownership, runner, and test artifacts exist.
- Both task RED/GREEN commit pairs exist in git history.
