---
phase: 03-negotiate-and-deliver-reliable-acoustic-packets
plan: "05"
subsystem: acoustic-link
tags: [typescript, fas1, arq, half-duplex, reassembly, heartbeat, vitest]
requires:
  - phase: 03-04
    provides: nonce-bound committed acoustic session and current-heartbeat readiness gate
provides:
  - bounded four-unit FAS1 burst/ACK half-duplex complete-packet service
  - exact-once 1357-byte opaque packet reassembly with delivery-history replay suppression
  - priority queues, bounded backpressure, and finite heartbeat degradation/recovery
affects: [03-06, 03-07, 04-establish-fips-link]
tech-stack:
  added: []
  patterns: [injected-fixture-modem, fake-clock-timers, opaque-fragment-service, generation-safe-recovery]
key-files:
  created: []
  modified:
    - apps/modem-ui/src/acoustic-session.ts
    - apps/modem-ui/src/acoustic-session.test.ts
key-decisions:
  - ACK bitmap is carried in the existing bodyless FAS1 ACK sequence field because the strict v1 envelope forbids ACK payload geometry.
  - The active session retains one outbound packet, one inbound assembly, four complete queued packets, 32 delivered IDs, three attempts, and a 30-second packet/delivery TTL.
  - A heartbeat miss makes readiness false immediately; only a current-session heartbeat returns Recovering to Ready, while repeated recovery exhaustion reaches one terminal error.
requirements-completed: [LINK-03, LINK-04, LINK-05, LINK-06, LINK-07, LINK-08, LINK-09, NEG-06]
coverage:
  - deliverable: Seven-fragment 1357-byte opaque packet delivery in both directions
    verification:
      - kind: test
        ref: tests/apps/modem-ui/src/acoustic-session.test.ts#round-trips-one-byte-identical-1357-byte-packet
        status: pass
    human_judgment: false
  - deliverable: Bounded retry, duplicate suppression, priority, backpressure, and recovery
    verification:
      - kind: test
        ref: tests/apps/modem-ui/src/acoustic-session.test.ts
        status: pass
    human_judgment: false
metrics:
  duration: "~6 minutes"
  completed: 2026-07-24
  tasks_completed: 2
  files_modified: 2
status: complete
---

# Phase 3 Plan 5: Reliable Acoustic Packet Service Summary

FAS1 now carries opaque FIPS-sized packets in deterministic four-unit half-duplex bursts with exactly-once delivery, bounded queues/reassembly/retries, fixed class priority, and finite heartbeat recovery.

## Tasks Completed

1. **Round-trip 1357-byte packets exactly once under loss**
   - Added 217-byte FAS1 fragmentation, a maximum four-DATA-unit burst, TURN_END, ACK bitmap handling, retry timeout, and one inbound packet assembly.
   - Retains copied fragments only, rejects incompatible concurrent assembly input, expires stale packet work, and keeps a bounded 32-ID delivery history.
   - Proved bidirectional seven-fragment byte-identical delivery plus lost-DATA, lost-ACK, and duplicate replay behavior with an injected fixture modem and fake timers.
   - Commit: `cf02b9d`.

2. **Bound priority, backpressure, heartbeat, and recovery**
   - Added stable `control → heartbeat → ordinary` complete-packet priority queues with FIFO preservation per class and four-packet/byte accounting before retention.
   - Added visible safe counters and finite `Ready → Degraded → Recovering → Ready/Error` handling; repeated missed-heartbeat reports are idempotent and terminal recovery clears queued/active work.
   - Commit: `53c6445`.

## Verification

- `vitest run apps/modem-ui/src/acoustic-session.test.ts -t "packet|fragment|reassembly|retry|duplicate|turn"` — passed (5 selected tests).
- `vitest run apps/modem-ui/src/acoustic-session.test.ts -t "priority|backpressure|heartbeat|degraded|recovery|concurrency"` — passed (3 selected tests).
- `vitest run apps/modem-ui/src/acoustic-session.test.ts` — passed (14 tests).
- `npm run typecheck` — passed under Node 22.
- `git diff --check` and plan-owned TODO/FIXME/placeholder scan — passed.

## Decisions Made

- Only FAS1 headers and source-authored local traffic class influence scheduling; opaque FIPS packet bytes are never inspected.
- `onFinish` remains outside remote delivery authority: only a remote ACK changes the local delivery/turn state.
- Fixture modem evidence is deterministic integration evidence only and remains classified as `Fixture`, never `Open air`.

## Deviations from Plan

None - plan executed exactly as written. The existing FAS1 ACK envelope is bodyless, so its already-validated sequence field carries the compact bitmap without widening protocol geometry or adding a dependency.

## Known Stubs

None. The fake modem/clock are intentional deterministic Fixture seams and do not stand in for physical acoustic qualification.

## Self-Check: PASSED

- Confirmed both plan-owned source/test files exist and contain no stub markers.
- Confirmed task commits `cf02b9d` and `53c6445` exist in git history.
- Re-ran the focused reliability, focused health, full session, and strict TypeScript checks after the final task commit.

## Next Phase Readiness

- Ready for the remaining Phase 3 browser adapter/readiness integration plans.
- Phase 1's exact two-laptop Open-air verification remains deferred and unchanged.
