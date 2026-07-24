---
phase: 02-configure-and-establish-the-codec-neutral-fips-bridge
plan: "05"
subsystem: compose
tags: [docker, compose, fips, bridge, isolation]
requires:
  - phase: 02-07
    provides: vendored FIPS SoundTransport image input
  - phase: 02-04
    provides: bounded local bridge endpoint
provides:
  - loopback-only shared-namespace Compose topology
  - mutation-tested source/rendered topology gate
  - owned Compose smoke cleanup and inspect assertions
affects: [demo-launch, phase-03]
tech-stack:
  added: []
  patterns: [service-network-namespace, exact-capability-inspection, owned-compose-project]
key-files:
  created: [compose.fips.yml, Dockerfile.bridge, vendor/fips/Dockerfile, scripts/fips-compose-smoke.mjs, tests/fips-compose.test.mjs, .dockerignore, vendor/fips/.dockerignore]
  modified: [scripts/check-compose.mjs, package.json]
key-decisions:
  - "FIPS shares only the bridge service network namespace and never publishes its packet endpoint."
  - "Compose smoke evidence is explicitly Loopback-only and cleans up only its unique project."
  - "The browser runner stays bound to container loopback; an in-container forwarder makes its loopback-only host publication reachable on Docker Desktop."
requirements-completed: [FIPS-01, FIPS-02, FIPS-03, WEB-05, CONFIG-02]
coverage:
  - id: D1
    description: "Compose source and rendered topology enforce loopback browser publication and exact FIPS privilege."
    requirement: CONFIG-02
    verification:
      - kind: unit
        ref: "tests/fips-compose.test.mjs"
        status: pass
      - kind: other
        ref: "docker compose -f compose.fips.yml config --quiet"
        status: pass
    human_judgment: false
  - id: D2
    description: "Owned runtime build/up/inspect/down smoke for the local bridge/FIPS pair."
    requirement: FIPS-01
    verification:
      - kind: integration
        ref: "scripts/fips-compose-smoke.mjs"
        status: pass
    human_judgment: false
    rationale: "Role-A smoke built both images, asserted the shared namespace and exact privilege surface, reached browser readiness through 127.0.0.1:4310, and removed its unique Compose project."
metrics:
  duration: 22min
  completed: 2026-07-24
status: complete
---

# Phase 02 Plan 05: Local FIPS Compose Isolation Summary

**A mutation-tested Compose boundary now publishes only the browser origin on host loopback while FIPS shares the bridge network namespace with exactly TUN and NET_ADMIN.**

## Accomplishments

- Added pinned Node 22.23.1 bridge and Rust 1.94.1 vendored-FIPS image definitions with the native FIPS build/runtime dependencies.
- Added source/rendered topology assertions for namespace, port, TUN, capability, privilege, and host-network mutations.
- Added an owned Loopback-only Compose smoke with unique project names, argument-array subprocesses, inspect checks, browser readiness, and guaranteed project cleanup.
- Trimmed both Docker contexts to required inputs while retaining the verified runtime codec assets.

## Task Commits

1. **Task 1: Define and mutation-test the shared-namespace Compose boundary**
   - `faa470d` test: topology mutation coverage
   - `3bfce25` feat: Compose isolation boundary
2. **Task 2: Build, inspect and exercise the owned local FIPS/bridge pair**
   - `071be7e` test: owned smoke inspect coverage
   - `2c0b7aa` feat: owned Compose smoke
   - `0ee49e9` fix: enforce readiness timeout and package bridge dependencies
   - `779cc9b` fix: exclude generated Docker build outputs
   - `d17bcf0`, `ce40d0e` fix: provide FIPS native image dependencies
   - `36999b3`, `1cf4440` fix: package runner inputs and writable qualification output
   - `1be8a51`, `b6302e7`, `a63a11e` fix: normalize Docker runtime inspection, role values, and internal port forwarding

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected expected Compose port mapping notation in the Wave 0 test**
- **Found during:** Task 1 green verification
- **Fix:** Asserted the full `host:published:target` mapping rather than omitting the container target.
- **Committed in:** `3bfce25`

**2. [Rule 2 - Missing critical functionality] Excluded generated Docker contexts while retaining required runtime inputs**
- **Found during:** Task 2 runtime build
- **Issue:** `vendor/fips/target` made the FIPS context 4.7 GB, while bridge build outputs also entered its context.
- **Fix:** Added narrow root and vendored-FIPS ignore rules, then explicitly retained the codec lock, verified codec cache, and Cyrinx binary required by the runner.
- **Committed in:** `779cc9b`, `36999b3`

**3. [Rule 3 - Blocking issue] Supplied the native FIPS image build dependencies**
- **Found during:** Task 2 runtime build
- **Issue:** Dockerized Rust compilation lacked D-Bus headers and libclang required by `libdbus-sys` and bindgen.
- **Fix:** Installed `pkg-config`, `libdbus-1-dev`, and `libclang-dev` in the build stage, plus `libdbus-1-3` in the runtime image.
- **Committed in:** `d17bcf0`, `ce40d0e`

**4. [Rule 1 - Bug] Made the browser endpoint reachable through the loopback-only publication**
- **Found during:** Task 2 runtime readiness check
- **Issue:** Docker Desktop forwards published ports to the container interface, while the production runner correctly binds its own listener to container loopback.
- **Fix:** Kept the runner on `127.0.0.1:4311` and added an in-container `socat` forwarder on port 4310; the only host publication remains `127.0.0.1:4310`.
- **Committed in:** `a63a11e`

## Known Stubs

None.

## Runtime Verification

`npm run test:fips-compose:runtime -- --role a` passed. It built both images, inspected exactly two owned containers, verified the FIPS shared namespace, exact TUN/NET_ADMIN/no-new-privileges settings, confirmed browser readiness through host loopback, and ran its `down --volumes --remove-orphans` cleanup. The evidence remains explicitly `Loopback`; it makes no Open-air, sound-worker, peer, or ping claim.

## Self-Check: PASSED

All plan files and every task commit listed above exist. No `fipwave_smoke_*` or `fipwave_debug` container remained after the final smoke cleanup.
