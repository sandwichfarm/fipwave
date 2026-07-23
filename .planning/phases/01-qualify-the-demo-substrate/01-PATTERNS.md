# Phase 1: Qualify the Demo Substrate - Pattern Map

**Mapped:** 2026-07-23  
**Files analyzed:** 25 proposed files/modules  
**Analogs found:** 0 / 25

## Codebase Status

This repository has no implementation files yet (only `AGENTS.md` and planning artifacts). Consequently, there are no code analogs or code excerpts to copy. Every implementation assignment below is deliberately marked **greenfield**. The planner must use the cited phase contracts as the governing source, not invent a project-local convention.

`AGENTS.md` requires graph-based code discovery when code exists, but the graph tools are unavailable in this session and filesystem inspection confirmed there is no code to search. It also requires GSD workflow use for source edits.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `package.json` | config | batch | greenfield | none |
| `tsconfig.json` | config | transform | greenfield | none |
| `vite.config.ts` | config | request-response | greenfield | none |
| `apps/modem-ui/index.html` | component | request-response | greenfield | none |
| `apps/modem-ui/src/main.ts` | controller | event-driven | greenfield | none |
| `apps/modem-ui/src/audio.ts` | service | streaming | greenfield | none |
| `apps/modem-ui/src/protocol.ts` | utility | transform | greenfield | none |
| `apps/modem-ui/src/qualification.ts` | store | event-driven | greenfield | none |
| `apps/modem-ui/src/style.css` | component | transform | greenfield | none |
| `apps/modem-ui/public/worklets/pcm-capture.js` | service | streaming | greenfield | none |
| `packages/bridge/src/server.ts` | service | streaming | greenfield | none |
| `packages/bridge/src/protocol.ts` | utility | transform | greenfield | none |
| `packages/bridge/src/report.ts` | service | file-I/O | greenfield | none |
| `packages/bridge/test/protocol.test.ts` | test | transform | greenfield | none |
| `packages/bridge/test/report.test.ts` | test | file-I/O | greenfield | none |
| `apps/modem-ui/src/audio.test.ts` | test | request-response | greenfield | none |
| `apps/modem-ui/src/qualification.test.ts` | test | event-driven | greenfield | none |
| `apps/modem-ui/e2e/qualification.spec.ts` | test | request-response | greenfield | none |
| `fixtures/corpus/manifest.json` | config | batch | greenfield | none |
| `fixtures/pcm/` | test | streaming | greenfield | none |
| `scripts/generate-corpus.mjs` | utility | batch | greenfield | none |
| `scripts/qualify.mjs` | controller | batch | greenfield | none |
| `scripts/preflight-tun.sh` | utility | request-response | greenfield | none |
| `docker/preflight.Dockerfile` | config | batch | greenfield | none |
| `compose.preflight.yml` | config | request-response | greenfield | none |

## Pattern Assignments

### Workspace configuration

#### `package.json`, `tsconfig.json`, and `vite.config.ts` (config)

**Analog:** greenfield.

**Governing contract:** repository shape at `01-RESEARCH.md:30-63`; required commands at `01-RESEARCH.md:244-260`.

Create a minimal Node/TypeScript workspace supporting the exact validation commands: lint, typecheck, unit tests, production build, corpus generation, and fixture qualification. Vite serves the browser surface on localhost; do not add a component library or a browser codec-specific build assumption.

### Browser console

#### `apps/modem-ui/index.html` and `apps/modem-ui/src/main.ts` (component/controller, event-driven)

**Analog:** greenfield.

**Governing contract:** browser preflight sequence at `01-RESEARCH.md:66-86`; console layout at `01-UI-SPEC.md:102-164`; deterministic state transitions at `01-UI-SPEC.md:165-179`.

`main.ts` owns the single-page operator state machine: `idle -> requesting -> ready | failed | disconnected`. Only its explicit `Arm modem` gesture may request permission, resume/create audio, and arm capture/playback. Render actual observations as text; do not infer a pass from requested settings or from fixture evidence. Dynamic values must be text, never HTML (`01-UI-SPEC.md:78-100`).

#### `apps/modem-ui/src/style.css` (component, transform)

**Analog:** greenfield.

**Governing contract:** manual-CSS design system at `01-UI-SPEC.md:16-75`, layout/card inventory at `01-UI-SPEC.md:102-164`, and accessibility/responsive requirements at `01-UI-SPEC.md:181-191`.

