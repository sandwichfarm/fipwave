# Project Research Summary

**Project:** FIPS over Sound
**Domain:** Browser-mediated acoustic packet transport for an encrypted IPv6 mesh
**Researched:** 2026-07-23
**Confidence:** MEDIUM

## Executive Summary

FIPS over Sound is a one-day systems-integration proof: two ordinary laptops
must form a genuine FIPS peer link over audible sound, keep the encrypted link
alive, and carry a kernel-generated IPv6 echo request and reply while the
receiving laptop has no alternate inter-laptop path. Experts would build this
as a bounded device adapter beneath FIPS: the existing daemon continues to own
identity, encryption, peering, routing, and TUN traffic, while a local browser
modem owns audio, link framing, fragmentation, integrity, retransmission, and
half-duplex channel access.

For tomorrow, reuse `ggwave` 0.4.3 for the proven acoustic PHY and ECC rather
than implementing custom BFSK. Wrap it in a small, codec-independent DATA/ACK
envelope and keep its real-time encode/decode path in an `AudioWorklet`; the
main browser controller owns permissions, the binary WebSocket, complete-packet
queues, and coarse telemetry. Start with a 256-byte advertised FIPS sound MTU
and 64-byte acoustic fragments. That deliberately limits airtime while still
covering the 114-byte/69-byte handshake and a small ping. The first integration
gate must prove that FIPS and the TUN accept this small path; advertise 1280
only if that gate fails, then strictly limit demo traffic and fragment below
FIPS. On Docker Desktop, run `ping -6` from the Linux container namespace (or a
third mesh-client container), not from the macOS host.

The dominant risks are codec airtime, self-jamming, browser/OS speech
processing, FIPS liveness timers, Docker Desktop routing assumptions, and a
bench-only success that cannot cold-start on stage. Mitigate them with one
fixed audible profile, explicit half-duplex stop-and-wait ARQ, bounded queues,
visible counters at every boundary, measured timer margins, exact demo
hardware/geometry, and repeated cold-start rehearsals. Near-ultrasonic mode,
host-native macOS ping, visual polish, and throughput work are stretch goals
only after the audible isolated ping passes repeatedly.

## Reconciled Decisions

| Disagreement | Decision for tomorrow | Why |
|--------------|-----------------------|-----|
| `ggwave` reuse vs custom BFSK | Use `ggwave` 0.4.3 for modulation, preamble/sync behavior, and ECC; add only the FIPS-specific fragment/ACK envelope. Time-box an actual-laptop spike to two hours. If it cannot repeatedly carry the largest mandatory control frame, fall back to a previously working fixed modem implementation/profile, not an open-ended DSP rewrite. | Existing browser/WASM code removes the highest-risk synchronization and decoding work. Custom BFSK is architecturally neat but is the wrong default under a one-day deadline. |
| Advertised FIPS MTU 256 vs 1280 | Start at 256 and test the complete FIPS/TUN path immediately. Use 64-byte acoustic fragments. If FIPS PMTU propagation, Linux IPv6 behavior, or the chosen ping rejects 256, switch to 1280 while allowing only the rehearsed small ping/control workload and retaining bounded below-FIPS fragmentation. | A 1280-byte packet can monopolize this link for tens of seconds; 256 bounds failure and is sufficient according to the inspected FIPS overhead and target ping sizes. The validation gate addresses the legitimate IPv6-minimum-MTU concern instead of assuming either value works. |
| Browser worklet placement | `AudioWorklet` owns PCM, `ggwave` invocation, local-TX suppression, immediate ACK/turnaround, and sample-clock deadlines. The main controller owns user activation, microphone settings, WebSocket packet messages, whole-packet queue admission, and UI. No PCM crosses the main thread or WebSocket. | This keeps timing-sensitive work off the UI thread without turning the worklet into the Docker/FIPS bridge. If moving the existing `ggwave` WASM binding into a worklet is the only blocker, first preserve the library's proven browser integration and close all other tabs/logging; do not stream PCM into Docker. |
| Host vs container ping on Docker Desktop | The acceptance command runs in a Linux container namespace. Prefer a third mesh-client container on laptop A if the “wider mesh participant” must be visually distinct; otherwise use the sender FIPS container. A macOS-host ping is explicitly not a release criterion. | Docker Desktop's VM and port proxy do not attach the container TUN to the macOS network stack. A container `ping -6` is still a real kernel IPv6 ping through `fips0`; claiming a host route would add an unrelated, unproven tunnel. |

## Key Findings

### Recommended Stack

