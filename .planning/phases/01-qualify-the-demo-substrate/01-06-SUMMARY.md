---
phase: 01-qualify-the-demo-substrate
plan: 06
subsystem: infrastructure
tags: [docker, compose, tun, ipv6, least-privilege, evidence]
requires:
  - phase: 01-04
    provides: Canonical machine-evidence conventions and report validation patterns
provides:
  - Pinned least-privilege Docker/TUN preflight topology
  - Fail-closed static and inspect authority checks emitting TunEvidence
  - Owned fake-testable fips-preflight0 lifecycle and exact-host runbook
affects: [01-07, docker, fips-integration]
tech-stack:
  added: []
  patterns:
    - Static, inspect, and lifecycle evidence use one fixed-shape TunEvidence record.
    - TUN lifecycle owns only an interface created by the current invocation.
key-files:
  created:
    - compose.preflight.yml
    - docker/preflight.Dockerfile
    - scripts/check-compose.mjs
    - scripts/preflight-tun.sh
    - docs/qualification-runbook.md
  modified:
    - packages/bridge/src/report.ts
    - tests/tun-preflight.test.ts
key-decisions:
  - "Use network_mode: none and no published ports for the standalone preflight so it cannot create an alternate path."
  - "Treat Docker Compose's omitted false values as a source-plus-inspect concern: source requires privileged: false and inspect proves the effective value."
patterns-established:
  - "TunEvidence source distinguishes deterministic static/fake results from future exact-host evidence."
requirements-completed: [DEPLOY-02]
coverage:
  - id: D1
    description: Pinned Compose topology rejects missing or broader Docker authority deterministically.
    requirement: DEPLOY-02
    verification:
      - kind: unit
        ref: tests/tun-preflight.test.ts#least-privilege Docker/TUN preflight
        status: pass
      - kind: other
        ref: npm run test:compose
        status: pass
    human_judgment: false
  - id: D2
    description: Fake-ip lifecycle proves safe create/configure/evidence/owned-cleanup behavior without Docker or a real TUN.
    requirement: DEPLOY-02
    verification:
      - kind: unit
        ref: tests/tun-preflight.test.ts#owned fake TUN lifecycle
        status: pass
    human_judgment: false
  - id: D3
    description: Exact Docker Desktop/Linux Engine TUN evidence is prepared but still needs execution on both demo laptops.
    requirement: DEPLOY-02
    verification: []
    human_judgment: true
    rationale: Docker/TUN device exposure and cleanup must be observed on the exact physical hosts in Plan 01-07.
duration: 8min
completed: 2026-07-23
status: complete
---

# Phase 01 Plan 06: Docker/TUN Preflight Summary

**Pinned, fail-closed Docker/TUN preflight with a fake-testable owned IPv6 interface lifecycle and exact-host evidence procedure.**

## Performance

- **Duration:** 8 min
- **Completed:** 2026-07-23
- **Tasks:** 2/2
- **Files modified:** 9

## Accomplishments

- Added a digest-pinned Alpine preflight image and Compose topology with exactly `/dev/net/tun`, `NET_ADMIN`, `no-new-privileges:true`, `privileged: false`, `network_mode: none`, and no published ports.
- Added deterministic static/rendered/inspect checking with a stable fixed-shape `TunEvidence` contract, including rejection coverage for missing or broader authority.
- Added an owned `fips-preflight0` lifecycle that refuses collisions, configures one fixed IPv6 address, captures link evidence, and cleans only an interface it created.
- Documented the exact Docker Desktop/Linux Engine capture procedure while preserving Plan 01-07 as the only physical-host qualification gate.

## Task Commits

1. **Task 1: Render Compose through the security checker into TunEvidence** - `f900a57` (test), `4e93381` (feat)
2. **Task 2: Prove the owned TUN lifecycle and document exact-host capture** - `2f1acef` (test), `5bf96fd` (feat)

## Files Created/Modified

- `compose.preflight.yml` - Isolated, least-privilege TUN preflight service.
- `docker/preflight.Dockerfile` - Digest-pinned Alpine image with `iproute2` and lifecycle entry point.
- `scripts/check-compose.mjs` - Source, rendered Compose, and Docker inspect validation that emits canonical evidence.
- `scripts/preflight-tun.sh` - Strict owned interface create/configure/evidence/cleanup lifecycle.
- `packages/bridge/src/report.ts` - Canonical `TunEvidence` types and fail-closed validation.
- `tests/tun-preflight.test.ts` - Static authority and fake lifecycle coverage.
- `docs/qualification-runbook.md` - Exact two-host Docker/TUN evidence procedure.

## Decisions Made

- The standalone preflight uses Docker's `none` network mode and publishes no ports, eliminating an alternate communication path during TUN qualification.
- The raw Compose source explicitly declares `privileged: false`; because rendered Compose JSON omits false defaults, the checker separately validates that source fact and the actual Docker inspect value.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Contract] Added the canonical TunEvidence contract to the report module**
- **Found during:** Task 1
- **Issue:** The plan required `TunEvidence` from `packages/bridge/src/report.ts`, but the existing canonical report module had no such symbol.
- **Fix:** Added a minimal fixed-shape exported contract and validator for static, inspect, lifecycle, and exact-host evidence without changing machine-report or selection semantics.
- **Files modified:** `packages/bridge/src/report.ts`, `packages/bridge/test/report.test.ts`
- **Automated Checks:** Focused report and preflight tests, plus `npm run check`
- **Committed in:** `4e93381`

**2. [Rule 1 - Bug] Accounted for Compose's omitted false defaults in rendered JSON**
- **Found during:** Task 2
- **Issue:** `docker compose config --format json` omits `privileged: false`, causing a correct rendered topology to fail even though the source declaration and runtime inspect remain mandatory.
- **Fix:** Required explicit false in source, normalized the rendered Docker default only there, and retained inspect validation for the effective runtime value.
- **Files modified:** `scripts/check-compose.mjs`, `docs/qualification-runbook.md`
- **Automated Checks:** Rendered Compose piped through the checker; `npm run check`
- **Committed in:** `5bf96fd`

**Total deviations:** 2 auto-fixed (1 missing contract, 1 bug). Both preserve the specified least-privilege and evidence boundaries.

## Automated Checks

- `npm run test:compose` — passed.
- `npm run test:unit -- tests/tun-preflight.test.ts` — passed (6 tests).
- `docker compose -f compose.preflight.yml config --format json | node scripts/check-compose.mjs --compose-json /dev/stdin` — passed.
- `npm run check` — passed (44 unit tests, 5 browser tests, build, corpus, fixture, and Compose checks).

## Issues Encountered

Docker Compose intentionally omits explicit false defaults from rendered JSON. The evidence procedure retains the source declaration and validates Docker's effective inspect value instead of relaxing authority checks.

## User Setup Required

None for deterministic checks. Plan 01-07 requires a Docker-capable exact demo host and `/dev/net/tun` exposure; follow `docs/qualification-runbook.md` on both laptops.

## Next Phase Readiness

Plan 01-07 can collect static, inspect, and lifecycle `TunEvidence` records from both laptops. No actual Docker/TUN execution or physical qualification is claimed by this plan.

## Self-Check: PASSED

Confirmed the Compose topology, image, check script, lifecycle script, runbook, canonical report contract, and fake lifecycle tests exist. Confirmed task commits `f900a57`, `4e93381`, `2f1acef`, and `5bf96fd` exist in git history.
