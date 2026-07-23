---
phase: 01-qualify-the-demo-substrate
plan: 01
subsystem: infra
tags: [node, npm-registry, supply-chain, lockfile, node-test]
requires: []
provides:
  - "Node 22.23.1 runtime pin"
  - "Schema-versioned npm registry evidence for the eight approved direct packages"
  - "Pre-install audit and lockfile drift validation"
affects: [01-02, dependency-installation, supply-chain]
tech-stack:
  added: [Node.js core APIs, npm registry packuments]
  patterns: ["fixed direct-dependency allowlist with upstream repository and integrity validation", "atomic JSON audit writes"]
key-files:
  created:
    - .node-version
    - scripts/audit-dependencies.mjs
    - tests/dependency-audit.test.mjs
    - .planning/phases/01-qualify-the-demo-substrate/dependency-audit.json
  modified: []
key-decisions:
  - "Keep the direct dependency set fixed at eight approved name/version pairs and validate each package's normalized upstream repository."
  - "Require Node 22.23.1 only for registry-audit generation; keep check modes runnable under a newer host Node."
  - "Persist the canonical audit only after complete validation through a temporary-file rename."
patterns-established:
  - "Treat npm registry metadata, release timestamps, integrity values, and repository identities as a checked-in pre-install evidence artifact."
  - "Use --check-lock to reject direct package additions, omissions, version drift, and integrity drift before npm ci."
requirements-completed: [CODEC-02, CODEC-03, CODEC-04, WEB-01, WEB-02, WEB-03, WEB-07, DEPLOY-02]
coverage:
  - id: D1
    description: "Pinned Node runtime and authoritative npm dependency evidence for the Phase 1 direct dependency set."
    verification:
      - kind: unit
        ref: "tests/dependency-audit.test.mjs"
        status: pass
      - kind: integration
        ref: "node scripts/audit-dependencies.mjs --check .planning/phases/01-qualify-the-demo-substrate/dependency-audit.json"
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-07-23
status: complete
---

# Phase 01 Plan 01: Supply-chain dependency evidence Summary

**Node 22.23.1 pin plus an atomic npm registry audit that freezes and verifies the eight approved direct dependencies before installation.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-23T14:45:39Z
- **Completed:** 2026-07-23T14:49:10Z
- **Tasks:** 1/1
- **Files modified:** 4

## Accomplishments

- Pinned the qualification workspace to Node `22.23.1`.
- Added a Node-core registry auditor that captures normalized upstream repository identity, declared engines, SHA-512 integrity, release time, and fetch time for exactly eight approved packages.
- Added schema validation and lockfile conformance checks that reject missing, added, version-divergent, and integrity-divergent direct packages before `npm ci`.
- Added deterministic Node tests, including CLI-level proof that `--check-lock` rejects version and integrity drift.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pin Node and emit authoritative dependency evidence (RED)** - `6c10184` (test)
2. **Task 1: Pin Node and emit authoritative dependency evidence (GREEN)** - `edc25f7` (feat)

## Files Created/Modified

- `.node-version` - Exact runtime pin used to guard audit generation.
- `scripts/audit-dependencies.mjs` - Fetches and atomically persists registry evidence; validates audit and lockfile conformance.
- `tests/dependency-audit.test.mjs` - Covers audit metadata rejections and direct lockfile version/integrity drift, including CLI mode.
- `.planning/phases/01-qualify-the-demo-substrate/dependency-audit.json` - Canonical registry evidence for the fixed dependency set.

## Decisions Made

- Fixed the dependency set and upstream repository identities in code so similarly named packages and substitution cannot pass validation.
- Generation requires the pinned Node runtime; validation-only modes do not, allowing later CI checks on a newer host runtime.
- The audit writes via a temporary sibling file and rename only after every record passes validation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used a temporary official Node 22.23.1 runtime for audit generation**
- **Found during:** Task 1 (Pin Node and emit authoritative dependency evidence)
- **Issue:** The host runtime was Node 25.2.1, while the planned generator correctly refuses any active version other than Node 22.23.1.
- **Fix:** Downloaded and used the official Node 22.23.1 binary in a temporary directory to generate and verify the audit; no npm package was installed and no project runtime files were added beyond `.node-version`.
- **Files modified:** None beyond the planned audit output.
- **Verification:** The generated artifact passes `--check` under both Node 22.23.1 and the host Node 25.2.1; the tests pass under both runtimes.
- **Committed in:** `edc25f7` (Task 1)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The temporary runtime preserved the exact runtime guard and allowed autonomous, evidence-backed generation without installing packages.

## Issues Encountered

- The machine did not have Node 22.23.1 on its PATH. The generator's version guard prevented accidental evidence generation under Node 25.2.1, and the temporary official runtime resolved it.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-02 can invoke `node scripts/audit-dependencies.mjs --check-lock package-lock.json` before installing dependencies.
- Ensure Node 22.23.1 is active before regenerating the canonical audit.

## Self-Check: PASSED

- Confirmed all planned implementation files and the summary exist.
- Confirmed TDD commits `6c10184` and `edc25f7` exist in git history.
- Re-ran the audit validation and all five dependency-audit tests successfully.

---
*Phase: 01-qualify-the-demo-substrate*
*Completed: 2026-07-23*