The detailed stack research is in [STACK.md](./STACK.md). Pin the inspected
FIPS revision and the first known-good dependency lockfile as soon as the
vertical slice works; no upgrades should occur between rehearsal and demo.

**Core technologies:**

- `jmcorgan/fips` at inspected revision `fc8ebd5` with Rust 1.94.1+ — preserve
  the existing peer, encryption, routing, and TUN machinery while adding the
  smallest `SoundTransport` variant.
- `ggwave` 0.4.3 WASM/JavaScript — lowest-risk audible/near-ultrasonic modem
  primitive, with browser support, binary payloads, framing behavior, and ECC.
- Web Audio API plus `AudioWorklet` — browser-owned microphone/speaker I/O and
  sample-clock processing without native host audio plumbing.
- Binary WebSocket over loopback with `tokio-tungstenite` — one complete FIPS
  packet per message between the Dockerized daemon and its local browser.
- Docker Compose with `/dev/net/tun` and `NET_ADMIN` — reproducible Linux FIPS
  runtime on macOS/Linux without broad `--privileged` access.

Critical constraints are `ggwave`'s 140-byte variable payload ceiling and
documented 8–16 B/s typical throughput. Use a roughly 64-byte data fragment,
bounded stop-and-wait retries, and timer values derived from measured airtime.

### Expected Features

The detailed feature analysis is in [FEATURES.md](./FEATURES.md).

**Must have (table stakes):**

- First-class FIPS sound transport with ordinary handshake, heartbeat,
  lifecycle, MTU, and complete-packet delivery.
- One binary loopback WebSocket and a one-click Chromium audio arm flow on each
  laptop, with applied capture settings visible.
- Fixed audible codec profile; DATA/ACK framing; CRC; bounded fragmentation,
  reassembly, retries, duplicate suppression, and backpressure.
- Deterministic half-duplex operation that is bidirectional at the FIPS
  interface.
- Real container-kernel IPv6 ping and reply with the receiver's alternate FIPS
  transports and external network disabled.
- Boundary counters, reset/reconnect, exact launch order, preflight, and
  rehearsed recovery.

**Should have (only after repeated ping success):**

- Compact audience-facing TX/RX/fragment/retry counters.
- A second, near-ultrasonic fixed profile tested on the exact laptops.
- A faster fixed audible profile only if it preserves the repeated-ping gate.

**Defer (v2+):**

- Custom/adaptive modem design, simultaneous acoustic full duplex, sliding
  windows, high throughput, multi-peer discovery, mobile/broad browser support,
  host-native macOS routing, and polished spectrum visualization.
- General TCP/file/web traffic and deliberate loss injection during the live
  demo.

### Architecture Approach

The detailed architecture is in [ARCHITECTURE.md](./ARCHITECTURE.md). Each
laptop runs the same bounded adapter. FIPS exchanges only complete opaque wire
packets with `SoundTransport`; the browser behaves like an attached modem.
Exactly one peer is statically configured, only one side auto-connects, and all
acoustic reliability remains below the FIPS boundary.

**Major components:**

1. FIPS node and `fips0` TUN — kernel IPv6, FIPS session establishment,
   encryption, routing, and heartbeat.
2. Forked `SoundTransport` — config/dispatch integration, honest transport
   state and MTU, bounded outbound queue, and complete inbound
   `ReceivedPacket` delivery.
3. Loopback HTTP/WebSocket bridge — one READY browser, bounded binary messages,
   packet-size validation, readiness, and counters.
4. Browser controller — permission/autoplay flow, applied audio settings,
   WebSocket lifecycle, complete-packet queue admission, reset, and UI.
5. `AudioWorklet` modem — `ggwave` encode/decode, fragment envelope, CRC,
   reassembly, ACK/retry, duplicate suppression, guards, and half-duplex turns.
6. Docker composition — TUN capability/device, fixed loopback-published port,
   pinned config/identities, and an explicit container ping namespace.

### Critical Pitfalls

The full prevention catalogue is in [PITFALLS.md](./PITFALLS.md).

1. **Speech processing destroys tones** — require echo cancellation, noise
   suppression, and AGC off; display actual `getSettings()` and reject an
   unsupported device/profile instead of silently continuing.
2. **Bidirectional becomes self-jamming** — use explicit half-duplex DATA/ACK
   turns, guard/ring-down intervals, local receive suppression, deterministic
   roles, and bounded randomized retry.
3. **Airtime exceeds FIPS liveness** — fragment to short bursts, prioritize ACK
   and FIPS control traffic, bound queues, and keep worst observed valid-frame
   gap below one third of the configured dead timeout.
