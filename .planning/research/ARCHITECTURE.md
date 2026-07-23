# Architecture Research

**Domain:** Browser-mediated acoustic packet transport for FIPS
**Researched:** 2026-07-23
**Confidence:** HIGH for FIPS integration and browser/container boundaries; MEDIUM for the acoustic PHY parameters until tested on the demo laptops

## Standard Architecture

### System Overview

The fastest dependable proof is a **reliable, half-duplex acoustic link that is
full-duplex at the FIPS interface**. “Duplex” here means either peer can send
FIPS packets and receive replies; attempting simultaneous acoustic transmission
adds echo cancellation and collision recovery that the demo does not need.

Each laptop runs the same local stack. Only the sender enables an additional
wider-mesh FIPS transport. The isolated node has no network-facing transport:
its browser reaches its own container through a loopback-published port, and
all inter-laptop traffic is audible sound.

```text
Laptop A — mesh-connected                         Laptop B — otherwise offline
┌────────────────────────────────────┐            ┌────────────────────────────────────┐
│ Linux container / Docker VM       │            │ Linux container / Docker VM       │
│                                   │            │                                   │
│ ping6 ── fips0 TUN ── FIPS node   │            │ FIPS node ── fips0 TUN ── ping6   │
│                       │     │      │            │      │                            │
│              UDP/TCP wider   SoundTransport     │ SoundTransport                    │
│                 mesh link     │  ▲              │      │  ▲                         │
│                               ▼  │              │      ▼  │                         │
│                bounded packet queues + WS server│ bounded packet queues + WS server │
└───────────────────────────────┬──┘              └──────┬──┴─────────────────────────┘
                                │ 127.0.0.1:8787         │ 127.0.0.1:8787
                         Docker published port     Docker published port
┌───────────────────────────────┴──┐              ┌──────┴─────────────────────────────┐
│ Chromium browser                │              │ Chromium browser                  │
│ UI/main thread                  │              │ UI/main thread                    │
│   WS packets ↔ modem controller │              │ modem controller ↔ WS packets     │
│                  │              │              │              │                    │
│ AudioWorklet: PHY + link layer  │              │ AudioWorklet: PHY + link layer    │
│ mic capture ↔ decode/ARQ/encode ↔ speaker      │ speaker ↔ encode/ARQ/decode ↔ mic  │
└─────────────────┬───────────────┘              └────────────────┬───────────────────┘
                  │                                               │
                  └────────── audible BFSK acoustic frames ───────┘
```

**Critical topology rule:** Wi-Fi/Ethernet may be used to install and warm the
isolated laptop, but must be disabled before the proof. `localhost` browser ↔
container traffic remains local and does not violate the acoustic-only
inter-laptop link.

### Component Responsibilities

| Component | Responsibility | Explicit non-responsibility |
|-----------|----------------|-----------------------------|
| FIPS IPv6 adapter + `fips0` | Accept real kernel IPv6 packets, establish FSP sessions, encrypt, route, reconstruct inbound IPv6 | Acoustic framing, retries, audio |
| Forked `SoundTransport` | Participate as a normal FIPS transport; expose state, identity, MTU, static peer address and connection policy; queue outbound complete FIPS packets to the browser; turn browser-delivered packets into `ReceivedPacket` | Parsing FIPS wire payload, acoustic modulation |
| Local HTTP/WebSocket bridge | Serve the modem UI on `localhost`; maintain exactly one browser session; move bounded binary messages between `SoundTransport` and browser; expose minimal readiness/counters | Inter-laptop networking, packet retransmission |
| Browser main thread | Request mic permission from a user gesture, create `AudioContext`, connect binary WebSocket, transfer packet/control messages to the worklet, show readiness and counters | Sample-by-sample DSP |
| `AudioWorklet` modem | Own real-time sample generation and detection; frame/deframe; CRC; fragmentation/reassembly; duplicate suppression; stop-and-wait ARQ; channel arbitration | FIPS peering or encryption |
| Acoustic link | Carry DATA and ACK frames between laptop speakers/microphones | Simultaneous bidirectional transmission |
| Docker composition | Give FIPS `/dev/net/tun` and `NET_ADMIN`; publish only the UI/WS port to loopback; mount config/identity | Making the container TUN directly routable from macOS |

