---
phase: 01-qualify-the-demo-substrate
plan: 09
subsystem: acoustic-codec-runtime
tags: [cyrinx, native-c, browser-audio, websocket, qualification, quiet-fallback]
requires:
  - phase: 01-08
    provides: Runnable fixed Quiet fallback, canonical reports, corpus roles, and named selection verifier
provides:
  - Hash-built portable Cyrinx C batch PHY with fixed 1,536-byte application MTU
  - Bounded runner-owned Cyrinx playback, capture, decode, and ordered qualification
  - Immutable early-abandon deadline with immediate durable Quiet fallback
  - Recoverable browser case watchdog and urgent RESET/ERROR preemption
affects: [01-10-physical-qualification, 02-codec-neutral-fips-bridge, demo-runtime]
tech-stack:
  added: []
  patterns:
    - Runner snapshots own stage, case, direction, timing, fallback, and report authority.
    - Native codec children receive AbortSignal and remain bounded by command, byte, time, epoch, and case identity.
    - Case completion is provisional until its canonical report is durably written and the deadline is rechecked.
key-files:
  created:
    - native/cyrinx_batch.c
    - scripts/build-cyrinx.mjs
    - packages/bridge/src/cyrinx-worker.ts
    - packages/bridge/src/qualification-session.ts
    - apps/modem-ui/src/cyrinx-case-watchdog.ts
  modified:
    - packages/bridge/src/server.ts
    - packages/bridge/src/runner.ts
    - packages/bridge/src/codecs/command.ts
    - apps/modem-ui/src/audio.ts
    - apps/modem-ui/src/main.ts
    - packages/bridge/src/report.ts
    - docs/qualification-runbook.md
key-decisions:
  - "Use only Cyrinx's pinned portable C bulk API with one fixed QPSK rate-1/2 profile; Swift, WASM, streaming decode, MRC, sessions, adaptive profiles, ARQ, and retransmission remain excluded."
  - "The runner, not either browser, assigns every literal-direction case and holds both roles to one 4.5-second accepted-at barrier."
  - "A 25-second browser case watchdog emits one failure, while RESET and ERROR synchronously cancel stalled native build, digital, settle, encode, and decode work."
  - "A Cyrinx success is not authoritative until its report write completes before the immutable deadline; every miss records one stable reason and activates Quiet."
patterns-established:
  - "Qualification authority advances only after durable evidence, with current-epoch generation checks on both sides of asynchronous work."
  - "Urgent controls reserve a per-epoch received-sequence watermark before they preempt queued work."
requirements-completed: [CODEC-02, CODEC-03, CODEC-04]
coverage:
  - id: D1
    description: The pinned portable Cyrinx C batch PHY builds and digitally round-trips the fixed 256-byte and 1,536-byte application cases with exact geometry and framing validation.
    requirement: CODEC-02
    verification:
      - kind: integration
        ref: npm run cyrinx:test
        status: pass
      - kind: unit
        ref: tests/cyrinx-batch.test.mjs#pinned Cyrinx batch binary
        status: pass
    human_judgment: false
  - id: D2
    description: One current-epoch Cyrinx case uses bounded native PCM work, mono capture, left-only stereo playback, deduplication, discontinuity checks, and a browser stall watchdog.
    requirement: CODEC-02
    verification:
      - kind: unit
        ref: tests/cyrinx-runtime.test.ts#bounded Cyrinx runtime
        status: pass
      - kind: unit
        ref: apps/modem-ui/src/audio.test.ts#Cyrinx playback and capture
        status: pass
      - kind: e2e
        ref: npm run test:browser:production
        status: pass
    human_judgment: false
  - id: D3
    description: Runner-owned ordered qualification abandons Cyrinx on the first failure or deadline, durably activates Quiet, and rejects stale, duplicate, spoofed, or late authority.
    requirement: CODEC-03
    verification:
      - kind: unit
        ref: packages/bridge/test/qualification-session.test.ts#runner-owned Cyrinx qualification session
        status: pass
      - kind: integration
        ref: tests/production-runner.test.ts#production runner
        status: pass
      - kind: integration
        ref: node --test tests/qualify-cli.test.mjs
        status: pass
    human_judgment: false
  - id: D4
    description: Exact-laptop open-air acquisition, corpus delivery, browser device behavior, and exact-host Docker/TUN evidence remain the blocking physical qualification.
    requirement: CODEC-04
    verification: []
    human_judgment: true
    rationale: Digital, loopback, and headless-browser checks cannot establish speaker-to-microphone delivery, room acoustics, applied hardware policy, or real host TUN access.
