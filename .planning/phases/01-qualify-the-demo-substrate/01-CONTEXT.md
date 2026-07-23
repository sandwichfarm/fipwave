# Phase 1: Qualify the Demo Substrate - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Qualify the exact browser-audio, acoustic-codec, and Docker/TUN substrate that
later phases will integrate. This phase delivers a repeatable two-laptop
preflight and an evidence-backed codec selection; it does not yet add a FIPS
transport or implement the reliable link protocol.

</domain>

<decisions>
## Implementation Decisions

### Browser Audio Qualification
- Use one explicit operator action to request microphone permission, resume the
  audio context, and arm capture/playback in a Chromium-class browser.
- Request mono 48 kHz capture with echo cancellation, noise suppression, and
  automatic gain control disabled, then display the settings actually applied
  rather than assuming the constraints were honored.
- Treat an unavailable microphone, non-running audio context, incompatible
  sample rate/channel count, or enabled signal processing as a visible
  preflight failure.
- Run the same browser build and qualification flow in both acoustic directions
  on the exact two demo laptops.

### Codec Selection Gate
- Give Cyrinx one strict 90-minute qualification window; do not extend the
  spike into streaming-receiver or modem research.
- Exercise deterministic, unique 256-byte and 1536-byte payload corpora in
  both directions, including cold receiver acquisition and duplicate-delivery
  detection.
- Select Cyrinx only when both directions meet the documented byte-integrity,
  delivery-count, acquisition, and airtime thresholds; record the measurements
  and the selected profile.
- On any missed gate or expired time box, switch immediately to the
  browser-ready audible fallback and run the same corpus rather than using
  `ggwave` throughput as the FIPS proof.

### Browser and Codec Boundary
- Keep microphone capture and scheduled speaker playback in the browser while
  codec-neutral control and PCM move over binary localhost WebSocket messages.
- For Cyrinx, run the portable batch codec in a native/container-side worker;
  do not spend demo-day time on a WebAssembly port.
- Use timestamped, format-declared PCM chunks and bounded decode windows so
  discontinuities, queue growth, and duplicate batch results are observable.
- Preserve a codec-neutral qualification result describing profile, sample
  format, advertised transport MTU, measured airtime, and readiness so later
  phases do not depend on a Cyrinx-specific interface.

### Docker and Evidence Preflight
- Pin the runtime inputs used for qualification and make the preflight
  repeatable from repository commands instead of relying on manually prepared
  host state.
- Give the FIPS container `/dev/net/tun` and `NET_ADMIN` only; do not use
  privileged mode or grant an alternate inter-laptop network path.
- Prove TUN creation/configuration independently of FIPS before transport work
  begins, and expose a clear pass/fail result on both likely host combinations.
- Store machine-readable qualification evidence and a concise operator summary
  so codec selection and failures can be audited during rehearsal.

### the agent's Discretion
- Exact filenames, local ports, visual styling, and the internal shape of the
  qualification report are flexible so long as the one-action flow, binary
  boundary, hard gates, and reproducible evidence remain intact.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- No implementation code exists yet; the project research contains the Cyrinx,
  Hush, Quiet.js, `ggwave`, FIPS MTU, and browser-audio evidence needed to plan
  the qualification harness.

### Established Patterns
- Planning is a five-phase vertical MVP with codec neutrality, bounded queues,
  deterministic half-duplex operation, and evidence-driven gates treated as
  project-wide invariants.
- The newer high-throughput codec reassessment supersedes the earlier
  `ggwave`-first stack recommendation.

### Integration Points
- The qualification browser will become the audio frontend used by the local
  bridge in Phase 2.
- The selected codec/profile report will feed the reliable acoustic framing and
  timing parameters in Phase 3.
- Docker/TUN preflight becomes the base of the FIPS Compose topology in Phases
  2, 4, and 5.

</code_context>

<specifics>
## Specific Ideas

- Audible modem-like signalling is part of the demo's joke and is the required
  default, not merely a debugging mode.
- The demo target is two laptops, most likely two MacBooks or a MacBook plus a
  Linux laptop, using Docker and Chromium.
- The phase must optimize for tomorrow's demo: a failed high-throughput spike
  is useful only if it triggers the fallback quickly.

</specifics>

<deferred>
## Deferred Ideas

- Near-ultrasonic operation, polished visualization, multiplexed acoustic
  peers, and deliberate-interference resistance remain post-demo stretch work.

</deferred>