## FIPS Fork Integration

Current upstream (commit `fc8ebd5a06d6f042c57f03107f403116365a16b4`,
2026-07-23) has the right abstraction but closed concrete dispatch:

- `Transport` requires `transport_id`, type metadata, state, `mtu`,
  optional per-link `link_mtu`, lifecycle, `send`, discovery, auto-connect,
  inbound connection policy, and optional close.
- Receive delivery is already decoupled: transports push complete
  `ReceivedPacket { transport_id, remote_addr, data, timestamp_ms }` values
  through the shared Tokio packet channel.
- Runtime async dispatch is a closed `TransportHandle` enum. A sound variant
  must therefore be added to every lifecycle/send/metadata/state/MTU/policy
  match arm.
- `Node::create_transports` constructs instances from typed config; add
  `transports.sound` parsing and construction there.
- FIPS uses `link_mtu()` for path-MTU propagation and explicitly does not
  fragment at transit nodes. Acoustic fragmentation must be invisible above
  `SoundTransport`.

### Minimal Fork Surface

```text
src/
├── config/transport.rs       # SoundConfig + transports.sound collection
├── transport/
│   ├── mod.rs                # pub mod sound; TransportHandle::Sound + match arms
│   └── sound.rs              # SoundTransport, queues, HTTP/WS bridge
└── node/mod.rs               # construct configured sound instances

web/
├── index.html                # start/stop, readiness, counters
├── modem.js                  # WS and AudioContext orchestration
└── modem-worklet.js          # BFSK, framing, ARQ, reassembly
```

Prefer a constant opaque peer address such as `TransportAddr("acoustic:peer")`.
There is one acoustic peer pair and no need to invent addressing or discovery.
Configure one node to auto-connect to that address and the other to accept
connections. Do not enable auto-connect on both: avoiding crossing handshake
initiations also reduces acoustic contention.

Recommended metadata and limits:

| Property | Recommendation | Reason |
|----------|----------------|--------|
| `TransportType.name` | `"sound"` | Stable config and diagnostics key |
| `connection_oriented` | `false` | No separate physical connection handshake is needed |
| `reliable` | `true` | Browser link layer delivers only CRC-valid, acknowledged packets |
| Initial FIPS `mtu` | `256` bytes | Fits 114-byte msg1, 69-byte msg2, control traffic, and a normal small ICMPv6 echo after FIPS overhead while bounding airtime |
| Browser queue | 8–16 complete FIPS packets | Backpressure without adding seconds of stale audio |
| Static peer count | exactly one | Matches scope and removes discovery/multiplexing |

Upstream computes effective IPv6 MTU as `transport_mtu - 77`, so a 256-byte
sound MTU yields 179 bytes for the reconstructed IPv6 packet. This is ample for
the typical default Linux `ping` packet (56 bytes of data + 8-byte ICMPv6
header + 40-byte IPv6 header = 104 bytes). It is intentionally not a general
IPv6 link. Verify the exact demo ping size and reduce payload with `ping -s` if
the platform default differs.

## Recommended WebSocket Bridge Contract

Serve the page and WebSocket from the same container process or a tiny sibling
task at `http://localhost:8787/` and
`ws://localhost:8787/api/sound`. Bind the published host port to
`127.0.0.1`, not all interfaces. `localhost` is treated as a secure context for
browser media APIs, avoiding one-day TLS certificate work.

Use binary WebSocket messages (`socket.binaryType = "arraybuffer"`), network
byte order, and one operation per WebSocket message:

