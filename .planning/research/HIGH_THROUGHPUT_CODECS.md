# High-Throughput Acoustic Codec Reassessment

**Project:** FIPS over Sound
**Researched:** 2026-07-23
**Trigger:** User challenged the original `ggwave` throughput assumption and
requested evaluation of Cyrinx and Hush.
**Confidence:** MEDIUM

## Conclusion

There is no FIPS-level reason to prefer a slow acoustic codec. Higher
throughput materially improves handshake timing, heartbeat stability, packet
latency, queue pressure, and the feasibility of carrying a standards-compliant
IPv6 MTU. The sound transport should remain codec-neutral and select the
highest-throughput implementation that passes a short, physical, bidirectional
hardware gate.

The original recommendation to make `ggwave` the default is superseded:

1. **Primary spike: Cyrinx 2 wideband bulk PHY.** Its measured goodput is in
   the right range for FIPS. Use its portable C batch codec in a native
   container-side worker and let the browser remain a deliberately dumb PCM
   capture/playback device over localhost WebSocket.
2. **Fallback: a browser-ready modem such as Quiet.js, if its existing audible
   profile passes immediately.** This trades maintenance maturity for a much
   smaller integration step.
3. **Diagnostic/bootstrap fallback: `ggwave`.** It remains useful for proving
   the browser audio path and exchanging very small control messages, but its
   stated 8–16 bytes/second is not an acceptable primary rate for FIPS.
4. **Do not make Hush the default.** Its MFSK modes do not solve the throughput
   problem, and its faster OFDM path has not been demonstrated over an
   open-air laptop channel.

## Comparison

| Candidate | Useful rate evidence | Browser fit | Link maturity | One-day verdict |
|-----------|----------------------|-------------|---------------|-----------------|
| Cyrinx 2 | 65.875 kbps scheduled byte-verified goodput with 98.48% block recovery in a MacBook-to-Pixel near-field campaign; older measured directions ranged roughly 17–39 kbps | No WASM or browser receiver; portable C can instead run in the container while browser streams PCM | Strong offline/batch PHY and golden vectors; streaming receiver, public peer API, and reliable bulk ARQ are not shipped | **Primary 90-minute physical spike**, with strict abandonment gate |
| Hush | MFSK useful rates remain around ggwave class; source-level estimates put OFDM raw rates around 2.46–21.3 kbit/s, but no open-air laptop goodput is published | Native Rust/CPAL/TCP runtime; no browser binding, input-capable WebAudio backend, or streaming WASM API | Framing/FEC/stop-and-wait exist, but fast OFDM is labeled development/loopback and lacks channel estimation, pilot tracking, clock recovery, and multipath equalization | **Reject as default**; optional experimental fallback only |
| Quiet.js | Profiles support higher-rate OFDM/GMSK operation, but current laptop-to-laptop measurements are not provided | Existing browser Web Audio binding and audible/ultrasonic examples | Browser-ready but repository is old and uses deprecated `ScriptProcessorNode` | **Fast integration fallback** if the prebuilt demo works unchanged on both laptops |
| `ggwave` 0.4.3 | Project states 8–16 bytes/second and a 140-byte variable-payload ceiling | Current WASM/JavaScript binding and browser examples | Mature for small messages, ECC included | **Too slow for primary FIPS transport**; retain for diagnostics/bootstrap |

## Cyrinx Evidence and Constraints

### Why it is attractive

- The shipped C ABI exposes coarse-grained geometry, modulation, and one- or
  two-channel demodulation functions.
- The PHY uses chirp synchronization, OFDM, pilot tracking, convolutional FEC,
  soft Viterbi decoding, and CRC-32 verification per 256-byte block.
- A 36–66 kbps acoustic link turns a FIPS handshake or ping from a
  tens-of-seconds event into a sub-second or low-single-digit-second burst.
- Apache-2.0 licensing is compatible with a demo fork.

### What the headline does not prove

- Published high-rate evidence is a near-field MacBook-to-phone route, not two
  laptops, broad room geometry, or a live duplex session.
- The strongest result used two receiver microphone channels and host-side
  batch decoding. Chromium may expose only a mono logical microphone.
- The current wideband profile occupies roughly 1.1–23 kHz and assumes native
  48 kHz PCM. Browser resampling, laptop speaker roll-off, speech processing,
  and clock behavior are unqualified.
- The current C receiver decodes a complete captured buffer. A stateful
  arbitrary-chunk streaming receiver is explicitly future roadmap work.
- Reliable bulk ARQ and the reusable public peer transport API are also future
  work. The older ultrasonic ARQ cannot simply be assumed to protect the
  high-rate bulk PHY.

### Demo-specific integration shortcut

Do not port Cyrinx to WebAssembly before tomorrow:

```text
microphone
  → AudioWorklet PCM chunks
  → localhost binary WebSocket
  → bounded container PCM ring/window
  → Cyrinx C batch demodulator worker
  → verified 256-byte blocks
  → FIPS-packet reassembly
  → SoundTransport receive

SoundTransport send
  → FIPS-packet fragmentation/padding
  → Cyrinx C modulator
  → PCM over localhost WebSocket
  → browser scheduled playback
  → speaker
```

