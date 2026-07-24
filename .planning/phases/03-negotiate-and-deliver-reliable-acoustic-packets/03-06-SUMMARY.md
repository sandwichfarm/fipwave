---
phase: 03-negotiate-and-deliver-reliable-acoustic-packets
plan: "06"
subsystem: bridge-and-sound-readiness
tags: [typescript, rust, fwav, websocket, readiness, fips]
requires:
  - phase: 03-04
    provides: committed acoustic settings and current-heartbeat readiness semantics
  - phase: 03-05
    provides: bounded acoustic delivery and terminal degradation behavior
provides:
  - current-epoch acoustic readiness and disarm bridge controls
  - local-audio preflight separated from FIPS packet authority
  - fail-closed Rust SoundTransport readiness projection
affects: [03-07, 04-establish-fips-link, 05-demo-operator-experience]
tech-stack:
  added: []
  patterns: [current-epoch-readiness-projection, disarm-before-cleanup, codec-neutral-packet-gate]
key-files:
  created: []
  modified:
    - packages/bridge/src/protocol.ts
    - packages/bridge/src/server.ts
    - packages/bridge/test/fips-packet-bridge.test.ts
    - vendor/fips/src/transport/sound/mod.rs
key-decisions:
  - AUDIO_SETTINGS is a local preflight fact and can never emit BROWSER_ARM.
  - Only a zero-payload, zero-sequence ACOUSTIC_READY for the current epoch projects BROWSER_ARM to Rust.
  - Reset, explicit acoustic disarm, browser disconnect, and terminal browser errors disarm before queue or readiness cleanup.
  - Rust retains browser_ready as its narrow codec-neutral field but only bridge-projected control frames can mutate it.
requirements-completed: [LINK-02, LINK-09, NEG-05, NEG-06]
coverage:
  - deliverable: Current committed acoustic readiness is the only FIPS arm path
    verification:
      - kind: test
        ref: packages/bridge/test/fips-packet-bridge.test.ts
        status: pass
    human_judgment: false
  - deliverable: Rust worker rejects direct/preflight readiness and permits only current bridge projection
    verification:
      - kind: test
        ref: vendor/fips/src/transport/sound/mod.rs#sound_transport_readiness_requires_bridge_acoustic_projection
        status: pass
    human_judgment: false
metrics:
  duration: "~18 minutes"
  completed: 2026-07-24
  tasks_completed: 2
  files_modified: 4
status: complete
---

# Phase 3 Plan 6: Acoustic Readiness Projection Summary

Committed current-epoch acoustic readiness, rather than local browser audio, is now the sole authority that can arm complete FIPS packet traffic.

## Tasks Completed

1. **Make the bridge project acoustic session readiness only**
   - Added strict FWAV `ACOUSTIC_READY` and `ACOUSTIC_DISARM` controls with zero payload, zero sequence, current-epoch, and browser-owner validation.
   - Kept `AUDIO_SETTINGS` local-only and added safe scalar status for audio preflight and acoustic-session readiness.
   - Disarms the FIPS endpoint exactly once before queue/readiness cleanup on explicit disarm, reset, browser close, and terminal browser errors.
   - Commits: `986e843`, `ffffb57`.

2. **Enforce current acoustic readiness inside SoundTransport**
   - Direct local arming is rejected; only a validated current-epoch bridge control can change the codec-neutral packet gate.
   - Confirmed preflight/unknown frames, stale controls, reset, and disarm fail closed for both FIPS packet injection and outgoing sends.
   - Added distinct safe worker-up and acoustic-ready status fields while retaining opaque complete packets and TrafficClass behavior.
   - Commit: `375b23b`.

## Verification

- Node 22 `vitest run packages/bridge/test/fips-packet-bridge.test.ts` — 13 passed.
- Node 22 `npm run typecheck` — passed.
- `cargo test sound_transport_readiness --locked` — 2 passed.
- `cargo test sound_transport_traffic_class --locked` — 2 passed.
- `cargo fmt --check` and `git diff --check` — passed.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 2 - Critical readiness authority] Rejected direct SoundTransport arming**
   - **Found during:** Task 2 readiness boundary audit.
   - **Issue:** A public direct arming method could bypass the validated bridge projection and make a local caller appear acoustically ready.
   - **Fix:** The method now rejects; only validated bridge control frames can mutate the narrow readiness field.
   - **Files modified:** `vendor/fips/src/transport/sound/mod.rs`
   - **Verification:** Focused readiness tests prove direct arming and AUDIO_SETTINGS reject, while current bridge arm permits both send and injection.
   - **Commit:** `375b23b`.

**Total deviations:** 1 auto-fixed (Rule 2). **Impact:** Removes a direct readiness bypass without introducing codec, packet, or network coupling.

## Known Stubs

None. All readiness facts originate from validated local control frames; Fixture and Loopback evidence remain distinct from Open-air qualification.

## Self-Check: PASSED

- Confirmed all four plan-owned source/test files exist.
- Confirmed task commits `986e843`, `ffffb57`, and `375b23b` exist.
- Re-ran bridge, TypeScript, Rust readiness, Rust TrafficClass, format, and diff checks after the implementation commits.

## Next Phase Readiness

- Ready for browser-session adapter wiring and Phase 4 FIPS link establishment.
- Phase 1 exact two-laptop Open-air verification remains deferred and unchanged.
