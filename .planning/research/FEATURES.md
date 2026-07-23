# Feature Research

**Domain:** Browser-mediated acoustic networking as a FIPS transport
**Researched:** 2026-07-23
**Confidence:** MEDIUM

## Feature Landscape

For this one-day proof of concept, “reliable” means that two rehearsed laptops
can establish a FIPS peer, keep it alive long enough, and exchange a real
OS-level IPv6 echo request and reply while the isolated node has no other
transport. It does not mean production modem reliability, arbitrary traffic, or
an unattended connection.

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| First-class sound transport in the FIPS fork | The demo is only genuine if normal FIPS peering, handshake, heartbeat, and packet delivery use the acoustic link | HIGH | Make the smallest transport-enum/dispatch change possible. Preserve FIPS packet bytes and existing identity, encryption, routing, lifecycle, and connection policy. |
| Binary browser-to-container bridge in both directions | FIPS runs in Docker while the browser exclusively owns microphone and speaker I/O | MEDIUM | Use one local binary WebSocket per node and explicit message types for packet, link state, and errors. `ArrayBuffer` is directly supported by browser WebSockets. Do not base64-encode packets. |
| One-click browser audio start with actionable failure states | Microphone permission and audio autoplay rules otherwise cause silent demo failure | LOW | Serve from `localhost` or HTTPS, request microphone permission, create/resume audio from a click, and visibly report permission denied, suspended audio, missing bridge, and lost microphone. Pre-authorize both laptops during rehearsal. |
| Deterministic audible codec at one fixed profile | A recognizable acoustic carrier is the actual medium and part of the demo | MEDIUM | Prefer an already working browser/WASM modem profile over inventing modulation. Fix sample rate/profile/frequencies before rehearsal. Optimize for successful small messages, not throughput. |
| Raw-ish microphone capture settings | Speech-oriented browser DSP can alter modem tones | LOW | Request mono capture with `echoCancellation: false`, `noiseSuppression: false`, and `autoGainControl: false`, then display actual track settings. Constraints are preferences/capabilities, so verify what Chromium granted on each laptop. |
| Short, self-delimiting link frames with integrity checks | Room noise, clipping, missed starts, and partial captures must not become corrupted FIPS packets | MEDIUM | Each acoustic unit needs a recognizable start marker/preamble plus version/type, packet ID, fragment index/count, length, and CRC/checksum. Existing codec ECC is useful but does not replace positive packet integrity. |
| Link-layer fragmentation and bounded reassembly | Complete FIPS packets and IPv6's effective 1280-byte minimum cannot sensibly be one long acoustic burst | HIGH | Fragment below the FIPS transport boundary; deliver to FIPS only after every fragment passes integrity checks. Use small fixed payload fragments and hard limits on packet size, fragment count, reassembly memory, and expiry. |
| Bounded stop-and-wait ACK/retry with duplicate suppression | A single missed acoustic fragment must not force a manual restart or silently stall the peer | HIGH | One fragment in flight, ACK by packet/fragment ID, short timeout, small retry cap, idempotent duplicate handling. Fail/drop cleanly after the cap. This is slower but dramatically simpler than windows or streaming ARQ. |
| Half-duplex turn-taking | Two laptop speakers and microphones share one acoustic room and will otherwise collide or self-receive | MEDIUM | Bidirectional is mandatory; simultaneous full duplex is not. Serialize data and ACK bursts, add short guard intervals, suppress local receive while transmitting if necessary, and give ACK/control traffic priority over queued data. |
| Complete-packet delivery and bounded backpressure into FIPS | FIPS must see whole transport packets, while the acoustic link may take seconds to clear one | MEDIUM | Queue only a small number of FIPS packets. Expose an honest conservative link MTU while internally fragmenting as required. Drop with a visible error instead of allowing unbounded growth. |
| End-to-end real IPv6 ping acceptance test | Application-level echo or a staged UI animation does not prove FIPS-over-sound | MEDIUM | Use a small/default-size ping, a generous timeout, and preferably one probe at a time. Pass only when the OS sends the echo request and receives the echo reply through FIPS. |
| Demonstrable receiver isolation | Observers must be able to trust that sound is the only path to the receiving node | LOW | Disable/unplug Wi-Fi/Ethernet or otherwise remove all non-sound FIPS transports on the isolated node, then show the state before pinging. Container localhost access to its browser bridge is allowed and should be explained. |
| Minimal operational telemetry and reset | A live acoustic demo needs fast diagnosis and recovery | LOW | Show bridge/audio/FIPS-link state, TX/RX packet and fragment counts, CRC failures, retries, and last error. Provide a single reset/reconnect action. A waveform visualizer is not required. |
| Rehearsed two-laptop launch procedure | Hardware permissions, Docker networking, device choice, volume, and room acoustics are the likely failure points | MEDIUM | Pin browser family and known hardware, specify laptop placement/volume, preflight each direction, include exact start order and success indicators, and retain a known-good audible profile. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Real OS-level IPv6 ping across sound | Turns a sound-transfer trick into proof that an existing encrypted mesh can use an absurd physical transport | HIGH | This is the primary differentiator and the only one that may consume core-demo time. |
| Genuine air-gapped receiving peer | Makes the acoustic hop credible rather than merely decorative signaling alongside a network path | LOW | Show transport state and isolation plainly; avoid an elaborate verification UI. |
| Audible “modem conversation” | Gives the demo immediate theatrical and meme value—the audience can hear request, ACKs, and reply | LOW | Keep tones comfortable and bursts short enough for a room demo. This is the default, not a debug fallback. |
| Compact live link counters | Lets the audience see fragments/retries become a real FIPS packet without pretending the link is fast | LOW | Add only after ping is stable. A few status badges/counters are enough. |
| Near-ultrasonic profile | Demonstrates that the same transport can be less obtrusive | MEDIUM | P2 only after repeated audible success. Laptop frequency response and browser processing must be tested on the exact devices; never replace the known-good audible profile. |
| Graceful retry made audible | A dropped/noisy fragment followed by recovery reinforces that this is a real link | LOW | This is emergent value from required ARQ, not a planned failure stunt. Do not deliberately inject loss during the final demo unless rehearsal proves it safe. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Simultaneous full-duplex audio | Feels like a “real” network and might reduce latency | Creates echo, collision, cancellation, and arbitration problems on consumer laptops; unnecessary for bidirectional ping | Use deterministic half-duplex stop-and-wait with short ACKs and guard intervals |
| High throughput or large-payload support | Makes the modem appear generally useful | Drives risk into modulation, buffering, MTU, and error recovery; even a mature small-data codec such as ggwave documents only 8–16 bytes/sec | Optimize for FIPS handshake/control frames and one small ping |
| Designing a novel modem/DSP stack | Offers control and engineering novelty | Synchronization and room/hardware tolerance can consume the entire day | Integrate a proven browser/WASM codec or the smallest already-demonstrated FSK implementation |
| Adaptive baud rate, frequency hopping, or automatic channel selection | Promises robustness across rooms and devices | Multiplies states and test combinations and can make failures non-reproducible | Pick one conservative audible profile on the exact demo laptops |
| Near-ultrasonic as the default | Seems magical and avoids annoying tones | Laptop speakers/microphones and audio processing vary near their frequency limits; it also hides the theatrical signal | Ship audible first; expose ultrasonic only as a rehearsed optional toggle |
| Heavy FEC or multiple recovery schemes | Appears to maximize reliability | Adds latency and tuning complexity; it can mask but not positively acknowledge loss | Use codec-provided ECC if already available, plus CRC and bounded stop-and-wait ARQ |
| General-purpose TCP/file/web browsing demo | Sounds more impressive than ping | Sustained or bursty traffic will overrun a tiny acoustic link and distract from transport proof | Send one OS-level IPv6 ping with generous timeout |
| Multi-peer discovery or acoustic addressing | Suggests a reusable mesh medium | Not needed for a fixed two-node link and introduces collision/addressing state | Hard-configure exactly one acoustic peer pair |
| Polished spectrum/waveform visualization | Looks good on stage | Consumes integration time and can increase main-thread/audio risk without proving transport correctness | Show compact states and counters; let the audience hear the tones |
| Broad browser, mobile, and hardware support | Improves portability claims | Expands permission, audio, sample-rate, and Docker test matrices beyond one day | Pin Chromium and the two actual demo laptops |
| Production security and hostile-interference resistance below FIPS | “Air-gapped” invites security discussion | FIPS already owns identity/encryption; anti-jamming and acoustic authentication are separate projects | Preserve FIPS security unchanged and use CRC only for link integrity |
| Automatic setup with no user gesture | Makes startup look seamless | Browsers require microphone permission and commonly gate Web Audio playback on interaction | One explicit “Start modem” action with clear preflight status |

