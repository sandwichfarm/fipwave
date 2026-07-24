---
phase: 02-configure-and-establish-the-codec-neutral-fips-bridge
plan: 02
subsystem: fips-integration
tags: [rust, cargo, fips, vendoring, provenance, tokio-tungstenite]
requires:
  - phase: 01-qualify-the-demo-substrate
    provides: audited dependency and immutable-lockfile conventions
provides:
  - MIT-licensed FIPS source snapshot pinned to fc8ebd5a06d6f042c57f03107f403116365a16b4
  - Pre-patch checksums, import instructions, and explicit local patch inventory
  - Locked direct tokio-tungstenite 0.30.0 dependency for the future local sound transport
affects: [02-05, 02-07, FIPS sound transport, Docker build]
tech-stack:
  added: [tokio-tungstenite 0.30.0]
  patterns: [immutable vendored source snapshot, pre-patch checksum provenance, locked Cargo dependency resolution]
key-files:
  created: [vendor/fips/UPSTREAM.md, vendor/fips/]
  modified: [vendor/fips/Cargo.toml, vendor/fips/Cargo.lock]
key-decisions:
  - "Vendor the exact GitHub commit archive without upstream Git history or mutable build-time fetches."
  - "Add only the audited exact tokio-tungstenite 0.30.0 direct dependency and reuse upstream Tokio/futures."
patterns-established:
  - "Every vendor patch is enumerated in UPSTREAM.md beside the immutable commit, tree ID, toolchain, license, and pre-patch checksums."
requirements-completed: [FIPS-01]
coverage:
  - id: D1
    description: Immutable MIT-licensed FIPS source snapshot and audited locked dependency graph
    requirement: FIPS-01
    verification:
      - kind: integration
        ref: cd vendor/fips && cargo metadata --locked --format-version 1
        status: pass
      - kind: integration
        ref: cd vendor/fips && cargo test --locked
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-07-24
status: complete
---

# Phase 02 Plan 02: Provenance-locked FIPS source import Summary

**A complete MIT-licensed FIPS source snapshot is pinned to fc8ebd5 with an auditable Rust 1.94.1 build base and locked local WebSocket dependency.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-24T01:21:19Z
- **Completed:** 2026-07-24T01:25:34Z
- **Tasks:** 1
- **Files modified:** 674

## Accomplishments

- Imported the exact upstream FIPS source tree without Git history while retaining its MIT license and Rust 1.94.1 toolchain.
- Recorded immutable commit/tree identifiers, source date, pre-patch checksums, import procedure, and complete local patch inventory in `UPSTREAM.md`.
- Added only the audit-approved exact `tokio-tungstenite = "=0.30.0"` direct dependency and committed its Cargo lock resolution.
- Compiled the pre-patch target and passed the complete locked upstream test suite before any sound transport behavior is introduced.

## Task Commits

1. **Task 1: Import and provenance-lock the exact FIPS fork** - `3565d09` (chore)

## Files Created/Modified

- `vendor/fips/` - Complete normal source snapshot from the immutable upstream commit.
- `vendor/fips/UPSTREAM.md` - Reproducible import, identity checksums, license/toolchain, and local patch record.
- `vendor/fips/Cargo.toml` - Exact audited direct WebSocket dependency.
- `vendor/fips/Cargo.lock` - Locked direct and transitive dependency resolution.

## Decisions Made

- Kept the snapshot self-contained so ordinary builds never fetch mutable upstream source.
- Preserved an upstream transitive `tokio-tungstenite` version where required while directly pinning the approved 0.30.0 version for the future sound transport; no second async runtime was introduced.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Issues Encountered

None.

## User Setup Required

None - the pinned Rust 1.94.1 toolchain was already installed.

## Next Phase Readiness

- Plan 02-07 can add the first-class sound transport against a stable, licensed, checked vendor base.
- Compose work can build this directory with `--locked` and retain the exact source/dependency evidence.

---
*Phase: 02-configure-and-establish-the-codec-neutral-fips-bridge*
*Completed: 2026-07-24*

## Self-Check: PASSED

- The immutable source, MIT license, Rust toolchain, Cargo manifests, and provenance record exist.
- Task commit `3565d09` exists in git history.
