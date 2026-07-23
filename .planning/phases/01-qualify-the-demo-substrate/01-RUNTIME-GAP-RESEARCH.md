---
phase: 01-qualify-the-demo-substrate
topic: executable-acoustic-runtime-gap
researched: 2026-07-23
status: ready-for-gap-planning
---

# Executable Acoustic Runtime Gap Research

## Why this exists

The early Phase 1 verifier found that the deterministic protocol, UI-state,
fixture, report, and Docker/TUN layers pass, but no production process can run
the two-laptop acoustic qualification. This document fixes the implementation
target before gap planning. It does not claim physical success.

## Locked recovery decision

1. Keep Cyrinx as a strict, early-abandonment primary spike using only its
   portable C batch PHY.
2. Ship Quiet.js as the actually runnable browser fallback using one fixed
   intentionally audible profile.
3. Add one loopback-only production UI/bridge runner, real corpus scheduling,
   canonical Open-air report creation, and a CLI that matches the documented
   named options.
4. Return to the exact-laptop checkpoint only after an unmocked local browser
   reaches the real runner and both codec paths have deterministic smoke tests.

## Cyrinx: minimal honest spike

Pin Cyrinx release `v2.0.0`, commit
`ddbd0ce4f78963403f96b0100eb49950b544aef8`.

Use one fixed mono 48 kHz batch profile:

| Parameter | Value |
| --- | --- |
| Band | 1.1–23 kHz |
| Modulation / FEC | QPSK, rate 1/2 |
| FFT / cyclic prefix | NFFT 2048, CP 768 |
| Data symbols / pilot spacing | 18 / 8 |
| Waveform peak | 0.18 |
| Payload geometry | 1,792 bytes (7 × 256-byte blocks) |
| Encoded frame | 62,464 Float32 samples, 1.301 s |
| Encoded PCM bytes | 249,856 bytes |

The frame fits the existing 256 KiB FWAV cap and carries a 256-byte metadata
block plus a 1,536-byte corpus case. Use block 0 for magic/version, epoch,
literal direction, case ID, length, and SHA-256; application data occupies the
remaining blocks. Require validity for every relevant block.

Build a small cross-platform C CLI around:

- `cyrinx_bulk_compute_geometry`
- `cyrinx_bulk_modulate`
- `cyrinx_bulk_demodulate_with_block_validity`

The browser sends timestamped mono Float32 capture batches to a bounded native
window. The worker batch-decodes approximately 2–3 seconds, deduplicates by
epoch/direction/case ID, and emits validated results. Playback uses the left
speaker channel only, with the right channel zeroed, followed by about 300 ms
of scheduled silence.

Hard-abandon Cyrinx before the full corpus if any of these fail:

- pinned C build and golden/digital round trip;
- one cold open-air frame A → B;
- one cold open-air frame B → A.

Do not implement Swift integration, WASM, arbitrary-chunk streaming decode,
MRC/stereo capture, adaptive profiles, Cyrinx sessions, or ARQ for this demo.

Primary sources:

- https://github.com/dweekly/cyrinx/releases/tag/v2.0.0
- https://github.com/dweekly/cyrinx/blob/ddbd0ce4f78963403f96b0100eb49950b544aef8/Sources/CCyrinx/include/cyrinx/cyrinx_bulk.h
- https://github.com/dweekly/cyrinx/blob/ddbd0ce4f78963403f96b0100eb49950b544aef8/Sources/CCyrinx/cyrinx_bulk.c
- https://github.com/dweekly/cyrinx/blob/ddbd0ce4f78963403f96b0100eb49950b544aef8/scratch/hw20k/clib.py
- https://github.com/dweekly/cyrinx/blob/ddbd0ce4f78963403f96b0100eb49950b544aef8/docs/ACOUSTIC_BULK_PHY.md

## Quiet.js: runnable fixed fallback

Pin `quiet/quiet-js` commit
`72782542a41f1b615a02c2ab43a0edb56edb6ce4`. It has no suitable npm package;
fetch the classic-script assets by exact URL and verify SHA-256 before use.