Use semantic HTML controls, tables, `details`, and `dialog`; no external UI or icon library. Preserve the exact four-size typography scale, fixed colors, 44px actionable targets, 1024px two-column breakpoint, table-local horizontal scroll, visible focus outline, and reduced-motion behavior.

### Browser audio and PCM boundary

#### `apps/modem-ui/src/audio.ts` (service, streaming)

**Analog:** greenfield.

**Governing contract:** applied-settings checks at `01-RESEARCH.md:66-86` and browser/codec boundary decisions at `01-CONTEXT.md:44-53`.

Implement browser-only microphone capture and scheduled playback. Request mono 48kHz-preferred media with echo cancellation, noise suppression, and automatic gain control disabled; evaluate `track.getSettings()` and fail if applied values are unknown/incompatible/enabled. Record track and context rates. Use the AudioWorklet path, never `ScriptProcessorNode`. Reset must close tracks/context, clear local queues, increment epoch, and retain earlier evidence as historical (`01-UI-SPEC.md:165-179`).

#### `apps/modem-ui/public/worklets/pcm-capture.js` (service, streaming)

**Analog:** greenfield.

**Governing contract:** fixed-size Float32 batch capture requirement at `01-RESEARCH.md:66-86`; bounded chunks/windows decision at `01-CONTEXT.md:44-53`.

Emit timestamped, format-declared fixed-size PCM batches off the main thread. Expose discontinuities and queue growth to the main thread; do not decode a codec in the worklet.

#### `apps/modem-ui/src/protocol.ts` and `packages/bridge/src/protocol.ts` (utility, transform)

**Analog:** greenfield; these two modules must share one byte-exact envelope contract (one may re-export a shared implementation if the planner prefers).

**Governing contract:** fixed little-endian header and message types at `01-RESEARCH.md:88-114`.

Implement binary `ArrayBuffer`/`Buffer` encoding and strict parsing for magic `FWAV`, version `1`, declared payload length, epoch/stream ID, sequence/first sample index, PCM format fields, and the stated message types. Reject malformed magic/version/type/length and frames over 256KiB before enqueueing. Keep bulk PCM/results binary—never JSON or base64.

#### `packages/bridge/src/server.ts` (service, streaming)

**Analog:** greenfield.

**Governing contract:** architecture boundary at `01-RESEARCH.md:8-26`, WebSocket requirements at `01-RESEARCH.md:88-114`, and loopback-only decision at `01-CONTEXT.md:44-53`.

Run the codec-neutral local WebSocket bridge using `ws`. Bind only localhost, enforce message/queue byte-and-time caps, route PCM and qualification messages, and surface disconnect/error/reset events. It must not expose an alternate inter-laptop path or implement FIPS transport work in this phase.

### Qualification, corpus, and evidence

#### `apps/modem-ui/src/qualification.ts` (store, event-driven)

**Analog:** greenfield.

**Governing contract:** corpus/gate criteria at `01-RESEARCH.md:118-169`, UI gate and corpus behavior at `01-UI-SPEC.md:122-151`, and state rules at `01-UI-SPEC.md:165-179`.

Make gate evaluation deterministic. Key cases by `(epoch, direction, case_id)`; verified repeat delivery is a duplicate failure. Cyrinx starts an irreversible 90-minute timer, stops immediately on any failed hard gate, and cannot be extended/retried. Expiry rejects Cyrinx and exposes Quiet fallback; Quiet failure/missing evidence resolves only to `unqualified`. Only exact-pair `Open air` evidence contributes to selection.

#### `scripts/generate-corpus.mjs` and `fixtures/corpus/manifest.json` (utility/config, batch)

**Analog:** greenfield.

**Governing contract:** corpus content and SHA-256 manifest at `01-RESEARCH.md:118-129`.

Generate committed-seed, reproducible 256B and 1536B corpora for both literal directions. Include zero, `0xff`, incrementing, alternating, and deterministic pseudorandom patterns. Manifest records case ID, direction, size, and expected digest. Do not make a 1536-byte case a single waveform requirement.

#### `packages/bridge/src/report.ts` and `scripts/qualify.mjs` (service/controller, file-I/O/batch)

**Analog:** greenfield.

**Governing contract:** canonical report fields at `01-RESEARCH.md:197-213`, phase completion/human evidence rule at `01-RESEARCH.md:264-271`, and report UI requirements at `01-UI-SPEC.md:157-163`.

Write canonical per-machine JSON to `.artifacts/qualification/<machine-id>.json`; merge two reports into `.artifacts/qualification/selection.json`. Include environment/audio evidence, codec/profile/deadline, every corpus result, queue observations, TUN evidence, and machine-readable reason codes. With missing hardware evidence, return `human_needed`, never a physical pass.

