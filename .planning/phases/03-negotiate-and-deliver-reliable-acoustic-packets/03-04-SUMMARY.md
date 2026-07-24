---
phase: 03-negotiate-and-deliver-reliable-acoustic-packets
plan: "04"
subsystem: acoustic-link
tags: [fas1, handshake, calibration, settings-digest, heartbeat, vitest]
requires:
  - phase: 03-03
    provides: strict FAS1 units, exact profile registry, and canonical settings digest
provides:
  - nonce-bound A-initiated peer bootstrap with reset authority
  - literal bounded A→B then B→A calibration ledgers
  - deterministic directional selection and digest/heartbeat readiness gate
affects: [03-05, 03-06, 03-07, 04-establish-fips-link]
tech-stack:
  added: []
  patterns: [injected-modem, injected-clock-and-timers, validate-before-transition, canonical-digest-commit]
key-files:
  created:
    - apps/modem-ui/src/acoustic-session.ts
    - apps/modem-ui/src/acoustic-session.test.ts
  modified: []
key-decisions:
  - Only A may emit bootstrap HELLO; both nonces, configured identities, exact profiles, ranges, epoch, and legal state bind a session.
  - Calibration accepts only fully byte-correct, non-corrupt, non-clipping measured candidates and resolves ties by timing, lower gain, payload, then ID.
  - COMMIT_ACK does not make the acoustic session ready; a matching current-session heartbeat is also required.
patterns-established:
  - A fake modem is an injected Fixture seam that forwards encoded FAS1 bytes only; it is not an inter-laptop transport.
  - Every acoustic state transition validates decoded input before session mutation and reset clears all epoch-scoped authority synchronously.
requirements-completed: [LINK-02, NEG-01, NEG-02, NEG-03, NEG-04, NEG-05]
metrics:
  duration: 11m
  completed: 2026-07-24
status: complete
---

# Phase 3 Plan 4: Acoustic Session Negotiation Summary

A deterministic, nonce-bound two-role acoustic session now measures both literal directions, agrees on canonical settings, and remains fail-closed until its current heartbeat follows digest acknowledgement.

## Accomplishments

- Added pure injected `AcousticSession`, modem, clock, and timer seams with A-only bootstrap, complementary configured identities, 128-bit nonces, epoch authority, exact executable profiles, capability intersection, and atomic reset.
- Added strict compact binary handshake, calibration probe/report, commit, acknowledgement, and heartbeat controls transported inside validated FAS1 units.
- Added four-probe-per-candidate A→B then B→A calibration ledgers preserving byte correctness, corrupt/missing/duplicate/discontinuity flags, timing, signal, clipping, and confidence facts.
- Added bounded selection that prioritizes safe byte correctness, then latency, lower gain, payload size, and stable candidate ID; no safe candidate enters one visible terminal state.
- Added canonical settings digest commitment: mismatched commits reject, and readiness stays false through COMMIT_ACK until a current-session heartbeat arrives.

## Verification

- `vitest run apps/modem-ui/src/acoustic-session.test.ts -t "bootstrap|handshake|reset"` — 6 passed.
- `vitest run apps/modem-ui/src/acoustic-session.test.ts -t "calibration|selection|commit|heartbeat"` — 5 passed.
- `vitest run apps/modem-ui/src/acoustic-session.test.ts` — 10 passed.
- `npm run typecheck` — passed under the required Node 22.23.1 prefix.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Bug] Canonicalized CAPs nonce ordering by role**
   - **Found during:** Task 1 GREEN verification.
   - **Issue:** The first implementation emitted local-then-peer nonces, which reverses meaning between roles and prevented the synchronous fixture from reaching calibration.
   - **Fix:** Emit and validate CAPs in canonical A-nonce then B-nonce order.
   - **Files modified:** `apps/modem-ui/src/acoustic-session.ts`
   - **Commit:** `65a48d9`

2. **[Rule 2 - Critical validation] Restricted discovery to executable modem profiles**
   - **Found during:** Task 2 edge-truth audit.
   - **Issue:** Candidate profiles were validated, but a synthetic discovery profile could still enter a HELLO payload.
   - **Fix:** Resolve every advertised discovery profile against the exact executable registry before session construction.
   - **Files modified:** `apps/modem-ui/src/acoustic-session.ts`, `apps/modem-ui/src/acoustic-session.test.ts`
   - **Commit:** `a0ee0ba`

## Known Stubs

None. The fake modem is an intentional deterministic Fixture seam, explicitly limited to in-process encoded FAS1 delivery and never represented as physical Open-air evidence.

## Self-Check: PASSED

- Confirmed both session source/test files exist.
- Confirmed all five task commits exist.
- Confirmed no `TODO`, `FIXME`, or placeholder markers in plan-owned source/test files.
