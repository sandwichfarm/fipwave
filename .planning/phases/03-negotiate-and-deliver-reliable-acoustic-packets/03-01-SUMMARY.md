---
phase: 03-negotiate-and-deliver-reliable-acoustic-packets
plan: "01"
subsystem: fips-transport
tags: [rust, fips, sound, fwav, traffic-class]
requires:
  - phase: 02-bridge-complete-opaque-fips-packets
    provides: codec-neutral SoundTransport and FWAV complete-packet bridge
provides:
  - Source-authored `TrafficClass` metadata with an `Ordinary` compatibility default
  - Explicit control and heartbeat producer paths into the Sound FWAV header
  - Sound validation that rejects unknown class metadata before delivery
affects: [03-02, acoustic-scheduler, sound-bridge]
tech-stack:
  added: []
  patterns: [typed-source-metadata, opaque-packet-boundary, fail-closed-fwav]
key-files:
  created: []
  modified:
    - vendor/fips/src/transport/mod.rs
    - vendor/fips/src/transport/sound/mod.rs
    - vendor/fips/src/node/handlers/handshake.rs
    - vendor/fips/src/node/handlers/mmp.rs
    - vendor/fips/src/node/handlers/rekey.rs
    - vendor/fips/src/node/mod.rs
decisions:
  - Traffic class originates at the semantic FIPS caller and is never inferred from opaque packet bytes.
  - FWAV byte 6 is the validated local traffic-class discriminant; byte 7 and the remaining reserved bytes stay canonical zero.
  - Existing byte-only send APIs explicitly delegate to TrafficClass::Ordinary.
metrics:
  duration: "~35 minutes"
  completed: 2026-07-24
  tasks_completed: 2
  files_modified: 9
status: complete
---

# Phase 3 Plan 1: Typed FIPS Traffic-Class Trace Summary

Semantic FIPS control, rekey, heartbeat, and ordinary sends now reach Sound as validated FWAV metadata while their packet bytes remain opaque and unchanged.

## Tasks Completed

1. **Trace one classified liveness packet into Sound FWAV**
   - Added `TrafficClass::{Control, Heartbeat, Ordinary}` and `TransportHandle::send_classified`.
   - Kept `TransportHandle::send` source-compatible by delegating to `Ordinary`.
   - Added the focused Sound fixture asserting class metadata and byte-identical opaque payloads, plus a non-Sound compatibility test.
   - Commits: `15d3bf0`, `3e6b915`.

2. **Classify every liveness and ordinary producer explicitly**
   - Marked handshake/retry/rekey producers as `Control` and the actual MMP heartbeat producer as `Heartbeat`.
   - Added a narrow classified encrypted-link helper whose legacy callers remain explicitly `Ordinary`.
   - Added table-driven Sound class coverage and rejection of unknown FWAV class metadata before queue/delivery mutation.
   - Commit: `2f3df14`.

## Verification

- `cd vendor/fips && cargo fmt --check` — passed.
- `cd vendor/fips && cargo test sound_transport_traffic_class --locked` — passed (2 focused tests).
- `cd vendor/fips && cargo test transport --locked` — passed (261 passed, 1 ignored).
- Source trace inspection confirms explicit `Control` at lifecycle, handshake, timeout, peer-action, and rekey sends; MMP heartbeat uses `Heartbeat`; ordinary encrypted-link callers use the compatibility default.
- `git diff --check` — passed.

## Decisions Made

- Local scheduling metadata is an enum chosen before encryption or transport emission, never a classification of FIPS payload content.
- Unknown FWAV traffic-class discriminants fail closed before delivery state, counters, or sequence tracking advance.
- Non-Sound transports accept classified dispatch through their existing byte-only implementations, preserving compatibility.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 3 - Blocking source-trace omission] Classified the real heartbeat and rekey semantic producers**
   - **Found during:** Task 2.
   - **Issue:** The plan's declared caller list named `lifecycle/mod.rs` as a heartbeat source, but that file only emits handshake msg1. The actual heartbeat emitter is `handlers/mmp.rs`, the actual rekey sends are in `handlers/rekey.rs`, and the narrow encrypted-link helper lives in `node/mod.rs`.
   - **Fix:** Added only those three semantic-source files and a classified helper; all legacy encrypted-link callers retain the explicit ordinary default.
   - **Files modified:** `vendor/fips/src/node/handlers/mmp.rs`, `vendor/fips/src/node/handlers/rekey.rs`, `vendor/fips/src/node/mod.rs`.
   - **Verification:** Focused traffic-class tests and complete transport test suite pass; no payload parser was introduced.
   - **Commit:** `2f3df14`.

**Total deviations:** 1 auto-fixed (Rule 3). **Impact:** Corrects the planned source trace so LINK-08 uses actual heartbeat/rekey semantics rather than a false lifecycle annotation.

## Known Stubs

None. This plan adds no placeholder values or mock delivery path.

## Self-Check: PASSED

- All nine modified source files exist.
- Task commits `15d3bf0`, `3e6b915`, and `2f3df14` exist in git history.
- The focused Sound fixture covers all three supported classes, opaque payload identity, the legacy ordinary default, and fail-closed unknown metadata.
