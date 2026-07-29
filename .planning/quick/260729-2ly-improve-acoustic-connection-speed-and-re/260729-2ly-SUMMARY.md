---
quick_id: 260729-2ly
status: complete
date: 2026-07-29
branch: feat/acoustic-fast-reliable-link
commits:
  - 98224c3
  - bf9e78c
  - d244fb8
---

# Quick Task 260729-2ly Summary

Implemented a faster, fault-tolerant acoustic link and live throughput display
on a dedicated branch.

## Delivered

- Added CRC-bound XOR parity units for each four-DATA-fragment group. Quiet's
  waveform FEC continues to handle correctable symbol/bit errors; FAS1 parity
  now reconstructs one entire missing/rejected frame without another turn.
- Increased bounded packet bursts from four to eight DATA fragments while
  retaining explicit DATA/TURN_END/ACK/TURN_END ownership. A 1,357-byte packet
  at the conservative 96-byte payload now needs two ACK rounds instead of four.
- Preserved proven settings and their SHA-256 digest across automatic resets in
  the same epoch. Reconnect always creates a new nonce-bound handshake, then
  skips probes only when both CAPS messages present the same still-allowlisted
  digest. A new epoch or bounded failed resume falls back to calibration.
- Added immutable per-queued-job Quiet settings. HELLO, HELLO_ACK, CAPS,
  COMMIT, COMMIT_ACK, and RESET use a redundant ceremony mode; calibration
  probes and packet traffic keep their exact candidate settings.
- Added acknowledged TX and delivered RX byte counters, a three-second rolling
  sampler updated twice per second, automatic `bps`/`kbps`/`Mbps` formatting,
  and live rate/parity/recovery rows in both audience and debug link stats.
- Researched ggwave and retained Quiet: ggwave's documented 8–16 bytes/s and
  second runtime/receiver cost make it a poor data-plane switch. The research
  artifact records it as a later exact-hardware ceremony experiment.

## Verification

- `npm run check` — passed.
- Unit suite — 34 files, 316 tests passed.
- Chromium suite — 21 tests passed.
- Production TypeScript/Vite build — passed.
- Focused protocol/session/Quiet/throughput suite — passed.
- Fixture qualification remains correctly `human_needed`; it never claims
  physical open-air evidence.

Exact two-laptop open-air timing and induced-loss measurements remain a human
hardware check and are listed in `260729-2ly-VERIFICATION.md`.