## Feature Dependencies

```text
[Rehearsed two-laptop launch]
    └──requires──> [One-click browser audio + fixed audible profile]
                       └──requires──> [Raw-ish capture settings]

[Real OS-level IPv6 ping]
    └──requires──> [Normal FIPS peer link]
                       └──requires──> [First-class FIPS sound transport]
                                          └──requires──> [Binary browser/container bridge]
                                          └──requires──> [Complete-packet delivery/backpressure]
                                                                 └──requires──> [Fragmentation/reassembly]
                                                                                    └──requires──> [Self-delimiting frames + CRC]
                                                                                    └──requires──> [Stop-and-wait ACK/retry]
                                                                                                       └──requires──> [Half-duplex turn-taking]

[Credible demo] ──requires──> [Receiver isolation]
[Compact telemetry] ──enhances──> [Rehearsal and live recovery]
[Near-ultrasonic profile] ──requires──> [Stable audible end-to-end ping]

[Simultaneous full duplex] ──conflicts──> [One-day reliability]
[Novel/adaptive modem] ──conflicts──> [Fixed rehearsed profile]
[Large/general traffic] ──conflicts──> [Bounded low-rate queue]
```

### Dependency Notes

- **Ping requires the FIPS link, not merely the codec:** Validate the vertical
  slice in increasing order: bytes across the bridge, one acoustic frame each
  direction, acknowledged fragments, one complete FIPS packet, FIPS peering,
  then ping.
