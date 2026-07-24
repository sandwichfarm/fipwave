---
phase: 03-negotiate-and-deliver-reliable-acoustic-packets
plan: "07"
subsystem: browser-acoustic-session
tags: [typescript, quiet, fas1, fips, readiness, playwright]
requires:
  - phase: 03-05
    provides: bounded FAS1 session, complete-packet reassembly, heartbeat recovery
  - phase: 03-06
    provides: current-epoch bridge acoustic-ready/disarm controls
provides:
  - complete-packet FIPS/session adapter with disarm-first generation invalidation
  - Quiet current-generation one-unit send/receive seam
  - exact scalar acoustic status and Fixture-labelled built-browser proof
affects: [04-establish-fips-link, 05-demo-operator-experience]
tech-stack:
  added: []
  patterns: [session-derived-readiness, local-playback-not-remote-ack, fixture-evidence-boundary]
key-files:
  created:
    - apps/modem-ui/src/acoustic-session-adapter.ts
    - apps/modem-ui/src/acoustic-status.ts
    - apps/modem-ui/e2e/acoustic-session.spec.ts
  modified:
    - apps/modem-ui/src/quiet-client.ts
    - apps/modem-ui/src/main.ts
    - apps/modem-ui/e2e/fips-packet-bridge.spec.ts
key-decisions:
  - FIPS is armed only from a session Ready snapshot, which requires matching settings commitment and current heartbeat; audio preflight alone is insufficient.
  - Quiet sendUnit resolves after local onFinish plus guard and never grants remote ACK, delivery, turn, or readiness authority.
  - The built-browser two-role modem is an in-page FAS1-only Fixture seam and is visibly distinct from Loopback or Open air evidence.
requirements-completed: [LINK-01, LINK-02, LINK-03, LINK-04, LINK-05, LINK-06, LINK-07, LINK-08, LINK-09, NEG-01, NEG-02, NEG-03, NEG-04, NEG-05, NEG-06, NEG-07]
coverage:
  - id: D1
    description: Complete opaque FIPS packets enter the session only after current committed heartbeat readiness and are copied at both boundaries.
    requirement: LINK-05
    verification:
      - kind: unit
        ref: apps/modem-ui/src/acoustic-session-adapter.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Current-generation Quiet unit lifecycle and fail-closed bridge readiness behavior.
    requirement: NEG-05
    verification:
      - kind: unit
        ref: apps/modem-ui/src/quiet-client.test.ts and packages/bridge/test/fips-packet-bridge.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Built production browser Fixture reaches two-role committed heartbeat readiness and bidirectional 1357-byte FAS1 delivery.
    requirement: LINK-03
    verification:
      - kind: automated_ui
        ref: apps/modem-ui/e2e/acoustic-session.spec.ts
        status: pass
    human_judgment: true
    rationale: Fixture-only proof intentionally cannot qualify physical Open air transport.
metrics:
  duration: "~18 minutes"
  completed: 2026-07-24
  tasks_completed: 2
  files_modified: 8
status: complete
---

# Phase 3 Plan 7: Browser Acoustic Session Integration Summary

The production browser now places the bounded acoustic session between complete opaque FIPS packets and real Quiet units, while a committed heartbeat—not microphone setup—controls FIPS readiness.

## Tasks Completed

1. **Bind complete FIPS packets to one-unit Quiet turns**
   - Added `AcousticSessionAdapter`, which maps source-authored FIPS traffic classes into the session without inspecting bytes and copies every complete handoff.
   - Added `QuietClient.sendUnit` and `onUnit`; a transmit promise means only local playback finish plus guard, while remote ACK/session state remains authoritative.
   - Invalidates/disarms before session reset or degraded recovery and rejects stale-generation callbacks.
   - Commits: `ff96a2f`, `854e0fe`.

2. **Prove truthful built-browser session behavior**
   - Added an exact scalar, bounded, secret-safe acoustic status parser/projection and displayed only honest readiness facts in the existing diagnostics UI.
   - Replaced the prior audio-preflight arm path: FIPS receives bridge `ACOUSTIC_READY` only from a current `Ready` session snapshot and is disarmed first otherwise.
   - Added a production-browser deterministic two-role FAS1-only Fixture test that proves matching commitment/current heartbeat and bidirectional 1357-byte delivery without a cross-laptop WebSocket shortcut.
   - Commits: `362688c`, `7698eb4`.

## Verification

- Node 22 `vitest run apps/modem-ui/src/acoustic-session-adapter.test.ts apps/modem-ui/src/quiet-client.test.ts apps/modem-ui/src/acoustic-status.test.ts packages/bridge/test/fips-packet-bridge.test.ts` — 21 passed.
- Node 22 `npm run typecheck` — passed.
- Node 22 `npm run build` — passed.
- Node 22 Playwright `acoustic-session.spec.ts` and `fips-packet-bridge.spec.ts` — 2 passed.
- `cargo test sound_transport_readiness --locked` and `cargo test sound_transport_traffic_class --locked` — 4 passed.
- `git diff --check` — passed.

## Decisions Made

- Local Quiet playback completion never advances remote delivery, peer turn, or FIPS readiness.
- A test-only fixture transfers only copied FAS1 units between two in-page sessions and reports `Fixture`; it cannot claim Loopback or Open air success.
- Audio preflight remains useful diagnostics but cannot arm the FIPS packet boundary.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - readiness regression] Updated the production bridge browser test**
   - **Found during:** Task 2.
   - **Issue:** The existing test asserted the now-prohibited direct packet path immediately after microphone preflight.
   - **Fix:** It now proves that preflight leaves FIPS unarmed across reset and cannot move complete packets.
   - **Files modified:** `apps/modem-ui/e2e/fips-packet-bridge.spec.ts`.
   - **Verification:** Focused production Playwright test passed.
   - **Committed in:** `362688c`.

**Total deviations:** 1 auto-fixed (Rule 1). **Impact:** Aligns the legacy browser proof with the new required fail-closed authority boundary.

## Known Stubs

None. The in-page modem is an intentional deterministic Fixture seam; physical Loopback and exact two-laptop Open air validation remain separate, explicitly classified work.

## Issues Encountered

Playwright's configured web server did not inherit the local Vite binary when invoked with only the Node 22 prefix. Adding the repository `node_modules/.bin` to `PATH` made the focused browser checks deterministic; this is a test invocation environment detail, not a shipped runtime dependency.

## Next Phase Readiness

Phase 4 can use the session-derived bridge authority for authenticated FIPS peering and kernel-level IPv6 ping validation. The Phase 1 exact two-laptop Open air verification remains deferred and unchanged.

## Self-Check: PASSED

- Confirmed all adapter, status, Quiet, main lifecycle, and browser Fixture files exist.
- Confirmed task commits `ff96a2f`, `854e0fe`, `362688c`, and `7698eb4` exist in git history.
- Re-ran focused TypeScript, browser, build, bridge, and Rust readiness checks after the final task commit.