4. **Packet boundaries leak** — preserve one complete FIPS packet per
   WebSocket message; use epoch, packet/fragment IDs, strict lengths, CRC,
   expiry, and duplicate suppression below FIPS.
5. **Docker Desktop is mistaken for native host networking** — verify TUN,
   capability, interface, route, and MTU in-container; publish only the
   browser bridge; execute the proof ping in the declared Linux namespace.
6. **A lucky bench ping is treated as done** — require repeated peer
   establishment, ten consecutive pings, three cold starts, a 60-second
   recovery drill, fixed geometry/levels, and an audible-only release gate.

## Implications for Roadmap

Based on the combined research, use five short, gated phases. Stop stretch work
as soon as any critical gate is red.

### Phase 1: Kill the Unknowns

**Rationale:** Codec viability, browser audio integrity, TUN operation, and the
small MTU are independent existential risks. Disprove bad assumptions before
building the integration.

**Delivers:** A container-kernel ping through unmodified FIPS/TUN; a
loopback encode/decode fixture; repeated one-way `ggwave` transmission of 114
bytes on both actual laptops; verified raw-ish mic settings; measured airtime;
and a 256-MTU go/no-go result.

**Addresses:** Fixed audible codec, browser arm flow, real OS ping boundary,
applied audio settings.

**Avoids:** Novel-modem schedule loss, speech DSP damage, Docker-host routing
confusion, and discovering MTU incompatibility at the end.

### Phase 2: Add the FIPS Device Boundary

**Rationale:** Prove exact FIPS packet semantics over a deterministic local
path before acoustic loss and timing obscure transport bugs.

**Delivers:** Minimal `TransportHandle::Sound` fork integration, sound config,
static one-peer roles, loopback binary WebSocket, bounded queues, readiness,
epoch/reset behavior, and genuine FIPS peering plus ping over a WS test harness.

**Uses:** Rust, `tokio-tungstenite`, Docker Compose, and complete binary
WebSocket packet messages.

**Avoids:** Editing FIPS routing/crypto, silent queueing, base64/JSON packet
data, stale browser sessions, and ambiguous packet boundaries.

### Phase 3: Build the Reliable Acoustic Link

**Rationale:** Once both boundaries are deterministic, replace the WS harness
with the one remaining unreliable segment and validate it using fixed byte
patterns before live FIPS timers.

**Delivers:** `ggwave` in the live browser audio path, 64-byte DATA fragments,
CRC, bounded reassembly, per-fragment stop-and-wait ACK/retry, duplicate
suppression, half-duplex roles/guards, queue priority, and coarse counters.
Gate on repeated 114-byte, 69-byte, and 256-byte payloads in both directions.

**Addresses:** Framing, fragmentation, integrity, retransmission, duplex
service, backpressure, and operational telemetry.

**Avoids:** Self-jamming, malformed/duplicate delivery, main-thread audio
glitches, whole-packet retransmission, and FIPS heartbeat starvation.

### Phase 4: Establish the Isolated FIPS Ping

**Rationale:** Peering, timers, routing, isolation, and bidirectional ping must
be proven together only after the acoustic device passes independently.

**Delivers:** Stable acoustic FIPS handshake/heartbeat, measured demo timer
profile, isolated receiver, explicit route/transport evidence, and ten
consecutive real `ping -6` exchanges from the declared container namespace. If
needed, a third container supplies the wider-mesh origin.

**Addresses:** The project's core value: a genuine encrypted IPv6 ping and
reply whose only inter-laptop hop is sound.

**Avoids:** Hidden alternate transport, application-level fake echo, macOS TUN
routing improvisation, peer flapping, and accidental bulk traffic.

### Phase 5: Freeze and Rehearse

**Rationale:** For a tomorrow demo, cold-start reliability and diagnosis are
part of the product, not polish.

**Delivers:** Prebuilt/pinned images, role-specific launch commands, one Arm
action, red/green preflight, reset sequence, marked laptop placement/lid
angles/levels, three successful cold starts, and a successful 60-second
recovery drill in stage-like noise.

**Addresses:** Reproducible launch, receiver isolation proof, recovery, and
minimal audience-readable status.

**Avoids:** Browser permission surprises, device switching, stale state,
unrecoverable stage failure, and late dependency/profile changes.

### Phase Ordering Rationale

- Phase 1 front-loads the four decisions that could invalidate the plan:
  codec, audio processing, TUN namespace, and MTU.
- Phase 2 proves FIPS packet boundaries without audio; Phase 3 proves acoustic
  reliability without blaming FIPS; Phase 4 combines only known-good pieces.
