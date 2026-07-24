---
phase: 04-prove-the-sound-only-fips-ping
plan: "01"
subsystem: proof-control
tags: [fips, unix-socket, ndjson, ipv6, ping, docker]
requires:
  - phase: 03-negotiate-and-deliver-reliable-acoustic-packets
    provides: current-epoch Sound readiness and FIPS packet-admission boundary
provides:
  - Bounded read-only FIPS control-socket client
  - Strict current Sound proof join and Fixture-only ping controller
  - Bridge runtime image with Debian iputils-ping
affects: [04-02, 04-03, proof-status, physical-acceptance]
tech-stack:
  added: [Debian iputils-ping]
  patterns: [fixed-command Unix-socket control client, fail-closed cross-snapshot proof join]
key-files:
  created: [packages/bridge/src/fips-control-client.ts, packages/bridge/src/proof.ts, packages/bridge/src/proof-controller.ts]
  modified: [Dockerfile.bridge, packages/bridge/test/fips-control-client.test.ts, packages/bridge/test/proof-controller.test.ts]
key-decisions:
  - "Control observation permits only three exact read-only FIPS queries over the private Unix socket."
  - "The proof controller requires an injected configured Role B IPv6 target; it has no fallback address."
  - "All automated controller outcomes remain Fixture evidence and cannot claim Open-air acceptance."
patterns-established:
  - "FIPS proof admission: freshly query peers, links, and transports sequentially, then join only matching current Sound facts."
  - "System process authority: use a fixed executable and immutable argument array after all topology gates pass."
requirements-completed: [FIPS-04, DEMO-01, DEMO-02]
coverage:
  - id: D1
    description: "Bounded allowlisted FIPS control-socket observations and cleanup"
    requirement: FIPS-04
    verification:
      - kind: unit
        ref: packages/bridge/test/fips-control-client.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: "One gated fixed-argument in-namespace IPv6 ping with Fixture evidence"
    requirement: DEMO-01
    verification:
      - kind: unit
        ref: packages/bridge/test/proof-controller.test.ts
        status: pass
      - kind: integration
        ref: "docker build -f Dockerfile.bridge -t fipwave-bridge:phase4 . && docker run --rm --entrypoint sh fipwave-bridge:phase4 -ec 'test -x /usr/bin/ping'"
        status: pass
    human_judgment: true
    rationale: "Fixture orchestration and an image tool check cannot prove an Open-air authenticated FIPS Sound hop or a remote kernel echo reply."
  - id: D3
    description: "Fail-closed peer/link/transport, acoustic epoch, isolation, and target proof admission"
    requirement: DEMO-02
    verification:
      - kind: unit
        ref: packages/bridge/test/proof-controller.test.ts
        status: pass
    human_judgment: true
    rationale: "The actual acoustic peer, isolated Role B, and real ICMPv6 reply require the named two-laptop physical acceptance record."
duration: 36min
completed: 2026-07-24
status: complete
---

# Phase 4 Plan 1: Production FIPS Proof Tracer Summary

**A fail-closed FIPS control-socket proof join gates exactly one in-namespace `ping -6` while preserving Fixture-only automated evidence.**

## Performance

- **Duration:** 36 min
- **Started:** 2026-07-24T10:52:33Z
- **Completed:** 2026-07-24T11:28:00Z
- **Tasks:** 2/2
- **Files modified:** 6

## Accomplishments

- Added a one-request/one-response NDJSON Unix-socket client that permits only `show_peers`, `show_links`, and `show_transports`, with byte caps, timers, schema checks, safe errors, and cleanup.
- Added a strict, fresh peer/link/transport/acoustic/isolation join before the controller can invoke `/usr/bin/ping -6 -n -c 1 -W 15` through an argument array.
- Added `iputils-ping` to the final non-root bridge image and verified its executable exists.

## Task Commits

1. **Task 1: Trace current authenticated Sound facts to one kernel ping** - `12cabfb` (test), `b32f7c0` (feat), `14ca1b8` (fix)
2. **Task 2: Put the authoritative system ping in the runner image** - `1725592` (chore)

## Files Created/Modified

- `packages/bridge/src/fips-control-client.ts` - fixed-query bounded FIPS control client.
- `packages/bridge/src/proof.ts` - immutable proof contracts, Sound join, and safe ping result projection.
- `packages/bridge/src/proof-controller.ts` - injected state gates and one-ping process authority.
- `packages/bridge/test/fips-control-client.test.ts` - NDJSON and client cleanup fixture coverage.
- `packages/bridge/test/proof-controller.test.ts` - process authority and fail-closed gate coverage.
- `Dockerfile.bridge` - final-stage `iputils-ping` installation.

## Decisions Made

- Kept the FIPS control channel private and read-only: no copied `fipsctl`, TCP listener, generic command API, command parameters, shell, or retries.
- Required the configured B IPv6 address as an injected controller dependency, preventing any target-address fallback from reaching the process boundary.
- Kept raw process streams in the structured artifact while projecting only bounded scalar proof facts for later browser use.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Required explicit configured target authority**
- **Found during:** Task 1
- **Issue:** The controller initially had no configuration-owned B IPv6 source in the existing Phase 1–3 config surface; a fallback target would violate D-10.
- **Fix:** Made `targetIpv6` mandatory on the controller dependency seam, so the later production runner must pass the role configuration’s target explicitly.
- **Files modified:** `packages/bridge/src/proof-controller.ts`, `packages/bridge/test/proof-controller.test.ts`
- **Verification:** Focused Vitest suite and `npm run typecheck` pass.
- **Committed in:** `14ca1b8`

**Total deviations:** 1 auto-fixed (Rule 2)
**Impact on plan:** Correctness-only; the explicit seam is consumed by the later config/runner plans and prevents target injection or accidental fallback.

## Issues Encountered

- The precondition’s initial guessed test paths did not match the repository; the actual `acoustic-session-adapter` Vitest suite and vendored `cargo test sound_transport --locked` both passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04-02 can add the role-configured B target and live isolation attestation. Plan 04-03 can construct this controller in the Compose-shared FIPS namespace. The two-laptop Open-air FIPS/Sound peer and kernel-ping proof remains a mandatory human acceptance gate; no physical evidence was created or claimed here.

## Self-Check: PASSED

- All six implementation/test/image files and the summary exist.
- All four task commits are present in git history.

---
*Phase: 04-prove-the-sound-only-fips-ping*
*Completed: 2026-07-24*
