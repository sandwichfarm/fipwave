# Phase 1: Qualify the Demo Substrate - Research

**Researched:** 2026-07-23
**Confidence:** MEDIUM
**Deadline posture:** Demo-tomorrow; prefer a measured fallback over extending a
promising but incomplete PHY.

## Executive Recommendation

Build one small TypeScript/browser qualification application plus a local
binary WebSocket bridge. The browser owns microphone capture and scheduled
speaker playback. Codec workers remain behind a codec-neutral interface:

```text
browser MediaStream / AudioWorklet
  <-> binary localhost WebSocket
  <-> bounded PCM / packet bridge
  <-> codec adapter (Cyrinx first, Quiet.js fallback)
```

Run the deterministic harness and Docker/TUN preflight locally first, then use
the exact two laptops for the only irreducibly manual evidence: open-air,
bidirectional acquisition and byte-perfect payload delivery. Stop the Cyrinx
spike at 90 minutes. If it misses any gate, select the pre-qualified audible
Quiet.js profile immediately. `ggwave` may diagnose the audio path but is not a
throughput qualification.

## Architecture

### Repository Shape

Use a minimal Node/TypeScript workspace so the qualification code becomes the
Phase 2 bridge instead of throwaway scripts:

```text
apps/modem-ui/
  index.html
  src/main.ts
  src/audio.ts
  src/protocol.ts
  src/qualification.ts
  src/style.css
  public/worklets/pcm-capture.js
packages/bridge/
  src/server.ts
  src/protocol.ts
  src/report.ts
  test/
fixtures/
  corpus/
  pcm/
scripts/
  generate-corpus.mjs
  preflight-tun.sh
  qualify.mjs
docker/
  preflight.Dockerfile
compose.preflight.yml
```

Vite is sufficient for the static browser build and secure-context localhost
development. Use Node's maintained `ws` package for the bridge. Use Playwright
only for permission-denied/unsupported browser states that do not require a
real microphone.

### Browser Audio Preflight

The `Arm modem` click must perform all gesture-gated operations:

1. Create or resume an `AudioContext` requested at 48,000 Hz.
2. Call `getUserMedia` with:
   `channelCount: { ideal: 1 }`, `sampleRate: { ideal: 48000 }`,
   `echoCancellation: { exact: false }`,
   `noiseSuppression: { exact: false }`, and
   `autoGainControl: { exact: false }`.
3. Read `MediaStreamTrack.getSettings()` and display the actual values.
4. Fail readiness when the context is not running, the applied channel count
   is not mono, the capture/context rate is incompatible with the selected
   profile, or any processing setting is `true`.
5. Register an `AudioWorkletProcessor` that batches fixed-size `Float32`
   capture chunks off the main thread. Never use `ScriptProcessorNode` for new
   capture code.

The UI should distinguish `idle`, `requesting`, `ready`, `failed`, and
`disconnected`. The failure panel must include the exact failing setting and a
single Reset/Re-arm action.

### Binary WebSocket Boundary

Keep bulk data out of JSON and base64. Use one fixed little-endian envelope:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | magic `FWAV` |
| 4 | 1 | protocol version `1` |
| 5 | 1 | message type |
| 6 | 2 | flags |
| 8 | 4 | payload byte length |
| 12 | 4 | stream/epoch ID |
| 16 | 8 | sequence or first sample index |
| 24 | 4 | sample rate; zero for non-PCM |
| 28 | 2 | channel count; zero for non-PCM |
| 30 | 2 | sample encoding/profile code |
| 32 | N | payload |

Phase 1 needs message types for `HELLO`, `AUDIO_SETTINGS`, `PCM_CAPTURE`,
`PCM_PLAYBACK`, `QUALIFICATION_CASE`, `QUALIFICATION_RESULT`, `ERROR`, and
`RESET`. Limit a WebSocket message to 256 KiB, cap capture/playback queues by
both bytes and time, reject mismatched declared lengths, and increment an epoch
on every reset so stale PCM/results cannot be accepted.

Browser-to-container is a localhost control/data path, not an acoustic peer
path. Later Compose topology must bind it only on each laptop's loopback
interface.

## Codec Qualification

### Deterministic Corpus

Generate corpus bytes from a committed seed and include:

- twenty unique 256-byte payloads per direction;
- five unique 1536-byte payloads per direction;
- all-zero, all-`0xff`, incrementing, alternating, and deterministic
  pseudo-random patterns;
- a SHA-256 manifest containing case ID, size, direction, and expected digest.

Every delivered result is keyed by `(epoch, direction, case_id)`. More than one
delivery for a case is a duplicate failure even if the digest matches.

### Cyrinx Gate

Run in this order and start the 90-minute clock before its first build:

1. Build the pinned portable C bulk codec and run its shipped golden vectors.
2. Modulate/demodulate the 256-byte and padded 1536-byte fixtures without
   hardware.
3. Send the corpus through the browser PCM bridge on one laptop using a
   cable/loopback or speaker-to-mic path.
4. Run both physical directions on the exact laptops from a cold receiver.

Pass only when:

- build and golden vectors pass;
- both directions cold-acquire;
- at least 19/20 unique 256-byte cases per direction are delivered once and
  byte-perfect;
- all 5/5 1536-byte cases per direction are delivered once and byte-perfect;
- p95 complete-payload airtime is below one third of the intended FIPS
  dead-link timeout;