- **Fragmentation requires integrity and ARQ:** Reassembly must never inject a
  partial or corrupt packet into FIPS. Fragment IDs and duplicate suppression
  are necessary because an ACK can be lost even after a fragment arrived.
- **ARQ requires half-duplex scheduling:** With one acoustic channel, the sender
  must yield for the ACK and the receiver must know when it may transmit.
- **FIPS control traffic and ping share a bounded queue:** Handshake, heartbeat,
  and ACK/control traffic must not sit behind avoidable bulk data. Avoid
  generating any other traffic during the demo.
- **Near-ultrasonic requires stable audible mode:** It is a separate
  hardware/profile validation task, not part of establishing the base link.
- **Operational telemetry enhances reliability:** Counters and last-error state
  shorten rehearsal feedback loops, but should be added only after the
  underlying events exist.

## MVP Definition

### Launch With (v1)

- [ ] First-class FIPS sound transport with normal handshake, heartbeat,
      lifecycle, and complete packet delivery — proves this is a FIPS transport.
- [ ] Local binary WebSocket bridge to a one-click Chromium audio page — meets
      the Docker/browser boundary without native host audio.
- [ ] One conservative audible codec profile with microphone processing
      requested off — establishes a reproducible physical carrier.
- [ ] Short framed fragments with CRC, bounded reassembly, stop-and-wait
      ACK/retry, duplicate suppression, and half-duplex scheduling — minimum
      reliability layer for a lossy room channel.
- [ ] Bounded packet queue plus basic state/error/retry counters — prevents a
      slow link from failing opaquely.
- [ ] Offline receiving laptop and a real single-probe OS-level IPv6 ping with
      reply — the milestone acceptance test.
- [ ] Exact two-laptop preflight and launch procedure — makes the result
      rehearsable tomorrow.

### Add After Validation (v1.x)

- [ ] Near-ultrasonic fixed profile — only after audible ping succeeds
      repeatedly on both exact laptops.
- [ ] Minimal audience-facing packet/fragment counters — only after telemetry
      already exists and cannot destabilize audio.
- [ ] Faster fixed audible profile or tuned fragment size — only if at least ten
      consecutive default-size ping exchanges pass at the conservative profile.
- [ ] Intentional loss/retry demonstration — only if recovery has substantial
      rehearsal margin; otherwise let natural retries speak for themselves.

### Future Consideration (v2+)

- [ ] Sliding-window ARQ and higher throughput — requires systematic channel
      testing and congestion/backpressure design.
- [ ] Adaptive modulation/frequency selection — requires capability probing and
      cross-hardware validation.
- [ ] Multi-peer acoustic discovery/addressing — unnecessary for the
      point-to-point proof.
- [ ] Mobile and broad browser support — expands the device and permission
      matrix substantially.
- [ ] Production interference resistance and acoustic security — separate from
      preserving FIPS's existing encrypted packet semantics.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| First-class FIPS sound transport | HIGH | HIGH | P1 |
