---
phase: 01-qualify-the-demo-substrate
plan: 03
subsystem: browser-audio
tags: [web-audio, audioworklet, pcm, vite, vitest, playwright]
requires:
  - phase: 01-02
    provides: loopback-only binary bridge and deterministic browser toolchain
provides:
  - one-gesture, epoch-safe browser audio arm/reset lifecycle
  - applied-settings preflight that fails closed before codec qualification
  - fixed PCM capture batches and validated bounded playback scheduling
  - accessible responsive audio-preflight console with mocked browser-state tests
affects: [phase-01, codec-qualification, browser-bridge, fips-transport]
tech-stack:
  added: []
  patterns: [applied-not-requested audio evidence, epoch-scoped async resources, text-only dynamic UI]
key-files:
  created: [apps/modem-ui/src/audio.ts, apps/modem-ui/public/worklets/pcm-capture.js, apps/modem-ui/e2e/audio-preflight.spec.ts]
  modified: [apps/modem-ui/src/main.ts, apps/modem-ui/src/style.css, apps/modem-ui/index.html]
key-decisions:
  - "Audio readiness requires actual browser track/context/worklet values; requested constraints never count as evidence."
  - "PCM playback accepts only validated current-epoch Float32 FWAV frames and is byte/time bounded before scheduling."
patterns-established:
  - "Reset increments the epoch, closes owned browser audio resources, and rejects stale async completion."
  - "Browser-state E2E tests mock media and local bridge behavior; they do not claim physical sound-path proof."
requirements-completed: [WEB-01, WEB-02, WEB-03, WEB-07]
coverage:
  - id: D1
    description: One explicit browser arm action derives preflight state from applied microphone, context, worklet, and bridge evidence.
    requirement: WEB-01
    verification:
      - kind: unit
        ref: apps/modem-ui/src/audio.test.ts#applied audio preflight
        status: pass
      - kind: automated_ui
        ref: apps/modem-ui/e2e/audio-preflight.spec.ts#shows only the arm action until fact-based preflight succeeds
        status: pass
    human_judgment: false
  - id: D2
    description: Current-epoch PCM playback validation, bounded queuing, and reset behavior prevent stale or malformed browser audio work.
    requirement: WEB-02
    verification:
      - kind: unit
        ref: apps/modem-ui/src/audio.test.ts#PCM playback boundary
        status: pass
    human_judgment: false
  - id: D3
    description: Accessible ready, failure, disconnected, narrow-layout, and long-text preflight console states are production-built.
    requirement: WEB-03
    verification:
      - kind: automated_ui
        ref: apps/modem-ui/e2e/audio-preflight.spec.ts
        status: pass
      - kind: other
        ref: npm run build
        status: pass
    human_judgment: false
  - id: D4
    description: Exact-laptop browser/audio portability remains unproven until the physical two-laptop checkpoint.
    requirement: WEB-07
    verification: []
    human_judgment: true
    rationale: Actual device permissions, applied settings, speakers, microphones, and open-air sound path require the exact laptops.
duration: 14min
completed: 2026-07-23
status: complete
---

# Phase 01 Plan 03: Browser Audio Preflight Summary

**An epoch-safe browser audio lifecycle now captures applied microphone evidence, batches PCM in an AudioWorklet, validates bounded playback, and renders an accessible qualification preflight.**

## Performance

- **Duration:** 14 min
- **Completed:** 2026-07-23
- **Tasks:** 2/2
- **Files modified:** 10

## Accomplishments

- Added one-action browser audio arm/reset with exact processing constraints, applied-settings failure reporting, stale completion rejection, and owned-resource cleanup.
- Added a fixed-size timestamped Float32 capture worklet plus strict current-epoch FWAV PCM playback validation and byte/time bounds.
- Replaced the skeleton page with a responsive, text-safe operator console and deterministic Chromium tests for success, incompatible settings, bridge loss, reset recovery, and 320px layout.

## Task Commits

1. **Task 1: Carry one arm gesture through actual settings and PCM capture** - `8c7e7c5` (test), `5ed61d3` (feat)
2. **Task 2: Render the complete accessible audio-preflight state machine** - `773b5e0` (test), `ad37bbe` (feat)
3. **Integration fix: retain the bridge's static arm fallback** - `b7bbc0f` (fix)

## Files Created/Modified

- `apps/modem-ui/src/audio.ts` - Browser lifecycle, applied-settings evaluator, PCM parser, bounded queue, scheduler, and reset contract.
- `apps/modem-ui/public/worklets/pcm-capture.js` - Fixed-size, timestamped Float32 capture batches with discontinuity metadata.
- `apps/modem-ui/src/main.ts` - Accessible fact-based preflight state machine and local bridge report action.
- `apps/modem-ui/src/style.css` - Responsive 320px-safe console styling, focus treatment, and text-safe table layout.
- `apps/modem-ui/e2e/audio-preflight.spec.ts` - Chromium media/bridge state tests that explicitly remain non-physical.

## Decisions Made

- Readiness is derived only from applied settings and live browser context/worklet state; unknown observations fail closed.
- Browser media and PCM resources are scoped to an incrementing epoch so reset blocks stale completion and stale frames.
- Playwright mocks browser states only; passing those tests does not qualify physical microphone, speaker, or acoustic evidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added Vite browser-test server lifecycle and module declarations**
- **Found during:** Task 2
- **Issue:** The existing Playwright configuration had no app server and strict TypeScript did not declare CSS side-effect imports.
- **Fix:** Configured a loopback Vite web server for deterministic browser tests and added the minimal CSS module declaration.
- **Files modified:** `playwright.config.ts`, `apps/modem-ui/src/vite-env.d.ts`
- **Verification:** `npm run test:browser -- apps/modem-ui/e2e/audio-preflight.spec.ts` passes.
- **Committed in:** `773b5e0`, `ad37bbe`

**2. [Rule 1 - Bug] Preserved the bridge's static Arm modem fallback**
- **Found during:** Plan-level verification
- **Issue:** The loopback walking-skeleton test correctly requires the bridge-served HTML to expose its initial Arm modem action before Vite starts.
- **Fix:** Kept semantic static fallback content which the production state machine replaces after module load.
- **Files modified:** `apps/modem-ui/index.html`
- **Verification:** `npm run check` passes all 15 unit and 3 browser tests.
- **Committed in:** `b7bbc0f`

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug). Both preserve the planned browser preflight and existing loopback contract.

## Issues Encountered

The host Node runtime is newer than the audited project runtime; all checks used the pinned Node 22.23.1 executable.

## User Setup Required

None for deterministic checks. The two-laptop microphone/speaker/browser permission proof is intentionally deferred to Plan 01-07.

## Next Phase Readiness

The codec qualification work can consume applied audio evidence, epoch identifiers, timestamped PCM capture, and bounded validated playback. No fixture, mock, or loopback result has been represented as physical acoustic qualification.

## Self-Check: PASSED

Confirmed the audio lifecycle, capture worklet, E2E test, and all five plan commits (`8c7e7c5`, `5ed61d3`, `773b5e0`, `ad37bbe`, and `b7bbc0f`) exist. `npm run check` passed under Node 22.23.1.
