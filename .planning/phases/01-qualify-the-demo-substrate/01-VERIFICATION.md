---
phase: 01-qualify-the-demo-substrate
verified: 2026-07-23T15:56:12Z
status: gaps_found
score: 0/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "An operator can complete the one-action browser modem preflight on an actual production qualification route."
    status: failed
    reason: "The UI opens /bridge on its own origin, but no production process starts createBridgeServer or serves the Vite bundle with that WebSocket route. Vite is the only browser runner, and it has no /bridge upgrade handler."
    artifacts:
      - path: "apps/modem-ui/src/main.ts"
        issue: "reportToBridge requires a same-origin /bridge WebSocket that the shipped Vite configuration does not provide."
      - path: "packages/bridge/src/server.ts"
        issue: "createBridgeServer is a tested library export only; no executable imports and starts it, and its HTTP server serves only index.html rather than built assets."
    missing:
      - "Add one documented production runner that starts the loopback bridge and serves the built modem UI/assets on the same origin."
      - "Exercise an unmocked Chromium arm action against that runner."
  - truth: "The selected codec can send and receive the 256-byte and 1536-byte corpus over actual audible sound in both directions."
    status: failed
    reason: "No Cyrinx executable, pinned codec asset, Quiet browser bundle, BrowserQualificationClient implementation, or acoustic encode/decode loop is present. Start Cyrinx qualification only inserts one Fixture row."
    artifacts:
      - path: "apps/modem-ui/src/main.ts"
        issue: "startQualification sets a presentation state and fixture row; it does not invoke an adapter, transmit sound, decode microphone samples, or write a report."
      - path: "packages/bridge/src/codecs/command.ts"
        issue: "NativeCommandCodecAdapter requires an injected runner but no runtime supplies one."
      - path: "packages/bridge/src/codecs/websocket.ts"
        issue: "BrowserWebSocketCodecAdapter requires an injected BrowserQualificationClient but no implementation or wiring exists."
      - path: "apps/modem-ui/src/audio.ts"
        issue: "The AudioWorklet capture callback only invokes optional captureHandler; main.ts never registers it, so captured PCM reaches no codec or bridge."
    missing:
      - "Ship and pin one executable Cyrinx path or browser-ready Quiet fallback, including its actual audible profile and startup command."
      - "Wire worklet PCM capture to codec decoding and codec output to validated PCM playback; wire qualification cases/results through the bridge and report writer."
      - "Replace the fixture-only Start action with the immutable Cyrinx-to-Quiet corpus execution."
  - truth: "The strict 90-minute gate and exact-pair Open-air selection are runnable and can produce canonical reports."
    status: failed
    reason: "The only runnable qualification command creates fixture evidence. The verify implementation accepts four positional values, while Plan 01-07 documents --machine-a/--machine-b/--selection flags; the documented command exits with its usage error. No code produces machine Open-air reports automatically."
    artifacts:
      - path: "scripts/qualify.mjs"
        issue: "fixture writes a non-physical fixture report; verify has no named-flag parser and writes a hard-coded selection path with decision 'selected', not the required codec-or-unqualified decision."
      - path: "packages/bridge/src/report.ts"
        issue: "Validated MachineReport and mergeSelection contracts exist, but the browser/codec runtime never calls writeMachineReport or mergeSelection."
    missing:
      - "Implement the documented named CLI interface (or correct every document and plan), honor the requested selection path, and emit canonical Cyrinx, Quiet, or unqualified selection data."
      - "Generate one complete Open-air MachineReport per actual laptop from measured audio, corpus, queue, codec, and TUN evidence."
  - truth: "Both exact laptops can use the same browser qualification path in both acoustic directions."
    status: failed
    reason: "This is not merely awaiting hardware evidence: there is no runnable acoustic qualification path to install on either laptop. The existing Playwright coverage replaces WebSocket, microphone, AudioContext, and AudioWorklet with fakes."
    artifacts:
      - path: "apps/modem-ui/e2e/audio-preflight.spec.ts"
        issue: "The test injects FakeWebSocket, FakeAudioContext, FakeWorklet, and getUserMedia stubs, so it does not exercise browser-to-bridge or acoustic behavior."
    missing:
      - "After the runtime gaps close, run the unmocked production route on both named laptops and retain both reports; this remains a human hardware check."
  - truth: "The selected fixed audible profile and Docker/TUN preflight are qualified for the demo substrate."
    status: partial
    reason: "Compose authority validation and fake owned-TUN lifecycle are substantive and pass deterministically, but there is no selected/profiled codec and no exact-host Docker/TUN execution evidence."
    artifacts:
      - path: "compose.preflight.yml"
        issue: "Static topology is least-privilege and isolated; it is not proof that either exact host can expose /dev/net/tun."
      - path: "scripts/preflight-tun.sh"
        issue: "Owned lifecycle is tested with a fake ip/device harness; no exact-host evidence exists."
    missing:
      - "Complete the implemented Docker/TUN runbook on both exact laptops after the runnable modem path is available, preserving failures rather than widening authority."
