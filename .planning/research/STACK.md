# Stack Research

**Domain:** Browser-mediated acoustic packet transport for FIPS
**Researched:** 2026-07-23
**Confidence:** MEDIUM

> **Superseding note:** The `ggwave`-first recommendation below was reassessed
> after evaluating Cyrinx and Hush. See
> [HIGH_THROUGHPUT_CODECS.md](./HIGH_THROUGHPUT_CODECS.md). The current
> recommendation is a codec-neutral bridge with a 90-minute Cyrinx 2 physical
> spike; `ggwave` is retained only as a diagnostic/bootstrap fallback.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `jmcorgan/fips` fork | `master` / `0.5.0-dev` at `fc8ebd5` | Mesh daemon, peer protocol, encryption, routing, heartbeat, and IPv6 TUN | This is the required integration target. Its transport API already exposes MTU, send, discovery, lifecycle, and link policy; the fork only needs an acoustic transport handle and configuration. |
| Rust | `1.94.1+` | FIPS sound transport and local WebSocket endpoint | Matches upstream's pinned minimum toolchain and keeps packet delivery directly inside the daemon rather than adding a second native service. |
| `ggwave` WebAssembly/JavaScript binding | `0.4.3` | Audible and ultrasonic FSK modulation/demodulation in the browser | Current release, active browser demos, binary payload support, Reed-Solomon ECC, audible and ultrasonic profiles, and no native audio backend requirement. It is the lowest-risk codec to prove over-air bytes today. |
| Web Audio API | Browser-provided | Microphone capture, sample processing, and speaker playback | Available in Chromium-class browsers and deliberately owns all host audio interaction. `AudioWorklet` provides off-main-thread low-latency processing where needed. |
| WebSocket | RFC 6455; `tokio-tungstenite` current compatible release | Binary packet bridge between browser and Dockerized FIPS | Browser-native, bidirectional, message-framed, easy to expose as a single localhost Docker port, and substantially simpler than WebRTC or custom HTTP polling. |
| Docker / Docker Compose | Current Docker Desktop or Engine | Reproducible FIPS node and bridge runtime | Meets the cross-platform architecture constraint and makes the exact FIPS fork/config repeatable on both laptops. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tokio-tungstenite` | Resolve against Tokio 1 and current Rust toolchain | Async WebSocket server within the FIPS sound transport | Add only for the browser bridge; bind the host-published port to loopback where Docker permits. |
| `futures-util` | Compatible current release | WebSocket stream/sink helpers | Use with `tokio-tungstenite` for binary frame ingress/egress tasks. |
| Browser `crypto.getRandomValues` | Browser-provided | Acoustic frame/session identifiers | Use for a per-page session ID so a receiver can ignore stale or self-originated fragments. |
| CRC-32 implementation | Tiny local implementation or a small maintained package | Fast fragment corruption detection before reassembly | Use in the link envelope even though ggwave includes ECC; CRC makes acceptance/rejection explicit and codec-independent. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Chromium/Chrome DevTools | Inspect permissions, selected audio settings, WebSocket frames, and timing | Log `MediaStreamTrack.getSettings()` because requested audio constraints may be ignored. |
| `fipsctl` / `fipstop` | Observe transport, connection, peer, heartbeat, loss, and MTU state | Treat peer establishment and link survival as gates before attempting ping. |
| `tcpdump` inside the container namespace | Prove ICMPv6 enters and exits `fips0` | Capture evidence during rehearsal without relying only on UI state. |
| Recorded WAV loopback fixture | Deterministic codec testing without room acoustics | First validate encode/decode from generated samples, then speakers across a desk, then the demo room. |

## Installation

```bash
# Browser codec
npm install ggwave@0.4.3

# FIPS fork additions
cargo add tokio-tungstenite futures-util