duration: 114min
completed: 2026-07-23
status: complete
---

# Phase 01 Plan 09: Bounded Cyrinx Runtime Summary

**The production runner can now try the pinned high-throughput Cyrinx batch PHY under strict resource and time bounds, then preserve the already runnable Quiet path on any miss without claiming physical acoustic success.**

## Performance

- **Duration:** 1h 54m
- **Started:** 2026-07-23T19:46:34+01:00
- **Completed:** 2026-07-23T21:40:43+01:00
- **Tasks:** 3/3
- **Files modified:** 32

## Accomplishments

- Added a hash-checked portable C executable around the pinned Cyrinx bulk API. Its fixed frame is 62,464 mono Float32 samples at 48 kHz and carries a 256-byte authenticated metadata block plus an honest 1,536-byte application payload.
- Connected one runner-owned qualification case at a time to bounded native encode/decode, FWAV playback/capture, exact left-only/right-zero browser output, mono input, continuity checks, epoch/case deduplication, and measured evidence.
- Implemented the immutable 90-minute build → digital → cold A → B → cold B → A → corpus order, with no Cyrinx retry or extension and immediate fixed Quiet activation on the first failure.
- Made RESET, ERROR, disconnect, reload, deadline expiry, browser stalls, and native stalls fail closed without allowing late work or a stale successful report to regain authority.
- Bound codec selection to canonical runner stage and cold-receive evidence, and documented the exact deterministic and physical procedures.

## Task Commits

1. **Task 1: Digitally round-trip one case through the pinned C bulk PHY** — `9f90a52` (test), `2fa5f93` (feat), `854a74f` (fix)
2. **Task 2: Connect bounded Cyrinx batch windows to FWAV capture and playback** — `152a7e9` (feat), `4356f95` (fix)
3. **Task 3: Enforce early abandonment and immediate Quiet activation** — `5754309`, `3381161`, `592c70f`, `00e191c`, `b1cecbf`, `572ba73`
4. **Runner/browser authority and recovery hardening** — `5feb7d9`, `65eeb4a`, `bca8dbd`, `5a49203`, `530d50e`, `2c2eca6`, `fec746e`, `1819b27`
5. **Canonical timing, fallback, and report hardening** — `30bbe28`, `d9022f7`, `88696d1`, `01acd22`, `eb7f67a`
6. **Browser case abandonment and ordered handoff hardening** — `6f6b918`, `0f67721`, `5213f64`, `3554e5e`, `838caf6`, `d35ba4b`
7. **Final persistence, sequencing, and cancellation hardening** — `730b309`, `f9cedec`
8. **Operator runbook correction** — `ab94dfb`

## Files Created/Modified

- `native/cyrinx_batch.c` — Fixed-geometry encode/decode CLI over the portable Cyrinx bulk API.
- `scripts/build-cyrinx.mjs` — Traversal-safe extraction, license/hash verification, and host C compilation.
- `packages/bridge/src/cyrinx-worker.ts` — One-case native PCM worker with bounded processes, buffers, time, and identity.
- `packages/bridge/src/qualification-session.ts` — Runner-owned ordered stages, immutable deadline, accepted-at barrier, and provisional completion.
- `packages/bridge/src/server.ts` — Durable reports, authoritative case routing, urgent cancellation, sequence watermarks, and fallback.
- `apps/modem-ui/src/audio.ts` — Bounded mono capture and two-channel left-only Cyrinx playback.
- `apps/modem-ui/src/cyrinx-case-watchdog.ts` — Current-epoch 25-second capture/playback/handoff abandonment.
- `apps/modem-ui/src/main.ts` — Snapshot-following browser control with irreversible Quiet transition.
- `packages/bridge/src/report.ts` — Fail-closed canonical Cyrinx/Quiet selection authority.
- `docs/qualification-runbook.md` — Exact deterministic, role-ordered, Docker/TUN, and physical commands.