| Direction | Opcode and payload | Meaning |
|-----------|--------------------|---------|
| daemon → browser | `0x01 SEND_PACKET | packet_id:u32 | len:u16 | bytes[len]` | Queue one complete FIPS transport packet for acoustic delivery |
| browser → daemon | `0x02 RECV_PACKET | len:u16 | bytes[len]` | Deliver one fully reassembled, CRC-valid, de-duplicated FIPS packet |
| browser → daemon | `0x03 READY | sample_rate:u32 | max_packet:u16` | Mic, speaker, worklet and modem are operational |
| browser → daemon | `0x04 TX_RESULT | packet_id:u32 | status:u8 | retries:u8` | Diagnostic completion/failure; not a FIPS packet |
| either direction | `0x05 STATUS | code:u8 | value:u32` | Optional counters/readiness; may be omitted initially |

Contract rules:

1. Reject `SEND_PACKET` larger than the reported sound MTU.
2. `SoundTransport::send_async` succeeds when the bounded WS queue accepts the
   packet, not when acoustic ACK arrives; waiting for acoustic completion would
   serialize the FIPS node task and can trigger upstream timeouts.
3. If the browser is absent/not READY or the queue is full, return a transport
   send error immediately. Never silently discard.
4. Only `RECV_PACKET` enters the FIPS `PacketTx`, with the constant remote
   acoustic address and current receipt timestamp.
5. On WS disconnect, mark the transport non-operational, clear partial
   reassembly/transmit state, and require a fresh random `link_epoch` after
   reconnection so late frames cannot complete old packets.
6. WebSocket framing is the only daemon/browser framing. Do not base64,
   serialize FIPS bytes as JSON, or duplicate acoustic fragments over WS.

## Acoustic Framing and Reliability

### Recommended Link Frame

Start with robust audible binary FSK (two well-separated tones) and conservative
symbol timing. Parameters must be adjustable from constants, but protocol
structure should not change during tuning.

```text
preamble | sync word |
version:u8 | type:u8 | epoch:u16 | packet_id:u16 |
fragment_index:u8 | fragment_count:u8 | payload_len:u8 |
payload:0..64 | crc16:u16
```

- `DATA` carries up to 64 bytes. A 256-byte FIPS packet becomes at most four
  acoustic fragments, keeping recovery local.
- `ACK` carries the same `(epoch, packet_id, fragment_index)` and no payload.
- CRC covers the complete header and payload, not the preamble/sync.
- Reassembly is keyed by `(epoch, packet_id)`, bounded to one current packet per
  peer, with strict fragment/count/length validation.
- Deliver to FIPS only after all fragments pass CRC. Cache the most recently
  delivered packet ID so a retransmitted final fragment is ACKed but not
  re-delivered.

### Medium Access and ARQ

Use stop-and-wait **per fragment**:

1. Listen for a short clear-channel interval.
2. Transmit one DATA fragment.
3. Mute/ignore local mic samples during speaker output plus a short guard time.
4. Listen for matching ACK.
5. Retry with bounded randomized backoff; after the limit, fail the complete
   packet and report `TX_RESULT`.
6. A receiver sends ACK immediately after a valid fragment, before doing UI
   work.

This naturally carries handshake request/reply, heartbeats and ping/reply in
both directions. Use a deterministic tie-break for the rare collision: the
configured initiator gets the shorter contention window, while the responder
must yield when it has just received data. Do not build acoustic full-duplex
echo cancellation.

Initial tuning recommendation is deliberately conservative: payload 64 bytes,
5 retries, ACK timeout based on measured frame duration plus 2× guard time, and
a rate in the low hundreds of bits/s. Optimize symbol rate only after the
114-byte msg1, 69-byte msg2 and repeated ping pass across the actual room.

## Encoding Placement Comparison

