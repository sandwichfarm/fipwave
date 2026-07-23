---
phase: 01-qualify-the-demo-substrate
plan: 08
subsystem: quiet-runtime-and-selection
tags: [quiet-js, browser-audio, corpus, qualification, reports, cli]
requires:
  - phase: 01-07
    provides: runner-owned same-origin configuration and verified Quiet assets
provides:
  - Fixed-profile, exclusive-audio Quiet browser client
  - Open-loop local corpus scheduling and independent receive integrity evidence
  - Canonical fail-closed report merge and named selection CLI
affects: [phase-01-hardware-qualification, phase-02-codec-neutral-bridge]
tech-stack:
  added: []
  patterns:
    - Browser reads but cannot override runner authority fields.
    - Quiet schedules from local onFinish plus a fixed guard only.
    - Selection accepts only runner-stamped Open-air reports with passed exact-host TUN evidence.
key-files:
  created:
    - apps/modem-ui/src/quiet-client.ts
    - apps/modem-ui/src/quiet-client.test.ts
    - apps/modem-ui/e2e/quiet-runtime.spec.ts
    - tests/qualify-cli.test.mjs
  modified:
    - apps/modem-ui/src/main.ts
    - packages/bridge/src/report.ts
    - packages/bridge/test/report.test.ts
    - scripts/qualify.mjs
    - docs/qualification-runbook.md
key-decisions:
  - "Quiet is pinned to audible-7k-channel-0 with clampFrame true; there is no browser profile or asset override."
  - "Each sender schedules one literal-direction case locally after Quiet onFinish and a fixed 750 ms guard; no acknowledgement, retry, ARQ, remote result, or page-to-page networking is part of the schedule."
  - "Role A owns independently received B → A evidence and role B owns A → B; the named verifier preserves that machine/host ordering."
  - "Canonical selection requires runner authority, a clean matching build, fixed exact codec identity, Open-air evidence, two fully passed exact_host TUN records, 19/20 small plus 5/5 large cases per direction, cold acquisition, strict timing, and zero discontinuities."
  - "The fixed dead-link timeout is 30,000 ms; complete-payload p95 airtime is strictly below 10,000 ms and queue high-water duration is bounded at 10,000 ms."
requirements-completed: [CODEC-03, CODEC-04, WEB-01, WEB-02, WEB-03, WEB-07]
duration: 35min
completed: 2026-07-23
status: complete
---

# Phase 01 Plan 08: Executable Quiet Fallback Summary

**The production browser now reads immutable runner configuration, uses only the hash-verified fixed audible Quiet profile as an exclusive audio owner, and fails closed when reports are not genuine exact-host Open-air evidence.**

## Accomplishments

- Added a fixed Quiet classic-script client which requests mono 48 kHz capture with echo cancellation, noise suppression, and automatic gain control disabled; applied settings are displayed and incompatible values stop the run.
- Reset the normal AudioWorklet lifecycle before Quiet arms and tear down Quiet transmitter, receiver, microphone track, compatibility shim, and client state on reset.
- Added 32-byte application envelopes with at most 221 bytes of data, committed-seed corpus reproduction/digest checks, receiver deduplication, complete-only reassembly, and integrity evidence.
- Added named `qualify:verify` options for two machine reports, two exact hosts, and the exact atomic selection target. It emits `quiet`, `cyrinx`, `unqualified`, or `human_needed` with stable reasons rather than a generic selected flag.
- Documented independent A → B then B → A operation and the deterministic Loopback runner boundary.
- Added runner-side, atomic `MachineReport` persistence. It binds current-epoch audio/result data to the committed corpus and stamps machine, role, build, fixed Quiet profile, report target, evidence class, and TUN record from runner authority only.
- Made report persistence incremental: all 25 expected receive-direction rows exist from epoch start as manifest-derived Missing placeholders, accepted results are acknowledged individually, and valid incomplete or failed evidence is retained with precise reasons.
- Serialized WebSocket frame processing and report writes, enforced one tab per epoch, made reconnect conditional on RESET, and made RESET replace any prior target with a new-epoch incomplete report even when an older write is in flight.
- Added exact physical build/profile/deadline/fallback/TUN authority, observed microphone label and AudioContext state, and controlled native 44.1/48 kHz → codec-consumed 48 kHz plus one/two-channel → mono WebAudio boundaries.
- Tightened the named verifier so absent/nonphysical evidence alone is `human_needed`; present corrupt, incomplete, mismatched, unsupported, or badly timed physical evidence is `unqualified`.

