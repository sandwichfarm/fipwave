---
phase: 02-configure-and-establish-the-codec-neutral-fips-bridge
plan: "07"
subsystem: fips-transport
tags: [rust, fips, websocket, transport, mtu, sound]
requires:
  - phase: 02-01
    provides: FWAV complete-packet envelope contract
  - phase: 02-02
    provides: provenance-locked FIPS fork and audited WebSocket dependency
provides:
  - strict codec-neutral SoundConfig and bounded local WebSocket worker
  - exhaustive TransportHandle::Sound lifecycle, policy, MTU, congestion, and statistics delegation
  - normal node construction with 1357 link MTU and 1280 effective IPv6 MTU before peer establishment
affects: [bridge, fips, phase-03, demo-runner]
tech-stack:
  added: []
  patterns: [complete-packet ReceivedPacket injection, fail-closed browser arming, static connectionless peer policy]
key-files:
  created: [vendor/fips/src/transport/sound/mod.rs]
  modified: [vendor/fips/src/config/transport.rs, vendor/fips/src/config/mod.rs, vendor/fips/src/transport/mod.rs, vendor/fips/src/node/mod.rs]
key-decisions:
  - "Sound exposes only a local loopback WebSocket endpoint, static peer identity, MTU, and queue bounds in FIPS configuration."
  - "Worker lifecycle Up is intentionally independent of browser arming and cannot authorize packet send or receive injection."
patterns-established:
  - "Every concrete FIPS transport capability is represented by an explicit TransportHandle match arm."
  - "Control visibility is derived from allowlisted transport statistics, never endpoint URLs or packet bytes."
requirements-completed: [FIPS-01, FIPS-02, FIPS-03, CODEC-01]
coverage:
  - id: D1
    description: "Bounded codec-neutral SoundTransport lifecycle, opaque packet send, and ReceivedPacket injection."
    requirement: FIPS-01
    verification:
      - kind: integration
        ref: "vendor/fips/src/transport/sound/mod.rs#sound_worker_round_trips_an_opaque_1357_byte_packet_over_loopback_websocket"
        status: pass
    human_judgment: false
  - id: D2
    description: "Sound is constructed through normal FIPS aggregation with the required pre-operational MTU."
    requirement: FIPS-02
    verification:
      - kind: unit
        ref: "vendor/fips/src/node/mod.rs#configured_sound_constructs_and_sets_preoperational_ipv6_mtu"
        status: pass
    human_judgment: false
  - id: D3
    description: "All transport dispatch capabilities use explicit static and connectionless sound policy with safe statistics."
    requirement: FIPS-03
    verification:
      - kind: unit
        ref: "vendor/fips/src/transport/sound/mod.rs#sound_handle_exposes_all_connectionless_capabilities"
        status: pass
    human_judgment: false
  - id: D4
    description: "FIPS packet envelope remains complete-packet, binary, current-epoch, and fail-closed while unarmed."
    requirement: CODEC-01
    verification:
      - kind: unit
        ref: "vendor/fips/src/transport/sound/mod.rs#sound_injects_only_current_epoch_armed_packets_and_reset_invalidates_old_work"
        status: pass
    human_judgment: false
metrics:
  duration: 11min
  completed: 2026-07-24
status: complete
---

# Phase 02 Plan 07: First-Class FIPS Sound Transport Summary

**The provenance-locked FIPS fork now carries complete opaque packets through a bounded loopback WebSocket SoundTransport with honest MTU, lifecycle, and control-state behavior.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-07-24T01:43:00Z
- **Completed:** 2026-07-24T01:54:26Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments

- Added strict SoundConfig validation that accepts only loopback bridge endpoints, static sound peers, 1357-byte-or-larger MTUs, and bounded queues.
- Added a WebSocket-owned SoundTransport that validates FWAV binary packets, injects only `ReceivedPacket`s, fails closed until current-epoch arming, and invalidates stale work after RESET.
- Integrated all 13 COVERAGE.md transport capabilities via explicit `TransportHandle::Sound` dispatch and node construction; control output inherits safe scalar statistics without URLs or packet bytes.

## Task Commits

1. **Task 1: Run one complete opaque packet through SoundTransport**
   - `85a61d7` test: strict sound configuration coverage
   - `e93989e` feat: bounded sound transport core
2. **Task 2: Complete every FIPS transport dispatch, construction, MTU and control seam**
   - `0ae3e8c` test: node construction and pre-operational MTU coverage
   - `56091eb` feat: node lifecycle and exhaustive transport integration
   - `3cb12ff` test: live loopback WebSocket lifecycle coverage

## Files Created/Modified

- `vendor/fips/src/config/transport.rs` — strict, codec-neutral SoundConfig with 1357-byte minimum.
- `vendor/fips/src/config/mod.rs` — re-exports and validates sound configuration in the normal Config path.
- `vendor/fips/src/transport/sound/mod.rs` — bounded WebSocket worker, FWAV validation, packet injection, reset generation, and tests.
- `vendor/fips/src/transport/mod.rs` — explicit Sound variant for every transport capability.
- `vendor/fips/src/node/mod.rs` — normal Sound construction and honest pre-operational MTU selection.

## Decisions Made

- The configured sound peer is static and connectionless: there is no ambient discovery and arbitrary addresses are rejected.
- A connected local worker remains operationally distinct from a browser arm, acoustic peer, authenticated FIPS link, or ping result.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the live fixture’s moved packet buffer**
- **Found during:** Task 2 lifecycle test compilation
- **Issue:** The fixture closure consumed the packet vector that the sender assertion still needed.
- **Fix:** Gave the fixture an owned clone, retaining the original vector for the send and receive assertions.
- **Files modified:** `vendor/fips/src/transport/sound/mod.rs`
- **Verification:** `cargo test sound_worker_round_trips --locked` passed.
- **Committed in:** `3cb12ff`

**Total deviations:** 1 auto-fixed (Rule 1)

## Issues Encountered

The Context7 CLI was unavailable, so API usage was verified against the already locked local dependency graph and exercised through a real `tokio-tungstenite` loopback fixture.

## User Setup Required

None - no dependency, secret, or external service change was introduced.

## Next Phase Readiness

The sound transport is available as a normal FIPS transport with a complete-packet boundary. Browser arming remains fail-closed and cannot create a false peer or acoustic-ready claim.

## Self-Check: PASSED

- Confirmed all five modified FIPS transport artifacts and this summary exist.
- Confirmed every TDD/task commit is present in Git history.