| Binary browser/container bridge | HIGH | MEDIUM | P1 |
| One-click audio permission/start flow | HIGH | LOW | P1 |
| Fixed audible codec profile | HIGH | MEDIUM | P1 |
| Raw-ish capture constraints and settings display | HIGH | LOW | P1 |
| Framing, CRC, fragmentation, and bounded reassembly | HIGH | HIGH | P1 |
| Stop-and-wait ARQ, duplicate suppression, half-duplex scheduling | HIGH | HIGH | P1 |
| Bounded queue/backpressure | HIGH | MEDIUM | P1 |
| Real IPv6 ping and isolated receiver | HIGH | MEDIUM | P1 |
| Rehearsed launch/preflight | HIGH | MEDIUM | P1 |
| Basic status/error/retry counters and reset | HIGH | LOW | P1 |
| Audience-facing telemetry polish | MEDIUM | LOW | P2 |
| Near-ultrasonic fixed profile | MEDIUM | MEDIUM | P2 |
| Faster profile/tuning | LOW | MEDIUM | P2 |
| Full duplex, adaptive modem, multi-peer, broad platform support | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for tomorrow's demo
- P2: Attempt only after repeated audible end-to-end success
- P3: Explicitly defer

## Competitor Feature Analysis

These are implementation reference points, not direct product competitors.

| Feature | ggwave | minimodem | FIPS over Sound Approach |
|---------|--------|-----------|--------------------------|
| Acoustic primitive | Small-data multi-frequency FSK with Reed-Solomon ECC and start/end markers | General-purpose FSK with configurable baud/framing and standard modem profiles | Reuse a proven primitive/profile; do not invent modulation |
| Browser fit | Provides WebAssembly/JavaScript Web Audio examples; waveform generation/analysis is separate from audio backend | CLI/native audio backends, not aligned with the browser-only I/O constraint | Browser owns capture/playback and bridges binary packets locally to Docker |
| Documented rate/scope | 8–16 bytes/sec, explicitly for small amounts of data | Configurable real-time byte stream | Accept very low throughput and constrain traffic to FIPS control plus one ping |
| Error handling | Reed-Solomon ECC improves demodulation robustness | Framing/configuration; link protocol is left to integrator | CRC plus fragment IDs, bounded reassembly, ACK/retry, and duplicate suppression below FIPS |
| Bidirectional networking | Application must orchestrate direction and session semantics | Separate transmit/receive operation; networking semantics left to integrator | Deterministic half-duplex point-to-point link carrying complete FIPS transport packets |
| IPv6/FIPS proof | None | None | Real OS-level IPv6 echo request/reply across an isolated FIPS peer is the differentiator |

## Sources

- [Project definition and constraints](../PROJECT.md) — primary project source;
  HIGH confidence.
- [RFC 8200, IPv6 Specification, Section 5](https://www.rfc-editor.org/rfc/rfc8200.html#section-5)
  — IPv6 requires a 1280-octet minimum link MTU and link-specific fragmentation
  below IPv6 where needed; HIGH confidence.
- [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
  — defines audio constraints including echo cancellation, automatic gain
  control, noise suppression, latency, sample rate, and channel count; HIGH
  confidence.
- [MDN: `getUserMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
  — secure-context and explicit microphone-permission requirements; HIGH
  confidence.
- [MDN: Web Audio autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
  — playback initiated outside user interaction is subject to autoplay rules;
  HIGH confidence.
- [MDN: AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
  — separate-thread, low-latency custom audio processing; HIGH confidence for
  browser capability, MEDIUM confidence that it is needed for the final codec.
- [MDN: WebSocket `binaryType`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/binaryType)
  — browser WebSockets receive binary messages as `ArrayBuffer`; HIGH
  confidence.
- [ggwave official repository](https://github.com/ggerganov/ggwave) — documents
  browser examples, 8–16 bytes/sec, FSK, ECC, audible and ultrasonic profiles,
  and its waveform-only responsibility; HIGH confidence for ggwave features.
- [minimodem documentation](https://kamalmostafa-minimodem.mintlify.app/introduction)
  — documents configurable FSK framing and native real-time/file audio
  workflows; MEDIUM confidence (project documentation, used only as an
  ecosystem reference).

## Research Gaps

- The exact FIPS sound-transport packet sizes, heartbeat cadence, queue behavior,
  and configurable MTU must be measured in the fork before choosing fragment
  size and retry timing.
- No documentation can establish which audible or near-ultrasonic profile works
  on the two actual laptops in the demo room. That requires same-day empirical
  testing in both directions.
- Browser audio constraints may not be honored identically across devices.
  Inspect `MediaStreamTrack.getSettings()` and validate the captured spectrum.
- The best codec choice depends on a rapid spike with real FIPS frame sizes.
  This research recommends the required capabilities, not an untested promise
  that any one library will meet the deadline.

---
*Feature research for: browser-mediated acoustic networking as a FIPS transport*
*Researched: 2026-07-23*