| Asset | SHA-256 |
| --- | --- |
| `quiet.js` | `9b5764bac759e508b7f66f08f2325f05942d5c11b11af7b14060885405dc441e` |
| `quiet-emscripten.js` | `57393f3f96e724ac6b45167c049660dffd96916e0100c587dd9c7b4301ad5527` |
| `quiet-emscripten.js.mem` | `ceabdfd9a9a3e9780466934da2a38b2df82e21a95148fc7e16c8cf05e077a7a7` |
| `quiet-profiles.json` | `44ff44061577fd473565c702fb5dda0624c1fb4f2d16fc63a60e0d6fa1b7e6bf` |
| Quiet `LICENSE` | `135138cd4304aa637836758dc5edfb5f21b7d09ecc637d25288d206b151a5768` |
| Quiet `LICENSE-3RD-PARTY` | `ff4e4efcbcddde5cbc1aaf2b69ee40fceaeabdc715cba84cfcb47693ed884bbe` |
| libfec 1.0 `libfec.js` | `a6a437efb5b13755cd4e27420e3d21383427bd3c7406137664f9f6e321303ffe` |
| libfec LGPL notice (`lesser.txt` at commit `9750ca0a6d0a786b506e44692776b541f90daa91`) | `0b62e767be034b3fe9c6baea15592459ca7fa9fcf060e48b80a3b0b361b8288b` |

Use stock profile `audible-7k-channel-0` with `clampFrame: true`.

- It is intentionally audible and centered near 9.2 kHz.
- Current Chromium smoke testing initialized Quiet, created transmitter and
  receiver, and emitted 1,536 bytes in about 5.49 seconds. This is not an
  open-air goodput claim.
- Runtime clamping produced a 253-byte acoustic frame. Use a 32-byte
  application envelope and at most 221 payload bytes per fragment.
- Deduplicate by `(epoch, sender, case, fragment index)`, reassemble only when
  complete, then validate the corpus SHA-256.

Quiet privately owns its `AudioContext` and microphone. It cannot consume the
existing worklet stream without a larger fork. Implement it as an exclusive
audio mode:

1. reset and close the existing browser audio lifecycle;
2. start Quiet with a small audited compatibility shim that requests mono,
   48 kHz, and disables echo cancellation, noise suppression, and AGC;
3. retain and display the applied Quiet track settings;
4. explicitly stop Quiet tracks/context on reset;
5. never run both audio pipelines concurrently.

Preserve Quiet BSD-3-Clause, bundled MIT notices, and dynamically loaded
libfec LGPL-2.1 notice.

Primary sources:

- https://github.com/quiet/quiet-js/tree/72782542a41f1b615a02c2ab43a0edb56edb6ce4
- https://github.com/quiet/libfec/releases/tag/1.0
- https://quiet.github.io/quiet-js/docs/
- https://quiet.github.io/docs/quiet-js/transmitting/
- https://quiet.github.io/docs/quiet/profiles/

## Production/runtime gaps the plan must close

- Add one executable that serves the built Vite assets and owns a same-origin,
  loopback-only `/bridge` WebSocket.
- Send real `PCM_CAPTURE`, `PCM_PLAYBACK`, qualification-case, result, error,
  and reset frames through FWAV with bounded queues and epoch rejection.
- Replace the fixture-only Start action with the immutable Cyrinx gate and
  automatic transition to Quiet.
- Schedule the committed corpus one case at a time in literal A → B and B → A
  roles without a network path between laptops.
- Generate and download/write one canonical machine report from measured
  audio, codec, corpus, queue, timing, and TUN evidence.
- Make `qualify:verify` parse `--machine-a`, `--machine-b`, and `--selection`,
  honor the requested output path, and produce Cyrinx, Quiet, or unqualified.
- Add an unmocked local Chromium integration test against the real production
  runner. Physical sound and exact-host TUN evidence remain manual-only.

## Demo-day safety valve

If the native C path is not digitally green quickly, or the first cold frame
does not pass in each direction, record the immutable Cyrinx rejection and
start Quiet immediately. Do not spend the demo window building a modem.