## Task Commits

1. **Task 1: Arm verified Quiet from authoritative runner configuration** — `ba6428b`
2. **Task 2: Schedule local corpus and validate independent receive evidence** — `aa745ea`
3. **Task 3: Write canonical reports and named selection** — `d6c4e2a`
4. **Follow-up compatibility fix** — `5b75245`
5. **Rule 2 runner-report persistence correction** — `f5303c4`
6. **Canonical report/selection integrity correction** — `0c50fe8`
7. **Serialized runner persistence and reset correction** — `269c695`
8. **Precise verifier outcome correction** — `2017221`
9. **Controlled WebAudio resampling correction** — `70acfe0`
10. **Controlled native channel downmix correction** — `520e9fa`
11. **Controlled browser audio boundary correction** — `6e3ecba`

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Test isolation] Kept the existing Vite fixture tests diagnostic-only.**
   - The shipped runner route requires `/qualification-config` before it can arm; the existing mocked Vite suite intentionally has no runner.
   - The fixture-only branch is now restricted to Vite's port 5173. Production runner routes remain configuration-required.
   - Commit: `5b75245`.

## Automated Checks

Focused report/runner/skeleton integration: 19/19 passed, including the
19/20 threshold, exact manifest binding, p95 and queue boundaries, reset/write
generation race, multi-tab isolation, clean physical build identity, exact TUN
fields, controlled WebAudio resampling, and native stereo-to-codec-mono
downmixing.

Named CLI suite: 5/5 passed, including unordered flag parsing, exact requested
output path, ordered machine/host roles, build mismatch, substring spoof,
invented corpus/digest, 19/20 versus 18/20, and absent/nonphysical outcomes.

Focused browser/runtime suite: 26/26 passed. The production Chromium runner
scenario passed 1/1 across disposable reset/re-arm epochs 1 → 2 → 3 → 4 without
claiming acoustic success.

Full `npm run check`: passed, including dependency and lock audit, lint,
typecheck, 70 unit tests, 5 development-browser tests, production build, corpus
integrity, deterministic fixture qualification, no-argument verifier behavior,
and Compose preflight.

## Known Stubs

None in Wave 6 persistence. The runner atomically persists every current-epoch
state, including incomplete and definitive failure evidence. All 25 canonical
rows remain bound to the manifest; 19/20 byte-perfect 256-byte rows plus 5/5
1,536-byte rows may complete a direction without hiding the optional Missing
row. Deterministic Fixture/Loopback evidence remains nonphysical.

Plan 01-09 must supply the actual immutable Cyrinx start/deadline/elapsed trace
and activate Quiet with a retained Cyrinx failure/expiry reason before a
physical Quiet selection is possible; the current schema deliberately fails
closed until then.

## User Setup Required

Run the documented exact-laptop sequence on both machines: cache codec assets, obtain passed `exact_host` Docker/TUN evidence, start the authoritative runner using `--physical-open-air`, arm the two independent pages, perform A → B then B → A, and merge their reports with the named verifier. Until that evidence exists, the selection remains `human_needed` or `unqualified`.

## Self-Check: PASSED

Confirmed the runner-report commits exist and focused tests cover atomic
incremental persistence, strict selection, result acknowledgements, report
invalidation, concurrency, authority, and adverse-evidence preservation. Physical
two-laptop qualification remains unclaimed.