| Placement | Assessment | Deadline decision |
|-----------|------------|-------------------|
| **All PHY, framing, fragmentation and ARQ in browser** | Shortest sample-to-decoder path; AudioWorklet has the clock/sample rate; no PCM streaming over WS; daemon sees complete packets. JS debugging is easy in Chromium. | **Recommended** |
| Browser owns PCM, Rust bridge owns modem/link | Clean protocol implementation in Rust, but requires continuous PCM transfer across AudioWorklet → main thread → WS → container and synthesized PCM back, adding buffering, copies, clock-boundary problems and much more bridge traffic. | Reject for one-day slice |
| Browser owns PHY, Rust owns fragmentation/ARQ | Plausible later, but ACK timing and retransmit state cross the WS/main-thread boundary; duplicates responsibilities and complicates failure semantics. | Defer |
| Native Rust audio + complete modem in container | Architecturally simple for FIPS but violates the browser-owns-audio constraint and is fragile on macOS Docker. | Reject |
| WebAssembly modem inside AudioWorklet | Can reuse tested DSP code, but build/toolchain glue costs time unless a ready modem implementation already exists. | Fallback only if already available |

The recommended browser placement does not weaken the proof: the forked
transport still exchanges genuine, opaque FIPS wire packets, and the browser
acts as its link-layer device, analogous to a modem attached over a serial
boundary.

## Data Flow

### Outbound Ping Request: A → B

```text
docker exec node-a ping -6 <B-fips-address>
  → Linux kernel routes fd00::/8 to A:fips0
  → FIPS IPv6 adapter compresses/encrypts/routes the packet
  → A:SoundTransport.send("acoustic:peer", complete_fips_packet)
  → bounded WS SEND_PACKET
  → A browser fragments packet and emits DATA/awaits ACK
  → sound waves
  → B browser validates CRC, ACKs each fragment, reassembles packet
  → B WS RECV_PACKET
  → B:SoundTransport emits ReceivedPacket
  → B FIPS decrypts/reconstructs IPv6
  → B:fips0 writes echo request to Linux kernel
  → Linux ICMPv6 stack creates echo reply
```

### Ping Reply: B → A

The reply follows the same pipeline in reverse. This is the important vertical
slice: it exercises both speakers, both microphones, both WS directions,
FIPS handshake/session/routing, both TUN directions and the kernel ICMPv6
implementation.

### Peering Flow

```text
A configured static sound peer
  → FIPS msg1 (114 bytes) → acoustic packet/fragments
  → B ReceivedPacket → FIPS msg2 (69 bytes)
  → acoustic return path → A ReceivedPacket
  → encrypted FIPS link established
  → 1-byte FIPS heartbeat frames periodically traverse the same path
```

Increase upstream’s default 30-second handshake timeout only if measured modem
airtime plus retries approaches it. Do not shorten the default 10-second
heartbeat interval until stable; slow links are harmed by extra control
traffic.

## Docker and OS IPv6 Boundary

Run the daemon container with `/dev/net/tun` and `CAP_NET_ADMIN`; do not use
blanket `--privileged`. On native Linux, a host route into a container-owned
TUN can be explored later. On Docker Desktop for macOS, Docker Engine and
`docker0` live inside a Linux VM and published ports are proxied between host
and VM. Therefore:

- **Critical-path demo:** invoke `ping -6` inside the sender FIPS container.
  This is a genuine OS IPv6 ping generated by the Linux kernel and sent through
  the real `fips0` TUN.
- **Do not promise:** a macOS-host `ping6` routed directly to the
  container-owned `fips0`. That requires an additional host/VM routing or TUN
  bridge not supplied by ordinary Docker port publishing.
- **If presentation wording requires laptop-host ping:** use a native Linux
  sender or move only the sender FIPS daemon to the host as a rehearsed
  fallback. Do not improvise a macOS TUN bridge on demo morning.

## Dependency-Driven Build Order

1. **Prove unmodified FIPS and TUN locally.** Two container nodes over an
   existing transport; verify container `ping -6`, identities, routes and
   required capabilities.
2. **Fork transport plumbing with a loopback WS harness.** Add config,
   `TransportHandle::Sound`, node construction and `ReceivedPacket` injection.
   Browser can initially echo packets over WS without audio.
3. **Prove FIPS-over-WS packet semantics.** Two local browser sessions or a
   test relay must establish a genuine FIPS link and ping before modem work.