- browser evidence reports mono 48 kHz and all processing disabled;
- queues stay inside configured bounds.

Do not implement a new incremental Cyrinx decoder or a WASM port during this
gate. Overlapping bounded batch windows are acceptable only when memory is
bounded and duplicate decoded blocks are suppressed.

### Fallback Gate

Use the existing browser-ready Quiet.js audible profile and run the same
corpus. Select a profile only if the unmodified prebuilt codec loads in current
Chromium and passes both directions. Freeze its profile name, volume, laptop
spacing, fragment payload ceiling, measured airtime, and browser version in
the report.

If neither Cyrinx nor Quiet passes the 1536-byte corpus by the gate deadline,
do not pretend the PHY is qualified. Keep the browser/bridge harness and use
`ggwave` only to prove mic/speaker plumbing while reporting a hard Phase 1
failure.

## Docker/TUN Preflight

The Compose preflight should:

- build from a pinned Linux base image;
- mount `/dev/net/tun:/dev/net/tun`;
- set `cap_add: [NET_ADMIN]`;
- set `security_opt: [no-new-privileges:true]`;
- avoid `privileged: true`;
- run a script that checks the device, creates `fips-preflight0`, assigns an
  IPv6 address, brings it up, prints `ip -details link show`, and deletes only
  that interface on exit.

Suggested verification:

```bash
docker compose -f compose.preflight.yml build
docker compose -f compose.preflight.yml run --rm tun-preflight
docker inspect fipwave-tun-preflight \
  --format '{{json .HostConfig.CapAdd}} {{.HostConfig.Privileged}}'
```

Expected evidence contains `NET_ADMIN` and `false`, never `SYS_ADMIN` or
privileged mode. Docker Desktop and Linux Engine may expose TUN differently;
run this exact command on both demo machines before integrating FIPS.

## Qualification Report

Write `.artifacts/qualification/<machine-id>.json` per laptop and a merged
`selection.json`. Required fields:

- UTC timestamp, OS, architecture, browser version, commit;
- actual audio context/track settings and device labels after permission;
- codec commit/profile and deadline elapsed time;
- each corpus case's digest, acquisition time, duration, delivery count, and
  result;
- queue high-water marks and discontinuities;
- Docker/TUN preflight result and effective capabilities;
- final decision: `cyrinx`, `quiet`, or `unqualified`, with machine-readable
  reason codes.

The UI should render the same evidence as a compact readiness checklist, but
the JSON files are canonical.

## Implementation Pitfalls

- Browser constraints are requests unless `exact` is supported; readiness must
  use applied settings, not the requested object.
- Chromium may resample between microphone hardware and the `AudioContext`.
  Record both rates and fail or explicitly resample at one controlled boundary.
- Laptop speakers and microphones often roll off high frequencies. Freeze an
  audible profile before testing an ultrasonic one.
- A batch decoder can return the same block from overlapping windows. Dedup by
  epoch, case/packet ID, and verified digest before counting delivery.
- Do not expose the local bridge on `0.0.0.0`; that could create a non-acoustic
  inter-laptop path and invalidate the demo.
- A 1536-byte qualification payload is an application of several codec blocks,
  not a requirement for one physical waveform.
- Do not grant the container `privileged` merely because Docker Desktop TUN
  behavior is inconvenient.

## Validation Architecture

### Test Layers

| Layer | Automated evidence | Manual/hardware evidence |
|-------|--------------------|--------------------------|
| Protocol | Header round-trips; malformed magic/version/type/length rejection; 256 KiB cap; epoch reset; queue overflow | None |
| Corpus/report | Reproducible manifest; digest mismatch; missing/duplicate case; threshold decision logic; JSON schema | Compare displayed report to each laptop |
| Browser states | Unit tests for settings evaluation; Playwright permission-denied and disconnected states; production build | One-click permission/audio arm, applied device settings |
| Codec | Pinned build; golden vectors; fixture PCM round-trips | Cold acquisition and corpus in both open-air directions |
| Docker | Compose config inspection; script shellcheck; Linux CI or local TUN run when available | Exact Docker Desktop/Linux Engine TUN result |

### Commands

The plan should make these commands real and keep them under two minutes except
for explicit hardware qualification:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run generate:corpus
npm run qualify:fixture
docker compose -f compose.preflight.yml config
docker compose -f compose.preflight.yml run --rm tun-preflight
```

Use fake `MediaTrackSettings` in unit tests and committed PCM fixtures in codec
tests. Do not make CI depend on a microphone, speaker, Docker daemon, or TUN.

### Phase Completion Rule

Automated validation may prove that the harness, gate logic, report schema, and
preflight are correct. The phase cannot honestly claim the selected codec works
on the exact demo laptops until the operator attaches two per-machine reports
and a merged bidirectional `selection.json`. If hardware is unavailable in the
workspace, verification must return `human_needed` with those precise actions;
it must not silently mark the physical gate passed.

## Sources Carried Forward

- `.planning/research/HIGH_THROUGHPUT_CODECS.md` — current codec decision,
  Cyrinx constraints, fallback posture, and corrected 1357-byte transport MTU.
- `.planning/research/STACK.md` — browser/WebSocket/Docker implementation
  patterns; its ggwave-first recommendation is explicitly superseded.
- Cyrinx, Hush, Quiet.js, `ggwave`, FIPS, Chromium/Web Audio, and Docker sources
  cited in those project-level research files.
