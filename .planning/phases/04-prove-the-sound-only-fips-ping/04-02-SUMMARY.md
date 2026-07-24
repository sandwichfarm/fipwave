---
phase: 04-prove-the-sound-only-fips-ping
plan: "02"
subsystem: topology-isolation
tags: [fips, sound, udp, unix-socket, ipv6, docker]
requires:
  - phase: 04-prove-the-sound-only-fips-ping
    provides: bounded FIPS control client and gated proof controller
provides:
  - Immutable A participant and B Sound-only transport policies
  - Private shared Unix control-socket volume and fixed control probe
  - Bounded nonce-bound UDP isolation-attestation responder
affects: [04-03, 04-04, 04-05, physical-acceptance]
tech-stack:
  added: [Node dgram and crypto built-ins]
  patterns: [private Unix-socket control authority, nonce-bound canonical isolation evidence]
key-files:
  created: [packages/bridge/src/isolation-attestation.ts, packages/bridge/test/isolation-attestation.test.ts]
  modified: [packages/bridge/src/demo-config.ts, packages/bridge/src/runner.ts, compose.fips.yml, scripts/fips-compose-smoke.mjs]
key-decisions:
  - "Role B has exactly one configured Sound transport; Role A adds only outbound-only, non-advertised UDP."
  - "FIPS control is a private Unix socket over a named internal volume, never TCP or a host publication."
  - "One-use 32-byte challenges and canonical SHA-256 snapshot digests bind isolation evidence without an application-side signature scheme."
patterns-established:
  - "Topology authority: derive transport policy, target, and proof bounds from the literal role in one frozen config."
  - "Local smoke evidence: report human_needed rather than infer a remote authenticated Sound peer from a one-laptop Compose run."
requirements-completed: [DEPLOY-03, DEPLOY-04, DEPLOY-05, CONFIG-04]
coverage:
  - id: D1
    description: "Role-derived B Sound-only and A outbound-only UDP policy with secret-safe projection"
    requirement: CONFIG-04
    verification:
      - kind: unit
        ref: packages/bridge/test/demo-config.test.ts
        status: pass
      - kind: unit
        ref: tests/production-runner.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: "Private control socket, loopback-only bridge, shared namespace, and bounded isolation attestation"
    requirement: DEPLOY-03
    verification:
      - kind: unit
        ref: packages/bridge/test/isolation-attestation.test.ts
        status: pass
      - kind: integration
        ref: tests/fips-compose.test.mjs
        status: pass
      - kind: integration
        ref: "node scripts/fips-compose-smoke.mjs --role a; node scripts/fips-compose-smoke.mjs --role b"
        status: pass
    human_judgment: true
    rationale: "Each local role proves private control access, namespace, TUN, and configured topology only; matching remote authenticated Sound peer/link evidence requires two named laptops."
duration: 10min
completed: 2026-07-24
status: complete
---

# Phase 4 Plan 2: Sound-Only Topology Summary

**Role-derived FIPS topology keeps B Sound-only, keeps the browser bridge local, and binds future B isolation evidence to private Unix-socket facts and a one-use IPv6 challenge.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-24T11:29:00Z
- **Completed:** 2026-07-24T11:39:00Z
- **Tasks:** 2/2
- **Files modified:** 9

## Accomplishments

- Extended the single A/B config authority with deterministic `fips0` targets, proof bounds, exact transport policy, and a public projection that excludes nsecs and the private socket path.
- Rendered Role B with only Sound and Role A with only Sound plus non-advertised outbound-only UDP; B's peer remains Sound-addressed.
- Added the private `fips-control` volume, fixed `/run/fips/control.sock` daemon configuration, strict current-Sound snapshot join, and bounded nonce/digest attestation codec.
- Verified both local Compose roles: FIPS TUN, Sound worker, loopback browser publication, shared namespace, and private Node probe pass; the absent remote authenticated peer is explicitly `human_needed`.

## Task Commits

1. **Task 1: Generate exact A participant and B Sound-only configurations** - `38cee3c` (test), `80980ee` (feat)
2. **Task 2: Prove B isolation and local-only bridge boundaries from live runtime facts** - `e6c24fc` (test), `9acc426` (feat)

## Files Created/Modified

- `packages/bridge/src/demo-config.ts` - frozen role topology, deterministic target, and proof limits.
- `packages/bridge/src/runner.ts` - private Unix control socket and role-specific UDP rendering.
- `packages/bridge/src/isolation-attestation.ts` - nonce, replay, rate, digest, and UDP responder boundaries.
- `compose.fips.yml` - internal read-only bridge control-socket mount with no host publication.
- `scripts/fips-compose-smoke.mjs` - fixed in-container control-client probe and strict Sound snapshot checker.
- `tests/fips-compose.test.mjs` - private-volume and hostile topology mutation coverage.

## Decisions Made

- The FIPS control path is fixed to `/run/fips/control.sock` privately in generated config; it is never part of the browser/public config projection.
- A local Compose run is honest `human_needed` when its configured remote peer is not physically connected, while retaining a strict function for the complete current peer/link/transport join.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pulled forward the private control-socket prerequisite**
- **Found during:** Task 2
- **Issue:** Plan 04-01 supplied the client, but Compose did not make `/run/fips/control.sock` available to the bridge namespace.
- **Fix:** Added the fixed private control path, explicit daemon control config, and a named `/run/fips` volume mounted read-only in bridge and read/write in FIPS.
- **Files modified:** `packages/bridge/src/demo-config.ts`, `packages/bridge/src/runner.ts`, `compose.fips.yml`, `scripts/check-compose.mjs`
- **Verification:** Focused config/runner, Compose, source-check, TypeScript, and both role smoke commands pass.
- **Committed in:** `9acc426`

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** Necessary dependency-order correction only; it adds no TCP listener, host mount, host port, browser route, or control binary.

## Issues Encountered

- One-laptop Compose smoke cannot authenticate the remote Sound peer; the probe correctly emits `human_needed` instead of treating local worker-up as peer readiness.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04-03 can construct the controller and responder with the private control client. The exact two-laptop Sound peer/link association and successful kernel ping remain physical acceptance gates.

## Self-Check: PASSED

- All role-policy, responder, Compose/smoke, and test files exist.
- All four TDD/task commits are present in git history.

---
*Phase: 04-prove-the-sound-only-fips-ping*
*Completed: 2026-07-24*