4. **Prove one-way acoustic frames outside FIPS.** Fixed byte patterns,
   preamble/sync, CRC and measured error counters on the actual laptops.
5. **Add ACK, duplicate suppression and retries.** Repeated 114-byte and
   256-byte payload tests must pass; then enable acoustic fragmentation.
6. **Connect audio modem to WS and establish FIPS peering.** Do not work on
   wider-mesh routing until handshake and heartbeat remain stable.
7. **Run the isolated two-laptop ping.** Disable B’s network interfaces, show
   container routes/transport config, and repeat ping in both directions.
8. **Rehearse and freeze.** Record volume, laptop placement, browser device
   selection, symbol timing, launch commands and a known-good image/config.
9. **Only then attempt stretch work:** faster symbols, visualization,
   near-ultrasonic tones, host-native ping.

The order deliberately creates packet-boundary test points. Every stage can be
validated with deterministic bytes before adding the next timing-sensitive
layer.

## Deadline-Aware Fallback Ladder

| Failure | First response | Demonstration-preserving fallback |
|---------|----------------|-----------------------------------|
| Room noise causes loss | Lower symbol rate, increase tone separation and preamble; place laptops closer; fix volume | Use an audio cable between headphone/output and input only if speakers cannot pass repeated packets; disclose the physical acoustic/electrical medium change |
| Simultaneous traffic collides | Enforce initiator priority and larger responder yield window | Pause nonessential wider-mesh traffic and retain half-duplex stop-and-wait |
| 256-byte packets unreliable | Reduce acoustic fragment payload, not FIPS MTU first | Reduce FIPS MTU to the smallest value still carrying msg1 and chosen ping size |
| Browser audio processing glitches | Ensure AudioWorklet, close other tabs/apps, keep page foreground, disable browser audio processing constraints where honored | Use a Chromium version and hardware pair already rehearsed; do not switch APIs |
| WS reconnect leaves link wedged | New epoch, clear queues/reassembly, restart FIPS peer handshake | Restart both containers and browser pages from scripted clean state |
| macOS host cannot route to `fips0` | Run ping inside container | Native Linux sender only if already rehearsed |
| Wider-mesh integration fails | Prove A↔B FIPS addresses and acoustic-only isolation first | Use a third local FIPS node/container as the “wider mesh participant”; the ping remains genuine and traverses the acoustic hop |
| Browser implementation misses deadline | Reuse the already-proven WS packet path to isolate which layer failed | Do not substitute an application echo; the acceptance line remains genuine FIPS + kernel ping |

The final row is a diagnostic fallback, not a successful final demo. A staged
UI echo must never be presented as completion.

## Architectural Patterns

### Bounded Device Adapter

**What:** Treat the browser modem as a single attached device behind bounded
queues. Transport state follows device readiness.

**When to use:** Always for this proof.

**Trade-offs:** Predictable failure and memory use; packets may fail under
backpressure rather than waiting indefinitely, which is the correct behavior
for FIPS retry/timeout machinery.

### Reliability Below the Transport Boundary

**What:** Fragment, CRC, retry, acknowledge, reassemble and de-duplicate entirely
inside the browser modem. FIPS sends and receives only complete wire packets.

**When to use:** Always; it follows upstream’s no-transit-fragmentation model.

**Trade-offs:** The browser link layer has more state, but neither FIPS routing
nor encryption needs modification.

### Observable Vertical Slices

**What:** Preserve counters at every boundary: FIPS packets queued, WS packets,
acoustic fragments sent/retried/CRC-failed, complete packets delivered.

**When to use:** From the first audio test.

**Trade-offs:** A few counters add minimal code and turn a live-demo failure
from guesswork into a single-boundary diagnosis. Avoid a polished dashboard.

## Anti-Patterns

### Streaming PCM Through the Container

**What people do:** Send microphone buffers over WebSocket and run DSP in Rust.

**Why it is wrong here:** It introduces continuous high-volume transfer,
multiple schedulers and extra buffering precisely where timing matters.