- Phase 5 freezes the exact system. Near-ultrasonic mode and visual polish are
  attempted only if all Phase 5 gates already pass.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 1:** Use focused implementation research only if `ggwave` cannot be
  initialized in an `AudioWorklet`, or FIPS rejects the 256-byte MTU. These are
  empirical spikes, not broad literature tasks.
- **Phase 2:** Inspect the pinned FIPS source while planning every
  `TransportHandle`, config, state, MTU, and `ReceivedPacket` change; the
  dispatch is closed and omissions are easy.
- **Phase 4:** Research Docker/host routing only if stakeholders explicitly
  reject a container-kernel ping. On macOS this is a new feature and should not
  silently enter the critical path.

Phases with standard patterns (skip research-phase):

- **Phase 3:** The required envelope, stop-and-wait ARQ, bounds, and worklet
  responsibilities are specified well enough; tune them empirically.
- **Phase 5:** Preflight, pinning, cold-start rehearsal, and recovery are
  operational validation rather than research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | FIPS, browser, WebSocket, Docker, and `ggwave` facts come from official/current sources, but `ggwave` throughput and worklet integration must be proven on the exact laptops. |
| Features | MEDIUM | The acceptance feature set follows the project constraints and standards; actual acoustic reliability and exact FIPS packet mix are empirical. |
| Architecture | HIGH | FIPS integration points and browser/container boundaries were inspected directly; acoustic parameters remain MEDIUM until measured. |
| Pitfalls | HIGH | Browser, FIPS, IPv6, and Docker risks are primary-source backed; room thresholds and modem performance are deliberately treated as calibration gates. |

**Overall confidence:** MEDIUM

### Gaps to Address

- **`ggwave` worklet fit:** Prove WASM initialization and continuous decode in
  the actual Chromium version. Keep the PHY library decision time-boxed.
- **256-byte MTU behavior:** Verify FIPS PMTU propagation, Linux TUN behavior,
  handshake packets, and the exact chosen `ping -s` payload end to end. The
  1280 fallback must be explicit, not an accidental mid-demo change.
- **Measured airtime:** Derive ACK timeout and FIPS handshake/dead timers from
  full encoded frame duration plus guards and at least one retry.
- **Actual hardware channel:** Record sample rate, SNR, clipping, first-attempt
  success, position, lid angle, and volume in both directions in the demo room.
- **Isolation proof wording:** Decide whether the ping origin is the gateway
  container or a third mesh-client container and label it honestly on stage.
- **Browser constraint enforcement:** Confirm whether exact `false` constraints
  succeed on both devices and ensure macOS Voice Isolation is off.

## Sources

### Primary (HIGH confidence)

- [FIPS repository](https://github.com/jmcorgan/fips) and inspected revision
  `fc8ebd5` — transport trait/dispatch, configuration, handshake sizes,
  heartbeat defaults, TUN adapter, and MTU/no-transit-fragmentation design.
- [ggwave repository](https://github.com/ggerganov/ggwave) — release 0.4.3,
  browser/WASM bindings, payload ceiling, ECC, profiles, and stated throughput.
- [RFC 8200 Section 5](https://www.rfc-editor.org/rfc/rfc8200.html#section-5)
  — IPv6 minimum MTU and link-specific handling.
- [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
  — microphone constraints, processing controls, and applied settings.
- [W3C Web Audio API 1.1](https://www.w3.org/TR/webaudio-1.1/) — sample rate,
  render timing, and AudioWorklet behavior.
- [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/)
  and [host networking](https://docs.docker.com/engine/network/drivers/host/)
  — VM boundary, published ports, and layer-4 host-network limitations.
- [Docker runtime privilege and capabilities](https://docs.docker.com/engine/containers/run/)
  — `NET_ADMIN` requirements.

### Secondary (MEDIUM confidence)

- [MDN `getUserMedia`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
  [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet),
  and [WebSocket binary type](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/binaryType)
  — practical browser API behavior and secure-context guidance.
- [Apple Mic Modes](https://support.apple.com/guide/mac-help/use-mic-modes-on-your-mac-mchle82b42f0/mac)
  — avoiding Voice Isolation on macOS.

### Tertiary (LOW confidence)

- Exact fragment size, symbol profile, ACK timeout, retry count, room SNR
  threshold, and 256-vs-1280 outcome are engineering hypotheses until the
  same-day laptop and end-to-end gates pass.

---
*Research completed: 2026-07-23*
*Ready for roadmap: yes*