# Upstream FIPS build
cargo build --release
```

Pin the FIPS fork commit and JavaScript lockfile once the first end-to-end link
works. Avoid dependency upgrades after the demo configuration is rehearsed.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `ggwave` 0.4.3 | Quiet.js / libquiet | Use only if a same-day spike proves `ggwave` throughput cannot keep FIPS handshake and ping within tuned timeouts and the prebuilt Quiet.js bundle still receives reliably in the exact Chrome/Mac hardware pair. Quiet offers more modem/profile flexibility and larger frames, but its repository's latest commit is from 2021 and it uses deprecated `ScriptProcessorNode`. |
| Browser-side codec | Rust/native codec inside Docker | Use for a later production iteration with host audio device plumbing; it violates the project's portability shortcut for tomorrow. |
| WebSocket bridge | WebRTC data/audio | Use only for remote browser-to-browser networking, which would invalidate the claim that packets cross the physical acoustic hop and adds unnecessary signaling complexity. |
| Half-duplex scheduled acoustic MAC | Attempted simultaneous full duplex | Consider full duplex only with headphones, separated frequency bands, or proven echo cancellation. Laptop speakers feed directly into their own microphones, so a token/turn-taking link is far more predictable. |
| Link-local fragment/reassembly | Report a tiny FIPS MTU | Use a small reported MTU only for protocol experiments. The IPv6-facing demo needs a usable path and FIPS does not perform transit fragmentation. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| A custom modem/DSP implementation from scratch | Synchronization, frequency drift, ECC, and room-acoustic tuning will consume the entire deadline | Start with `ggwave` WASM and tune its existing profiles |
| Quiet.js as the untested default | Stale build, older Emscripten output, deprecated `ScriptProcessorNode`, and documented receiver/browser limitations raise demo risk | `ggwave` 0.4.3; retain Quiet.js as a time-boxed throughput fallback |
| `ScriptProcessorNode` for new audio work | Runs on the main thread and is deprecated, increasing glitch risk | `AudioWorklet` or the codec's proven current Web Audio integration |
| WebRTC echo cancellation | It is optimized for speech and may erase modem tones; WebRTC also creates an alternate network path | Raw `getUserMedia` audio with processing constraints requested off |
| Browser audio defaults | Echo cancellation, noise suppression, and AGC can distort steady multi-tone signals | Request all three off and display the actual applied track settings |
| A single 1280-byte acoustic burst | `ggwave` variable payloads max out at 140 bytes and long bursts magnify loss/retry cost | Fragment complete FIPS packets into short sequenced acoustic frames and reassemble below FIPS |
| Unbounded retries | A noisy room can lock the link forever and make the demo appear frozen | Bounded stop-and-wait retries, visible counters, explicit reset/reconnect |

## Stack Patterns by Variant

**For the must-work audible demo:**

- Use `ggwave` audible fast or fastest only after a short calibration chooses the
  fastest profile with repeatable decoding.
- Keep acoustic fragment payloads at or below roughly 96 bytes, leaving room for
  link identifiers, packet/fragment sequence, lengths, flags, and CRC within
  ggwave's 140-byte variable-payload ceiling.
- Use a half-duplex token or stop-and-wait exchange so acknowledgements and FIPS
  reply traffic do not collide with outbound tones.
- Tune FIPS handshake resend, heartbeat interval, and dead-link timeout to the
  measured acoustic serialization time. Default 10-second heartbeat and
  30-second dead timeout are unsafe when 8–16 bytes/second is possible.

**For opportunistic near-ultrasonic mode:**

- Switch only the ggwave protocol/profile and retain the same link envelope,
  fragmentation, bridge, and FIPS transport.
- Calibrate on the exact laptops; speaker/microphone response near 15–20 kHz
  varies materially.
- Never make ultrasonic success a prerequisite for the audible demo.

**If ggwave is too slow after a two-hour vertical spike:**

- Test the prebuilt Quiet.js audible profile in Chrome-to-Chrome before changing
  architecture.
- Adopt it only if it carries the actual FIPS handshake frames and a fragmented
  ping with lower wall-clock latency and no regression in repeated decode rate.
- Do not spend the deadline rebuilding or modernizing Quiet.js.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| FIPS `0.5.0-dev` master | Rust `1.94.1+`, edition 2024 | Upstream states this minimum; pin the inspected fork base. |
| `ggwave` `0.4.3` | WebAssembly + Web Audio in Chromium | Current repository includes JavaScript bindings and browser examples; variable payload maximum is 140 bytes. |
| `AudioWorklet` | Chromium secure context | Widely available, but requires a secure context. `http://localhost` is normally treated as trustworthy; verify with the actual Docker-hosted URL. |
| `getUserMedia` | User permission + secure context | Permission is mandatory. Constraints such as echo cancellation may be treated as preferences unless requested as exact, so inspect applied settings. |
| Quiet.js master | Chrome receiver; older Emscripten/Web Audio stack | Official docs say Safari cannot receive and ultrasonic receive has browser limitations; latest repository commit inspected is 2021-05-19. |

## Feasibility Notes

- FIPS handshake packets are 114 and 69 bytes, which fit individually under
  ggwave's 140-byte variable payload limit. Established FIPS packets and normal
  ICMPv6 echo packets may not, so general fragment/reassembly is still required.
- The ggwave project describes typical throughput as 8–16 bytes/second. At that
  rate a 114-byte handshake burst consumes roughly 7–14 seconds before retries,
  and a 1280-byte burst would consume 80–160 seconds. Short fragments, tuned FIPS
  timers, collision avoidance, and a small ping payload are therefore functional
  requirements rather than optimizations.
- FIPS reports per-link MTU but performs no transit fragmentation. The sound
  transport can advertise a FIPS MTU large enough for the demo while privately
  splitting each complete transport packet into codec-sized fragments.
- “Duplex” should mean bidirectional packet service, not simultaneous acoustic
  transmission. Half-duplex turn-taking still supports FIPS handshake,
  heartbeats, and ping replies.

## Sources

- [FIPS repository and documentation](https://github.com/jmcorgan/fips) — current
  upstream status, Rust minimum, transport support, heartbeat defaults, MTU model,
  transport trait, and packet framing inspected at `fc8ebd5`.
- [ggwave repository](https://github.com/ggerganov/ggwave) — version 0.4.3,
  browser/WASM examples, audible and ultrasonic protocols, ECC, 8–16 B/s stated
  bandwidth, and payload limits inspected at `060aec7`.
- [Quiet.js official site](https://quiet.github.io/quiet-js/) — browser support,
  audible/ultrasonic modes, profile system, and receiver limitations.
- [Quiet Modem documentation](https://quiet.github.io/docs/quiet/) — FEC,
  checksums, profile tuning, and intended short-range use.
- [MDN AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
  — secure-context and off-main-thread audio processing behavior.
- [MDN media constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints)
  — echo cancellation, noise suppression, AGC, sample-rate, and channel
  constraints.
- [MDN `getUserMedia`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
  — microphone permission and secure-context requirements.

---
*Stack research for: FIPS over Sound*
*Researched: 2026-07-23*