**Do this instead:** Keep sample-rate work in `AudioWorklet`; cross WS only at
complete FIPS packet/control boundaries.

### Reporting 1280 MTU Because IPv6 Says So

**What people do:** Advertise 1280 and acoustically fragment arbitrarily long
FIPS packets.

**Why it is wrong here:** A single packet can occupy the channel for too long,
block heartbeat/reply traffic and require expensive full-packet recovery.

**Do this instead:** Advertise the honest small sound-link MTU (initially 256)
and use small acoustic fragments below it.

### Simultaneous Acoustic Full Duplex

**What people do:** Keep both speakers active and rely on browser echo
cancellation.

**Why it is wrong here:** Laptop speakers strongly couple into local mics;
browser processing is device-dependent and may suppress modem tones.

**Do this instead:** Bidirectional half-duplex with explicit DATA/ACK turns,
guard time and contention.

### Modifying FIPS Routing or Handshake

**What people do:** Special-case sound packets in FMP/FSP because the medium is
slow.

**Why it is wrong here:** It weakens the “arbitrary transport” proof and expands
the fork surface.

**Do this instead:** Add one normal `TransportHandle` variant and tune existing
timeouts only when measurements prove necessary.

### Depending on a macOS Route to a Container TUN

**What people do:** Assume `--network host` or a published port makes `fips0`
part of the macOS network stack.

**Why it is wrong here:** Docker Desktop runs the Linux network stack in a VM;
port publishing is proxying, not TUN attachment.

**Do this instead:** Run the kernel ping inside the container for the deadline.

## Integration Points

### Internal Boundaries

| Boundary | Communication | Invariant |
|----------|---------------|-----------|
| Kernel ↔ FIPS | `fips0` TUN raw IPv6 packets | Genuine kernel-generated/consumed IPv6 |
| FIPS node ↔ SoundTransport | Existing `TransportHandle` calls and `PacketTx` | Complete FIPS packets only |
| SoundTransport ↔ browser | Loopback binary WebSocket with bounded queues | One READY browser; no base64/JSON packet data |
| Browser main ↔ AudioWorklet | `MessagePort`, transferable `ArrayBuffer`s | Main thread does no sample-loop DSP |
| Modem TX ↔ modem RX | Audible framed BFSK | CRC-valid fragments, stop-and-wait ACK |
| Sender FIPS ↔ wider mesh | Existing upstream transport | Disabled entirely on isolated node |

## Sources

- [jmcorgan/fips transport abstraction and closed `TransportHandle` dispatch](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/src/transport/mod.rs) — upstream source, HIGH confidence.
- [jmcorgan/fips node transport construction](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/src/node/mod.rs) — upstream source, HIGH confidence.
- [FIPS path MTU and no-fragmentation design](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/docs/design/fips-mtu.md) — upstream design documentation, HIGH confidence.
- [FIPS IPv6/TUN adapter design](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/docs/design/fips-ipv6-adapter.md) — upstream design documentation, HIGH confidence.
- [FIPS handshake wire sizes](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/src/proto/fmp/wire.rs) — upstream source, HIGH confidence.
- [FIPS configuration reference](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/docs/reference/configuration.md) — upstream documentation for heartbeat and handshake defaults, HIGH confidence.
- [MDN: `getUserMedia()` secure-context and localhost rules](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) — browser documentation, HIGH confidence.
- [MDN: AudioWorklet low-latency separate audio thread](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet) — browser documentation, HIGH confidence.
- [MDN: WebSocket binary `ArrayBuffer` messages](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/binaryType) — browser documentation, HIGH confidence.
- [Docker: use `NET_ADMIN` for network-interface operations](https://docs.docker.com/engine/containers/run/#runtime-privilege-and-linux-capabilities) — official documentation, HIGH confidence.
- [Docker Desktop networking and published-port proxy boundary](https://docs.docker.com/desktop/features/networking/) — official documentation, HIGH confidence.

---
*Architecture research for: FIPS over Sound*
*Researched: 2026-07-23*
