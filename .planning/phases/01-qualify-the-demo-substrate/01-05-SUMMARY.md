---
phase: 01-qualify-the-demo-substrate
plan: 05
subsystem: codec-qualification
tags: [cyrinx, quiet, websocket, fwav, browser-audio, evidence]
requires:
  - phase: 01-03
    provides: epoch-safe browser audio arm/reset and bounded PCM playback
  - phase: 01-04
    provides: FWAV v1, canonical reports, and deterministic corpus
provides:
  - codec-neutral fixture, native-command, and browser-WebSocket adapter seam
  - non-extendable Cyrinx-to-Quiet qualification state machine
  - exact-pair physical-evidence verifier and operator qualification console
affects: [phase-01, phase-02, codec-selection, fips-transport]
tech-stack:
  added: []
  patterns: [immutable-deadline, fail-closed-evidence, validated-playback-boundary]
key-files:
  created:
    - packages/bridge/src/codecs/types.ts
    - packages/bridge/src/codecs/fixture.ts
    - packages/bridge/src/codecs/command.ts
    - packages/bridge/src/codecs/websocket.ts
    - apps/modem-ui/src/qualification.ts
    - scripts/qualify.mjs
  modified:
    - packages/bridge/src/server.ts
    - apps/modem-ui/src/main.ts
    - apps/modem-ui/src/style.css
    - package.json
key-decisions:
  - "Cyrinx gets one immutable 90-minute window; expiry or any hard gate miss transitions immediately to Quiet and Quiet failure is terminal."
  - "Fixture and loopback evidence remains human_needed; only two named Open air reports can write a selection."
  - "Browser playback always validates an active-epoch PCM_PLAYBACK frame and uses the existing bounded scheduler."
metrics:
  duration: 11min
  completed: 2026-07-23
status: complete
---

# Phase 01 Plan 05: Codec Qualification Gate Summary

**The demo now has one codec-neutral qualification path that makes an evidence-backed Cyrinx, Quiet, or unqualified decision without ever treating fixture or loopback output as physical proof.**

## Accomplishments

- Primary verified artifacts include `packages/bridge/src/codecs/types.ts` and
  `packages/bridge/src/server.ts`.
- Added typed fixture, native batch-command, and browser-WebSocket codec adapters behind one bounded result contract.
- Enforced a one-way 90-minute Cyrinx gate, immediate Quiet fallback, MTU/audio/airtime/queue/digest/exactly-once checks, and terminal unqualified state.
- Routed bridge playback solely through FWAV validation and the pre-existing bounded browser playback queue; server reset increments its epoch and clears bridge playback accounting.
- Added a responsive, accessible operator console covering empty, loading, populated fixture, partial, error, narrow, and long-text states.
- Replaced placeholder qualification scripts with fixture evidence output and an exact-pair Open-air verifier. Bare verification reports `human_needed`, never success.

## Task Commits

1. **Task 1: Carry one fixture case through adapter, gate, report, and console** — `a206ffd` (test), `098ad81` (feat), `93a11db` (fix)
2. **Task 2: Enforce Cyrinx deadline, immediate Quiet fallback, and exact thresholds** — `67136ac` (test), `ca1b8db` (feat)
3. **Task 3: Finish the qualification console and exact-evidence verifier** — `365eb6d` (test), `20b1f02` (feat), `3958cbe` (fix)

## Automated Checks

- `npm run check` passed under Node 22.23.1: dependency audit, lint, typecheck, 37 unit tests, five Chromium tests, production build, corpus drift check, fixture output, unqualified bare verifier, and Compose seam.
- `node scripts/qualify.mjs verify` correctly rejects the fixture report as non-physical, missing exact hosts, incomplete corpus, and missing physical threshold evidence.

## Decisions Made

- A deadline is set before the Cyrinx run starts and is never reset, extended, retried, or manually passed.
- The browser only accepts bridge playback through `acceptBridgePlaybackFrame` with `validatePcmPlaybackFrame` and `enqueuePcmPlayback`.
- The console shows an obvious Fixture row while reiterating that it cannot select a codec or substitute for two-laptop open-air evidence.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Bug] Kept reducer dependencies browser-safe**
   - **Found during:** Task 1 build verification.
   - **Issue:** The browser reducer imported runtime constants from the Node-only report implementation.
   - **Fix:** Kept queue bounds as reducer constants and retained report imports as type-only.
   - **Commit:** `93a11db`

2. **[Rule 1 - Bug] Made the bare verifier fail closed without breaking the deterministic check suite**
   - **Found during:** Task 3 full-suite verification.
   - **Issue:** The command used by `npm run check` had no physical report paths and exited as an argument error.
   - **Fix:** No-argument verification now emits explicit `human_needed`; supplied reports still require every physical threshold.
   - **Commit:** `3958cbe`

## User Setup Required

The actual Cyrinx/Quiet executable/profile and two named laptop reports are physical-demo inputs. At the Plan 01-07 checkpoint, run the exact 90-minute Cyrinx gate on both machines; attach the two Open-air reports to `qualify:verify`. Fixture, loopback, Playwright, and browser-mock results remain diagnostic only.

## Next Phase Readiness

Phase 2 can consume the codec-neutral adapter contract, selection result, reset/epoch behavior, and bounded browser playback boundary. No codec has been selected or claimed to work over physical sound yet.

## Self-Check: PASSED

Confirmed all adapter, reducer, CLI, console, and browser-test artifacts exist; all eight task/fix commits are in history; `npm run check` passes with Node 22.23.1.
