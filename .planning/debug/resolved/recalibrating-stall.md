---
status: resolved
trigger: "nodes can get stuck while recalibrating"
created: 2026-07-28
updated: 2026-07-28
---

# Debug Session: Recalibrating stall

## Symptoms

- Expected: after bounded recovery, both nodes either recommit settings and
  become Connected or stop with a clear terminal error/reset action.
- Actual: both Node A and Node B remain in Recalibrating / Recovering after a
  previously established Sound link.
- Errors: none visible; UI says it is waiting for the next authenticated
  acoustic message.
- Timeline: observed in the current two-node demo after Sound link established.
- Reproduction: run both demo nodes until connected, then allow heartbeat loss
  or degradation to enter acoustic recovery.

## Current Focus

- hypothesis: confirmed — beginRecovery only changes state, sends nothing, and
  schedules no deadline; recovering B also does not reply to A's heartbeat
- test: simultaneous missed-heartbeat regression plus silent-link exhaustion
- expecting: A-initiated heartbeat restores both roles; silence ends in Error
- next_action: rehearse the two-laptop recovery path
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-07-28
  observation: `beginRecovery()` only increments a counter and assigns
    `Recovering`; no modem send or timer is installed.
- timestamp: 2026-07-28
  observation: `onHeartbeat()` replies only from `AwaitingHeartbeat`, so even
    an externally supplied recovery heartbeat cannot complete A/B recovery.
- timestamp: 2026-07-28
  observation: the existing test asserted indefinite Recovering after repeated
    misses, encoding the live hang as expected behavior.

## Eliminated

## Resolution

- root_cause: Recovery was a passive state transition. Neither peer emitted a
    recovery message, no recovery timeout was armed, and B would not answer a
    recovery heartbeat.
- fix: Node A now initiates each bounded recovery attempt with an authenticated
    heartbeat; Node B sends one bound response; both restore the deterministic
    A turn owner. Each attempt receives a playback-aware deadline and three
    silent attempts terminate with `acoustic_recovery_exhausted`.
- verification: Focused acoustic-session tests pass 25/25. Full typecheck,
    unit tests (278/278), production build, and browser tests (18/18) pass.
- files_changed:
    - apps/modem-ui/src/acoustic-session.ts
    - apps/modem-ui/src/acoustic-session.test.ts
