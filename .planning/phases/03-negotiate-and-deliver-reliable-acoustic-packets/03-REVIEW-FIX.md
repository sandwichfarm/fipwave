---
phase: 03
fixed_at: 2026-07-24T09:27:00Z
review_path: .planning/phases/03-negotiate-and-deliver-reliable-acoustic-packets/03-REVIEW.md
iteration: 5
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

## Fixed Issues

### CR-01: Browser queue rejection cannot reach the bridge or FIPS sender

**Commit:** `86b1a1f`

The browser now returns an exact one-byte, epoch- and packet-sequence-bound
admission result after `AcousticSession` accepts or rejects a FIPS packet. The
bridge keeps the FIPS-to-browser queue head owned and pending until that result
arrives from the current browser socket; stale, malformed, wrong-owner, or
wrong-sequence acknowledgements are rejected. Queue-full responses are
backpressured and retried with a bounded attempt count, while the frame remains
in the bounded packet queue and is never counted as delivered before acceptance.
Reset and browser disconnect clear pending admission state.

The bridge also projects each admission result to the local FIPS WebSocket.
The Rust sound adapter validates that control frame, records queue-full as a
transport error without injecting a peer packet, and clears it upon the matching
acceptance. Integration coverage admits four packets, rejects the fifth, proves
the delivery counter and queue remain unchanged, then accepts the bridge retry.

### CR-01 follow-up: Reset-required browser replacement receives pending work too early

**Commit:** `0fd4db2`

The bridge now binds the active browser connection to its reset requirement and
will not flush FIPS-to-browser work while that exact owner must reset. After a
successful RESET, it flushes only when the same socket still owns the bridge,
the connection is reset-clear, and the reset advanced the expected epoch.
Disconnect clears that connection binding. The integration regression leaves a
head pending, reconnects a browser, proves no pre-reset delivery or close,
completes RESET, and then admits a current-epoch packet.

### WR-01: Delayed modem playback lacks a regression test

**Commit:** `30d5f05`

A controllable deferred modem now verifies that the ARQ timer is not armed
until the final TURN_END playback settles, stale completion after reset cannot
arm a timer, and a rejected playback completion degrades the session without
emitting a retry.

## Verification

- Focused Vitest: `fips-packet-bridge.test.ts`, 15/15 passed.
- `npm run typecheck`: passed.

## Follow-up deviation

`f5b35b0` preserves the Phase 1 local-only preflight and qualification UI when
an older local runner config has no acoustic projection. A supplied acoustic
projection remains exact-schema/fail-closed, and only a valid projection may
construct or arm the acoustic/FIPS session.

`9301e58` gives the Fixture seam an ordered virtual clock: it runs only the
next due timer batch, preserving TURN_END/ACK guard sequencing and avoiding a
simultaneous heartbeat-deadline collapse. Production continues to use browser
real-time timers.

---

_Fixer: gsd-code-fixer · Iteration 5_