#### `fixtures/pcm/` (test, streaming)

**Analog:** greenfield.

**Governing contract:** codec golden-vector/fixture loopbacks at `01-RESEARCH.md:131-157` and validation test layers at `01-RESEARCH.md:232-242`.

Commit deterministic PCM fixtures used for codec batch round trips. They verify the harness without claiming open-air qualification.

### Docker/TUN preflight

#### `docker/preflight.Dockerfile`, `compose.preflight.yml`, and `scripts/preflight-tun.sh` (config/config/utility, batch/request-response)

**Analog:** greenfield.

**Governing contract:** Docker/TUN specification at `01-RESEARCH.md:171-195` and preflight decision at `01-CONTEXT.md:55-64`.

Pin the Linux base image. Compose must mount `/dev/net/tun`, grant only `NET_ADMIN`, set `no-new-privileges:true`, and never use `privileged` or `SYS_ADMIN`. The script validates the device, creates only `fips-preflight0`, assigns IPv6, prints detailed link evidence, and cleans up that same interface on exit. The UI treats every listed check as independently visible; no overall pass until all succeed (`01-UI-SPEC.md:153-155`).

### Tests

#### `packages/bridge/test/protocol.test.ts` and `packages/bridge/test/report.test.ts` (test)

**Analog:** greenfield.

**Governing contract:** protocol/corpus-report test layers at `01-RESEARCH.md:234-242`.

Cover header round trips; malformed header and cap rejection; epoch reset; queue overflow; reproducible manifests; digest mismatch; missing/duplicate case handling; gate thresholds; and report-schema validation.

#### `apps/modem-ui/src/audio.test.ts`, `apps/modem-ui/src/qualification.test.ts`, and `apps/modem-ui/e2e/qualification.spec.ts` (test)

**Analog:** greenfield.

**Governing contract:** fake-settings/Playwright constraints at `01-RESEARCH.md:244-260` and UI state/accessibility contract at `01-UI-SPEC.md:165-191`.

Unit-test settings evaluation with fake `MediaTrackSettings` and qualification transitions. Use Playwright only for permission denial, unsupported-state, and disconnected UI paths; do not make CI require a microphone, speakers, Docker, TUN, or open-air hardware.

## Shared Patterns

### Evidence is canonical and physical qualification is explicit

**Sources:** `01-RESEARCH.md:197-213`, `01-RESEARCH.md:264-271`, `01-UI-SPEC.md:157-163`.

JSON evidence is canonical; the console is its readable projection. Fixture and loopback results are never promoted to an acoustic pass. Exact-laptop-pair, both-direction open-air reports plus Docker/TUN evidence are required for a selection; otherwise report `human_needed` or `unqualified`.

### Epoch and bounded-queue safety

**Sources:** `01-RESEARCH.md:88-114`, `01-CONTEXT.md:44-53`, `01-UI-SPEC.md:165-179`.

Every message/result carries an epoch. Reset increments it, clears queues and cancels scheduling; stale data is ignored/logged. All PCM/decode queues have byte and time limits, high-water reporting, and observable discontinuities.

### Codec neutrality and hard selection gates

**Sources:** `01-CONTEXT.md:31-53`, `01-RESEARCH.md:131-169`.

Keep browser audio and bridge protocol codec-neutral. Cyrinx has a strict 90-minute batch-codec gate; on a miss, move immediately to the fixed audible Quiet fallback. `ggwave` is plumbing diagnostics only and cannot select a codec. Preserve selected profile, measured airtime, advertised MTU, and readiness in the report for later phases.

### UI accessibility and operator safety

**Sources:** `01-UI-SPEC.md:78-100`, `01-UI-SPEC.md:181-191`.

Use semantic native elements, text-plus-symbol status, live regions, visible keyboard focus, and non-color failure explanations. No waveform/level meter, autoplay, device picker, codec-profile picker, manual pass, or retry-Cyrinx control belongs in Phase 1.

## No Analog Found

All proposed files are greenfield because no implementation code exists. Use the cited contracts above; do not fabricate import, authentication, error, or test excerpts from a nonexistent local pattern.

## Metadata

**Analog search scope:** repository root excluding `.planning`; project graph tools unavailable in this session  
**Files scanned:** 1 implementation candidate (`AGENTS.md`); 0 source files  
**Pattern extraction date:** 2026-07-23

