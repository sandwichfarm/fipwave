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
  - "Canonical selection requires runner authority, exact A/B roles, Open-air evidence, two passed exact_host TUN records, complete nonduplicate corpus evidence, compatible codec, and MTU at least 1357."
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

## Task Commits

1. **Task 1: Arm verified Quiet from authoritative runner configuration** — `ba6428b`
2. **Task 2: Schedule local corpus and validate independent receive evidence** — `aa745ea`
3. **Task 3: Write canonical reports and named selection** — `d6c4e2a`
4. **Follow-up compatibility fix** — `5b75245`

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Test isolation] Kept the existing Vite fixture tests diagnostic-only.**
   - The shipped runner route requires `/qualification-config` before it can arm; the existing mocked Vite suite intentionally has no runner.
   - The fixture-only branch is now restricted to Vite's port 5173. Production runner routes remain configuration-required.
   - Commit: `5b75245`.

## Automated Checks

- `npm run check` — passed (49 unit tests, 5 development-browser tests, build, corpus, fixture, CLI no-argument human-needed result, and Compose preflight).
- `npm run test:browser:production -- apps/modem-ui/e2e/quiet-runtime.spec.ts` — passed against the compiled runner and real same-origin config/assets.
- `node --test tests/qualify-cli.test.mjs` — passed (named options, requested output target, Quiet selection, and nonphysical rejection).

## Known Stubs

The runner currently stamps accepted qualification-result frames in bridge
memory but does not yet persist a complete `MachineReport` from the browser's
measured Quiet receiver evidence. The named CLI and its canonical report
validation are complete and tested, but an exact-laptop run needs this small
runner-persistence follow-up before it can emit the two input files itself.
A physical acoustic pass is intentionally not modelled as a fixture or inferred
from the deterministic runner.

## User Setup Required

Run the documented exact-laptop sequence on both machines: cache codec assets, obtain passed `exact_host` Docker/TUN evidence, start the authoritative runner using `--physical-open-air`, arm the two independent pages, perform A → B then B → A, and merge their reports with the named verifier. Until that evidence exists, the selection remains `human_needed` or `unqualified`.

## Self-Check: PASSED

Confirmed all four implementation commits exist and the Quiet client, production browser spec, canonical report validator, named CLI test, and updated runbook are present.