---

# Phase 1: Qualify the Demo Substrate Verification Report

**Phase Goal:** The exact two demo laptops have a qualified, intentionally audible browser-audio path and a Docker/TUN preflight, leaving either a proven Cyrinx path or an immediate browser-ready fallback before FIPS integration begins.

**Verified:** 2026-07-23T15:56:12Z  
**Status:** gaps_found  
**Re-verification:** No — initial audit

Phase 1 is declared `mvp`, but its ROADMAP goal is not in the required user-story form. This report therefore verifies the ROADMAP success criteria directly. The equivalent user-story wording in the plans was used only to describe the operator flow; no physical evidence is inferred.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | One browser action completes real applied-audio preflight and visible failure handling. | ✗ FAILED | `main.ts` calls `ws://${window.location.host}/bridge`, but no shipped runner combines that route with the Vite build. `createBridgeServer` is never started by production code. |
| 2 | The same Chromium qualification path works in both acoustic directions on the exact laptops. | ✗ FAILED | There is no acoustic codec runtime to install. Browser tests fake every browser/audio/bridge boundary. |
| 3 | The 90-minute Cyrinx gate sends the defined corpus in both directions or immediately runs a real browser-ready fallback. | ✗ FAILED | `startQualification()` only appends a Fixture row. No Cyrinx asset/runner or Quiet browser implementation exists; capture does not flow to a codec. |
| 4 | A fixed audible selected codec and least-privilege Docker/TUN preflight are qualified. | ✗ FAILED | Static/fake Docker-TUN controls pass, but no codec is selected and neither exact host has run the TUN procedure. |

**Score:** 0/4 roadmap truths verified. Deterministic protocol, report, corpus, UI-state, and Docker/TUN artifacts exist, but do not create an executable acoustic qualification system.

## User Flow Coverage

| Step | Expected | Evidence | Status |
| --- | --- | --- | --- |
| Open a local qualification page | The page has its same-origin local WebSocket bridge. | Vite serves the page, but no runner starts `createBridgeServer`; its server only serves `index.html`. | ✗ FAILED |
| Click **Arm modem** | Permission, applied settings, capture worklet, and bridge become ready. | Source requests microphone and evaluates settings, but the required `/bridge` endpoint is absent on the Vite origin. | ✗ FAILED |
| Start Cyrinx qualification | Measured corpus is sent, received, decoded, and assessed before the 90-minute deadline. | `startQualification()` sets `cyrinx-running` and creates one `Fixture` row with `0 ms` airtime. | ✗ FAILED |
| Switch to Quiet on a Cyrinx gate miss | The same real corpus runs through a browser-ready audible fallback. | The gate reducer has fallback logic, but no Quiet asset/client/runtime invokes it. | ✗ FAILED |
| Outcome: evidence-backed codec and host assumptions | Two canonical Open-air reports yield a selection or unqualified result. | Only a fixture report can be created automatically; the documented verifier invocation is incompatible with its parser. | ✗ FAILED |

## Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `apps/modem-ui/src/audio.ts` | Applied-settings, capture, and bounded playback boundary | ⚠️ PARTIAL | Substantive and unit-tested; `setPcmCaptureHandler` has no production caller, so capture is disconnected from codec/bridge. |
| `apps/modem-ui/src/main.ts` | Operator UI and live qualification control | ⚠️ PARTIAL | Builds, but its live bridge endpoint is absent and its qualification action is fixture-only. |
| `packages/bridge/src/server.ts` | Loopback binary bridge | ⚠️ ORPHANED | Substantive and skeleton-tested, but no executable starts it. It accepts only `AUDIO_SETTINGS`; no PCM capture/result ingress is handled. |
| `packages/bridge/src/codecs/command.ts` | Cyrinx execution adapter | ⚠️ ORPHANED | Adapter interface is substantive but needs an injected runner; none exists. No Cyrinx artifact is present. |
| `packages/bridge/src/codecs/websocket.ts` | Quiet/browser adapter | ⚠️ ORPHANED | Needs an injected `BrowserQualificationClient`; none exists. No Quiet browser asset is present. |
| `scripts/qualify.mjs` | Fixture and exact-evidence CLI | ⚠️ PARTIAL | Fixture path is runnable and honestly non-physical. Exact-report parser/output disagree with the Plan 01-07 operator contract. |
| `compose.preflight.yml`, `scripts/check-compose.mjs`, `scripts/preflight-tun.sh` | Least-privilege Docker/TUN preflight | ✓ VERIFIED (deterministic scope) | Static authority contract and fake owned-lifecycle are substantive and tested; exact-host execution remains absent. |

## Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `main.ts` | `audio.ts` | Arm/reset handler | ✓ WIRED | `arm()` invokes `armAudio`; `reset()` invokes `resetAudio`. |
| `audio.ts` worklet | codec / bridge | Captured PCM handler | ✗ NOT WIRED | Worklet calls optional `captureHandler`; no `setPcmCaptureHandler` use exists outside its declaration. |
| browser page | `createBridgeServer` | same-origin `/bridge` | ✗ NOT WIRED | No production entry point invokes `createBridgeServer`; Vite has no bridge upgrade route. |
| codec adapters | qualification gate/report | runtime adapter result | ✗ NOT WIRED | No runner/client instantiates either real adapter; fixture-only state is handwritten in `main.ts`. |
| actual laptop reports | `selection.json` | `qualify:verify` | ✗ NOT WIRED | Documented named flags fail against positional parser; no automatic report creator supplies inputs. |
| Compose topology | TUN lifecycle | container command | ✓ WIRED (configuration) | Compose builds the preflight image/entrypoint with `/dev/net/tun`, `NET_ADMIN`, `no-new-privileges`, `privileged:false`, and `network_mode:none`. |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Deterministic unit/protocol/report/TUN tests | Node 22.23.1 `npm test` | 8 files, 44 tests passed | ✓ PASS |
| Browser bundle | Node 22.23.1 `npm run build` | Vite produced `dist/modem-ui` | ✓ PASS |
| Static least-privilege Compose contract | Node 22.23.1 `npm run test:compose` | Emitted passing static `TunEvidence`; lifecycle checks correctly `not_run` | ✓ PASS |
| Fixture qualification | Node 22.23.1 `npm run qualify:fixture` | Emits a `human_needed; never physical` fixture report | ✓ PASS (diagnostic only) |
| Bare verifier | Node 22.23.1 `npm run qualify:verify` | Reports `human_needed` with no reports | ✓ PASS (fail-closed diagnostic) |
| Plan 01-07 documented verifier command | `npm run qualify:verify -- --machine-a a.json --machine-b b.json --selection s.json` | Exits with positional-usage error | ✗ FAIL |

