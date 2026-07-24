---
phase: 02-configure-and-establish-the-codec-neutral-fips-bridge
plan: 01
subsystem: bridge
tags: [typescript, websocket, fwav, fips, configuration, vitest]
requires:
  - phase: 01-qualify-the-demo-substrate
    provides: fixed FWAV framing, loopback bridge authority, and non-physical evidence rules
provides:
  - Typed A/B demo configuration with an allowlisted public projection
  - Codec-neutral FIPS_PACKET FWAV contract with zero PCM metadata
  - Bounded loopback browser/FIPS packet relay with epoch and role validation
affects: [02-03, 02-04, 02-06, 02-07, FIPS sound transport]
tech-stack:
  added: []
  patterns: [allowlisted secret-safe configuration projection, role-separated local WebSocket endpoints, opaque complete-packet FWAV relay]
key-files:
  created: [packages/bridge/src/demo-config.ts, packages/bridge/test/demo-config.test.ts, packages/bridge/test/fips-packet-bridge.test.ts]
  modified: [packages/bridge/src/protocol.ts, packages/bridge/src/server.ts]
key-decisions:
  - "Expose /bridge/browser and /bridge/fips on the existing loopback authority, retaining /bridge for the current browser client."
  - "Treat FIPS_PACKET as opaque binary data with no PCM metadata or codec fields."
  - "Count packets only after forwarding to the opposite local endpoint; invalid input cannot advance accepted counters."
patterns-established:
  - "Private configuration is never spread into public state; public projections select allowlisted fields."
  - "A single bridge epoch validates packet frames on both local endpoint roles."
requirements-completed: [CONFIG-02, CODEC-01, WEB-04, WEB-05, FIPS-03]
coverage:
  - id: D1
    description: Typed literal A/B resolver with public nsec-free projection
    requirement: CONFIG-02
    verification:
      - kind: unit
        ref: packages/bridge/test/demo-config.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Complete opaque FIPS_PACKET framing and bounded local WebSocket relay
    requirement: WEB-04
    verification:
      - kind: integration
        ref: packages/bridge/test/fips-packet-bridge.test.ts
        status: pass
      - kind: unit
        ref: packages/bridge/test/protocol.test.ts
        status: pass
    human_judgment: false
duration: 5min
completed: 2026-07-24
status: complete
---

# Phase 02 Plan 01: Codec-neutral FIPS packet tracer Summary

**A secret-safe A/B configuration authority and bounded binary bridge now relay exact 1357-byte opaque FIPS packets between local browser and FIPS endpoint roles.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-24T01:13:28Z
- **Completed:** 2026-07-24T01:18:29Z
- **Tasks:** 1
- **Files modified:** 5

## Accomplishments

- Added the sole typed lower-case A/B resolver and a deliberately allowlisted public configuration projection.
- Added `FIPS_PACKET` to the fixed FWAV envelope without codec, waveform, fragment, or PCM metadata.
- Extended the existing loopback server with distinct browser/FIPS socket paths, bounded directional queues, epoch/sequence checks, and post-forward packet counters.
- Proved byte-identical 1357-byte bidirectional relay and rejection of text, wrong-role, stale, malformed, and over-limit input under Node 22.23.1.

## Task Commits

1. **Task 1: End-to-end role A complete-packet relay in both local directions** - `efc2d08` (test), `89cd805` (feat)

## Files Created/Modified

- `packages/bridge/src/demo-config.ts` - Frozen A/B role authority and public projection.
- `packages/bridge/src/protocol.ts` - `FIPS_PACKET` FWAV message type.
- `packages/bridge/src/server.ts` - Role-separated loopback packet relay and safe local tracer state.
- `packages/bridge/test/demo-config.test.ts` - Role and secret-redaction checks.
- `packages/bridge/test/fips-packet-bridge.test.ts` - Frame validation and real dual-WebSocket integration coverage.

## Decisions Made

- Kept all packet dispatch inside `createBridgeServer` so reset, origin checks, and epoch ownership remain centralized.
- Classified the bridge state as `Loopback` with acoustic, peer, and ping readiness all false; the tracer makes no physical or authenticated-peer claim.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected patterned test-packet construction**
- **Found during:** Task 1 verification
- **Issue:** `Buffer.alloc` does not accept a callback fill function, so the intended non-uniform 1357-byte test payload was invalid.
- **Fix:** Constructed the payload from an explicit byte sequence before running the green verification.
- **Files modified:** `packages/bridge/test/fips-packet-bridge.test.ts`
- **Verification:** Targeted protocol and bridge tests pass byte-identity checks.
- **Committed in:** `89cd805`

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** The correction made the specified arbitrary-byte proof accurate without expanding scope.

## TDD Gate Compliance

- RED: `efc2d08` contains the failing configuration and packet-bridge tests.
- GREEN: `89cd805` implements the minimum configuration, framing, and relay behavior required for those tests to pass.

## Known Stubs

None.

## Issues Encountered

- The default runtime was Node 25.2.1; verification used the supplied Node 22.23.1 runtime explicitly, as required by the plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 02-03 and 02-04 can layer resolved configuration and lifecycle/queue state onto the retained bridge authority.
- The FIPS transport can consume `/bridge/fips` as its local opaque-packet endpoint without codec-specific fields.

---
*Phase: 02-configure-and-establish-the-codec-neutral-fips-bridge*
*Completed: 2026-07-24*

## Self-Check: PASSED

- All five planned bridge/configuration artifacts exist.
- RED and GREEN TDD commits `efc2d08` and `89cd805` exist in git history.
