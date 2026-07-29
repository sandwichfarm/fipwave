---
quick_id: 260729-2ly
status: complete
date: 2026-07-29
---

# Acoustic connection speed and reliability research

## Current path

The browser already runs one fixed Quiet modem profile,
`audible-7k-channel-0`, behind a strict FAS1 session layer. Quiet provides
waveform-level forward error correction and checksums, while FAS1 adds CRC-32C,
fragment bitmaps, bounded retransmission, half-duplex token ownership, and
heartbeat recovery.

The largest avoidable costs in the current implementation are:

- every same-epoch reconnect clears the committed settings and repeats all
  candidates in both directions;
- DATA uses four-fragment bursts, so a 1,357-byte packet needs multiple
  DATA/TURN_END/ACK/TURN_END exchanges;
- corruption or loss of one complete modem frame always requires another
  acoustic turn even though CRC makes the missing fragment an identifiable
  erasure;
- the UI shows packet/frame totals, but no current payload rate.

## Targeted findings

### Error correction

Quiet's documented profile system supports inner and outer FEC, including
convolutional and Reed-Solomon codes, and its project documentation states that
FEC preserves messages while checksums discard messages that remain incorrect.
That covers bit errors inside a decoded modem frame. FAS1's CRC-32C then gives
the session an explicit accept/reject boundary.

The useful missing layer is erasure correction across FAS1 fragments. One XOR
parity unit for each bounded group of data fragments recovers any one entirely
missing or rejected fragment in that group. This is the same practical
redundancy idea as a QR code: payload capacity is traded for recovery without a
retry. It is intentionally not described as Reed-Solomon; its exact guarantee
is one erasure per parity group.

Use parity only for DATA windows. Keep the complete packet length, data
fragment count, packet ID, session ID, and group start in the CRC-protected
FAS1 header. XOR bodies after zero-padding the final short fragment. The
receiver reconstructs only when exactly one fragment in the group is absent,
then runs normal packet reassembly.

### Faster turns

Increase the ordinary data burst from four to eight fragments while retaining
four-fragment parity groups. A maximum-MTU packet at the fast 217-byte payload
size then crosses in one DATA burst plus two parity frames, instead of two
acknowledgement rounds. Control and heartbeat packets remain naturally short.
Bounded bitmap acknowledgement and explicit TURN_END ownership stay intact.

The selected Quiet candidate already has a 100 ms fast guard option, and
`QuietClient` waits for the local transmitter's `onFinish` before applying the
guard. Reducing that guard blindly is not justified without exact-laptop open
air evidence.

### Reconnect without recalibration

Retain the last settings and SHA-256 digest across an automatic reset within
the same epoch. CAPS should carry an optional resume digest after its nonce
binding. Resume only when:

1. the local settings still map exactly to the current candidate allowlist;
2. both peers advertise a digest;
3. the digests match exactly.

The normal COMMIT/COMMIT_ACK/current-heartbeat gates still run for the new
session. A digest mismatch, new epoch, changed candidate set, or bounded failed
resume bootstrap invalidates the warm record and falls back to calibration.
An ordinary later link outage does not erase settings that already carried a
current-session heartbeat; recovery and the next handshake try them again.

### Connection ceremony codec/profile

`ggwave` is designed for short pairing messages, uses multi-frequency FSK plus
Reed-Solomon, and documents only roughly 8–16 bytes/s. It would require a
second WASM runtime and receiver alongside the already verified Quiet path.
That is a poor data-plane trade for this project.

Keep `audible-7k-channel-0`, but transmit the small identity/capability/commit
ceremony units with a per-job redundant Quiet setting (two repetitions and a
bounded guard). Calibration probes and packet traffic must continue to use the
candidate being measured/committed. Capturing the setting per queued job is
important because Quiet has one mutable serialized transmitter.

This improves ceremony acquisition without claiming a new carrier frequency.
Alternative Quiet profiles or ggwave remain an exact-hardware experiment, not
a silent runtime switch.

### Live throughput

Count payload bytes only when a complete outbound packet is acknowledged or a
complete inbound packet is delivered. A small rolling tracker can sample those
monotonic totals twice per second and report bits per second over a short
window. Format automatically as `bps`, `kbps`, or `Mbps`; render both TX and RX
in the live-link and debug statistics.

## Integration points

- `apps/modem-ui/src/acoustic-protocol.ts`: parity unit validation,
  construction, and one-erasure recovery helpers.
- `apps/modem-ui/src/acoustic-session.ts`: parity scheduling/reassembly,
  eight-fragment bursts, warm settings record and resume CAPS path, delivered
  byte counters, per-unit transmit mode.
- `apps/modem-ui/src/quiet-client.ts`: immutable per-queued-job ceremony/data
  transmission settings.
- `apps/modem-ui/src/throughput.ts` and `main.ts`: rolling rate calculation,
  formatting, timer, and UI.
- Unit tests in the adjacent protocol/session/client/status modules plus a
  focused throughput test.

## Sources

- Quiet project overview and FEC/checksum behavior:
  https://quiet.github.io/docs/quiet/
- Quiet profile/FEC configuration:
  https://quiet.github.io/docs/quiet/profiles/
- ggwave official implementation, modulation, Reed-Solomon, and stated
  throughput:
  https://github.com/ggerganov/ggwave