## Requirements Coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| CODEC-02 | ✗ BLOCKED | No executable/browser codec path can conduct the two-laptop bidirectional qualification. |
| CODEC-03 | ✗ BLOCKED | Gate logic exists but is fed no real runtime results; Quiet fallback is not browser-ready. |
| CODEC-04 | ✗ BLOCKED | Profile objects are constants only; no selected, rehearsed audible codec implementation exists. |
| WEB-01 | ✗ BLOCKED | Source requests media/audio, but the deployed browser route has no bridge server to finish the prescribed action. |
| WEB-02 | ⚠️ PARTIAL | Correct constraints are requested and actual settings are evaluated; no live production run proves them. |
| WEB-03 | ⚠️ PARTIAL | Failure matrix/UI code exists, but no unmocked same-origin production route persists/reports actual evidence. |
| WEB-07 | ✗ BLOCKED | Exact laptops have neither the runtime nor physical reports; mocked Chromium tests are not evidence. |
| DEPLOY-02 | ⚠️ NEEDS HUMAN | Static and fake lifecycle behavior pass. Exact Docker/TUN execution on both laptops has not happened. |

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
| --- | --- | --- | --- |
| `apps/modem-ui/src/main.ts` | `Start Cyrinx qualification` changes UI state and inserts a Fixture result | 🛑 BLOCKER | A user-visible control presents a qualification flow without executing a codec or corpus. |
| `apps/modem-ui/e2e/*.spec.ts` | Fake WebSocket, microphone, AudioContext, and worklet | ⚠️ WARNING | Passing browser tests validate presentation state, not the real browser/bridge/audio flow. |
| `scripts/qualify.mjs` / `01-07-PLAN.md` | Positional implementation vs named documented flags | 🛑 BLOCKER | The checkpoint command cannot be executed as written. |

No untracked `TBD`, `FIXME`, or `XXX` debt markers were found in Phase 1 implementation files. The blockers are observable missing wiring/runtime, not comments or hypothetical hardware failures.

## Human Verification Required After Gap Closure

### 1. Exact-laptop browser and acoustic qualification

**Test:** On both named laptops, run the production runner, arm each modem, and execute the entire corpus A → B and B → A within the immutable Cyrinx window; on rejection, run the fixed Quiet fallback.

**Expected:** Two Open-air machine reports contain measured settings, codec/profile identity, byte-perfect/deduplicated corpus results, acquisition/airtime, and queue evidence; selection is Cyrinx, Quiet, or unqualified.

**Why human:** Microphone/speaker hardware, permission behavior, room acoustics, and cold acquisition cannot be established by mocks.

### 2. Exact-host Docker/TUN preflight

**Test:** Run the existing Docker build/config/inspect/lifecycle procedure on each exact laptop.

**Expected:** Each host preserves `/dev/net/tun`, `NET_ADMIN` only, non-privileged/no-SYS_ADMIN/no-new-privileges constraints, IPv6 setup, and owned cleanup—or records a fail-closed result.

**Why human:** Docker Desktop/Engine device exposure is host-dependent.

## Gaps Summary

The phase must not proceed to the two-laptop checkpoint yet. The missing work is implementation, not evidence collection:

1. Add a single production, loopback-only UI-plus-bridge runner.
2. Add one real, pinned acoustic codec path (Cyrinx or browser-ready Quiet fallback) and wire microphone capture, playback, adapter results, and canonical report creation end to end.
3. Replace the fixture-only qualification click with measured corpus execution, immutable deadline/fallback control, and Open-air report output.
4. Reconcile the qualification CLI with the documented named options and canonical selection semantics.
5. Then run the existing exact-laptop and Docker/TUN human checkpoint without claiming success from deterministic evidence.

_Verified: 2026-07-23T15:56:12Z_  
_Verifier: gsd-verifier (adversarial early audit)_