## Decisions Made

- Cyrinx remains a narrow batch spike. The implementation uses only the portable C bulk calls and the pinned fixed profile; no new toolchain or excluded modem feature was introduced.
- Both laptops follow runner-assigned literal directions. A browser acknowledges only its current instruction and cannot select a codec, stage, case, deadline, evidence class, or report target.
- The 4.5-second interval is a total barrier from runner acceptance for both roles, not an extra delay after playback or decode.
- Completion remains revocable until the report writer returns, the current generation and operation still match, and the immutable deadline is checked again.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Correctness] Moved final scheduling authority fully into the runner.**
   - Browser-only progress could diverge between the two independent laptops or expose an in-flight next instruction.
   - The runner now assigns, accepts, settles, persists, and only then advances each case.

2. **[Rule 1 - Recovery] Added bounded browser and native-operation abandonment.**
   - Capture, playback, build, digital, or authoritative handoff failures could otherwise strand the demo.
   - A 25-second browser watchdog and AbortSignal-backed urgent control path now activate fallback exactly once.

3. **[Rule 1 - Evidence integrity] Hardened asynchronous report and deadline boundaries.**
   - Adversarial tests exposed stale success writes, queued urgent-sequence overtaking, wall-clock rollback, and the deadline crossing while a report writer was active.
   - Per-epoch sequence reservation, monotonic elapsed state, provisional completion, generation checks, and post-write deadline checks now fail closed.

**Total deviations:** 3 auto-fixed correctness/recovery issues. All were necessary to satisfy the plan's existing authority, boundedness, and immediate-fallback requirements; no excluded Cyrinx scope was added.

## Automated Checks

- `npm run fetch:codecs:check`: passed network-free cache verification.
- `npm run cyrinx:build`: passed on the active macOS host.
- `npm run cyrinx:test`: 5/5 native build, geometry, framing, and digital round-trip tests passed.
- `npm run check`: passed dependency audit, lint, typecheck, 163/163 unit tests, 5/5 development browser tests, production build, corpus check, fixture qualification, named-verifier default behavior, and Compose static preflight.
- `node --test tests/qualify-cli.test.mjs`: 6/6 named canonical verifier cases passed.
- `npm run test:browser:production`: 2/2 unmocked production Chromium tests passed on an isolated port without claiming acoustic success.
- GSD schema drift and UI safety gates passed; codebase drift was not applicable because no structure document exists.
- Independent adversarial review reported no remaining persistence, urgent-sequence, terminal-completion, or build/digital cancellation blocker.

## Known Stubs

None in the deterministic Cyrinx/Quiet runtime. Native digital and production-browser evidence remains nonphysical by design. No generated report is eligible to select a codec until the exact two laptops supply runner-stamped `Open air` evidence and passing `exact_host` TUN records.

## User Setup Required

Complete Plan 01-10's eight-step blocking-human procedure on the two exact laptops. Run the same commit and Node 22.23.1 on both, collect real Docker/TUN evidence, witness both open-air directions, run the selected codec corpus, and execute the named verifier. Preserve any failure reason; do not relabel deterministic evidence or widen thresholds.

## Next Phase Readiness

The software substrate is ready for exact-laptop physical qualification. Phase 1 and all later FIPS integration remain blocked until Plan 01-10 produces two physical reports and a canonical `cyrinx` or `quiet` selection, or records the actual unqualified reason codes.

## Self-Check: PASSED

Confirmed every listed implementation commit exists, the worktree is clean, all deterministic gates pass under Node 22.23.1, and the summary makes no speaker, microphone, room, or exact-host TUN success claim.

---
*Phase: 01-qualify-the-demo-substrate*
*Completed: 2026-07-23*