At 48 kHz, even stereo 16-bit PCM is only 192 KB/s across localhost. That is
not the scarce link and is reasonable for a demo bridge. Keep PCM out of JSON;
use binary messages with sample index, channel count, sample rate, and
discontinuity flags.

The receiver shortcut may use overlapping bounded capture windows around chirp
detections or repeatedly batch-decode recent PCM. It is acceptable only if it
demonstrates bounded memory, no duplicate delivery, and repeated cold-start
acquisition during the spike.

## Hush Evidence and Constraints

- Internal `LinkFrame` supports arbitrary `Vec<u8>` payloads up to 2048 bytes.
  The public JSON TNC does not: `send_data` is text and `rx_pop` performs lossy
  UTF-8 conversion, so FIPS would require a new binary/base64 command or direct
  Rust API use.
- Hush supplies a 12-byte header, CRC-16, rate-1/2 convolutional FEC,
  interleaving, preamble, and stop-and-wait ARQ. Those mechanisms are useful
  but overlap the link envelope FIPS over Sound already needs.
- Existing ARQ uses a fixed two-second timeout, eight retries, and an ACK
  waveform lasting roughly 655 ms. The timeout is shorter than several useful
  frame-plus-ACK exchanges and would require correction.
- The fast OFDM demodulator uses fixed correlations but lacks the mechanisms
  that make Cyrinx survive real acoustic channels: channel estimation,
  equalization, pilots, sample-clock recovery, and multipath handling.
- Repository tests are exact/noiseless sample loopbacks. There is no published
  open-air or laptop-to-laptop goodput.
- The native runtime assumes CPAL audio, native threads, and a raw TCP control
  socket. Its browser/WASM path is not packaged, and browser microphone input
  is not provided by the CPAL WebAudio backend used by this design.

Hush is therefore a useful source of framing/ARQ ideas, not the primary PHY for
tomorrow.

## MTU Correction

The earlier 256-byte advertised FIPS MTU recommendation is also superseded.
FIPS's IPv6 adapter has 77 bytes of effective encapsulation overhead. A
standards-compliant 1280-byte IPv6 interface therefore requires a sound
transport MTU of at least **1357 bytes**.

The transport should:

- advertise 1357 bytes once the high-throughput PHY can carry it;
- fragment each opaque FIPS packet into codec blocks below the FIPS boundary;
- reassemble and CRC-verify the complete packet before delivery to FIPS; and
- initially constrain demo traffic to handshake, heartbeat, and one small ping
  even though the advertised MTU is larger.

If the selected PHY cannot carry a 1357-byte transport packet within the
liveness budget, that codec fails the demo gate rather than forcing an
unproven sub-minimum IPv6 MTU.

## Time-Boxed Selection Gate

### Cyrinx — 90 minutes

1. Build and run the portable C bulk codec and its golden-vector tests.
2. Generate and decode 256-byte and 1536-byte burst fixtures without hardware.
3. Through the browser PCM bridge, transmit 20 unique 256-byte blocks in each
   direction between the exact laptops.
4. Then transmit five distinct 1536-byte payloads in each direction.
5. Pass only if:
   - both directions acquire from a cold receiver;
   - at least 19/20 small bursts and 5/5 large payloads are byte-perfect;
   - p95 complete-frame time is comfortably below one third of the intended
     FIPS dead-link timeout;
   - the browser reports 48 kHz capture and processing controls are disabled;
   - no duplicate verified block is delivered.

If build, browser PCM plumbing, live acquisition, or mono hardware prevents
this result within 90 minutes, stop. Do not turn Cyrinx streaming work into a
new modem project.

### Fallback — 60 minutes

Run an unchanged browser-ready audible modem profile on the same payload
corpus. Select it only if it passes the same bidirectional byte-integrity gate.
`ggwave` may be used to validate permissions/playback/capture while this runs,
but not as proof of sufficient FIPS throughput.

## Architecture Consequence

The FIPS-facing transport contract must not mention Cyrinx, Hush, `ggwave`, or
Quiet. It exchanges complete opaque FIPS packets with a local modem bridge.
The bridge exposes:

- codec/profile identifier and readiness;
- advertised FIPS MTU;
- complete packet TX/RX;
- measured frame airtime and queue depth;
- integrity failures, acquisition failures, retries, and resets; and
- an explicit half-duplex turn state.

This preserves the ability to replace the PHY during the first hours without
rewriting the FIPS fork.

## Sources

- [Cyrinx repository](https://github.com/dweekly/cyrinx) — current C ABI,
  portable bulk PHY, measurements, roadmap maturity labels, tests, and license.
- [Cyrinx project site](https://cyrinx.org/) — measured modem design and
  hardware results.
- [Cyrinx roadmap](https://github.com/dweekly/cyrinx/blob/main/ROADMAP.md) —
  batch-versus-streaming state, on-device integration gaps, and future session
  and ARQ work.
- [Hush repository](https://github.com/kc1wzq/Hush) — frame, FEC, PHY, ARQ,
  audio runtime, tests, and control protocol.
- [ggwave repository](https://github.com/ggerganov/ggwave) — stated 8–16 B/s
  throughput, 140-byte payload limit, WASM bindings, and codec behavior.
- [Quiet.js official site](https://quiet.github.io/quiet-js/) — existing
  browser profiles and browser compatibility limitations.

---
*High-throughput codec reassessment for: FIPS over Sound*
*Researched: 2026-07-23*
