# FIPS over Sound

## What This Is

FIPS over Sound is a functional proof of concept and live demo in which two
laptops form a bidirectional FIPS peer link using audible sound waves as the
underlying transport. Each laptop runs a fork of
[`jmcorgan/fips`](https://github.com/jmcorgan/fips) in Docker, while a browser
owns microphone capture and speaker output so the acoustic implementation
remains independent of host audio APIs.

The sending node remains connected to the wider FIPS mesh. The receiving node
is otherwise offline and reachable only through the sound transport, allowing
participants to send a real IPv6 ping to it across an intentionally absurd but
genuine network hop.

## Core Value

A real OS-level IPv6 ping must travel in both directions across a live FIPS
peer link whose only connection to the isolated node is sound.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Fork and minimally extend FIPS with a sound transport adapter that
      participates in normal FIPS peering.
- [ ] Encode complete FIPS transport packets into acoustic frames and decode
      them on the peer, including any link-local fragmentation and reassembly
      needed beneath FIPS.
- [ ] Keep the FIPS-facing modem boundary codec-neutral and select the physical
      codec through a strict 90-minute two-laptop Cyrinx gate with an immediate
      browser-ready fallback.
- [ ] Carry traffic bidirectionally over microphones and speakers so FIPS
      handshake, heartbeat, peering, and reply traffic all work.
- [ ] Bridge each Dockerized FIPS daemon to a browser that exclusively owns
      microphone capture and synthesized speaker output.
- [ ] Run a two-laptop topology where the receiving node has no active FIPS
      transport other than sound and the sending node connects it to the wider
      mesh.
- [ ] Demonstrate a real OS-level IPv6 ping from a wider-mesh participant to
      the isolated node and receive the reply over sound.
- [ ] Provide a reproducible, rehearsable launch procedure for likely
      macOS/macOS or macOS/Linux laptop combinations.
- [ ] Launch the complete role-specific stack with `npm run demo -- a` or
      `npm run demo -- b`, with the role as the only required difference.
- [ ] Keep disposable demo identities, peer mappings, ports, codec
      capabilities, calibration candidates, and timing in one validated
      configuration source.
- [ ] Establish each acoustic session through a robust bootstrap handshake,
      capability exchange, bidirectional calibration sweep, and matching
      settings commitment before FIPS traffic is admitted.
- [ ] Detect sustained loss through link heartbeats and automatically enter a
      bounded degraded/recalibration path.
- [ ] Present a stateful, audience-readable, no-scroll interface on both
      laptops while retaining the existing diagnostic details in Debug mode.
- [ ] Make audible modem-like signalling the default demonstration mode.
- [ ] Support a near-ultrasonic mode if it can be added without risking the
      audible end-to-end demo.

### Out of Scope

- Production-grade acoustic networking — this is a one-day proof of concept,
  not a general-purpose modem.
- High throughput — correctness sufficient for FIPS control traffic and ping
  takes priority over bandwidth.
- Native microphone or speaker integration — browsers own audio to avoid
  platform-specific host APIs.
- Mobile-device support — the demonstration targets two laptops.
- More than one acoustic peer pair — multiplexing is deferred unless the core
  demo is already reliable.
- Strong resistance to deliberate acoustic interference — integrity beyond
  framing, checksums, and basic error detection is a stretch goal.
- Elaborate waveform or spectrum visualization — the stateful demo interface
  is required, but decorative DSP visualization remains subordinate.
- Changes to FIPS routing, identity, or encryption protocols — the fork should
  add the smallest viable transport integration.

## Context

- The demo is for Sovereign Engineering demo day and is intended to show,
  through absurdity and a memeable experience, that FIPS can operate over any
  transport.
- The target upstream is `https://github.com/jmcorgan/fips`, the Free
  Internetworking Peering System. FIPS carries encrypted IPv6 traffic across
  arbitrary transports and already implements peer handshake, heartbeat,
  routing, and per-link MTU reporting.
- The current FIPS transport interface exposes transport identity, state, MTU,
  per-link MTU, lifecycle, packet send, discovery, and connection policy.
  Concrete transports are represented by a closed `TransportHandle` enum, so
  the proof of concept requires a small fork rather than only configuration.
- FIPS does not fragment packets at transit nodes. The sound link may fragment
  and reassemble acoustic frames below the FIPS transport boundary while
  presenting complete packets to FIPS.
- FIPS defaults several transports to a 1280-byte link MTU and has 114-byte and
  69-byte handshake frames. Acoustic encoding research must balance the
  reported MTU, packet duration, error rate, and demo-room noise.
- The bridge between browser and container is not yet selected. It must carry
  binary data bidirectionally with low implementation overhead; a local
  WebSocket is the leading candidate. The selected codec may run in the
  browser, or the browser may stream PCM to a container-side codec worker.
- `ggwave` is too slow to be the default FIPS codec at its documented
  8–16 bytes/second. Cyrinx 2 is the primary time-boxed spike because its
  measured wideband PHY operates in the tens-of-kilobits-per-second range, but
  its batch decoder and lack of browser/laptop-to-laptop qualification prevent
  committing to it without an empirical gate.
- Likely hardware is two MacBooks or one MacBook and one Linux laptop. Docker
  and a Chromium-class browser should be the only platform-specific runtime
  assumptions.
- Audible modem-like tones are part of the desired experience. Near-ultrasonic
  operation is optional and must not consume time needed to stabilize audible
  mode.

## Constraints

- **Timeline**: Demo day is tomorrow — every decision must optimize for a
  reliable, rehearsable vertical slice within one day.
- **Functional**: The final proof must be an actual OS-level IPv6 ping, not a
  simulated UI event or application-only echo.
- **Isolation**: The receiving node must be offline except for its FIPS sound
  transport so the acoustic hop is demonstrably real.
- **Architecture**: FIPS runs in Docker and browsers own audio input/output —
  this avoids native audio integration and keeps the design portable.
- **Compatibility**: The demo should work with macOS/macOS or macOS/Linux
  laptops using Docker and a Chromium-class browser.
- **Protocol**: FIPS must receive complete transport packets; any acoustic
  fragmentation, sequencing, checksums, retransmission, or reassembly belongs
  below its transport interface.
- **MTU**: The sound transport should expose at least 1357 bytes so FIPS can
  provide a 1280-byte effective IPv6 MTU after its 77-byte overhead; codec
  blocks may be smaller and reassembled below FIPS.
- **Scope**: Duplex peering, heartbeat, and ping are mandatory; visualization,
  multiplexing, ultrasonic mode, and stronger interference resistance are
  subordinate stretch goals.
- **Operation**: The canonical demo path is `npm run demo -- a|b`; configuration
  must be centralized and no source editing or multi-terminal choreography may
  be required.
- **Negotiation**: Bootstrap uses a conservative shared profile. Frequency is
  negotiable only through mutually supported, versioned modem profiles; Web
  Audio playback speed is not a carrier-frequency control.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork `jmcorgan/fips` | Its concrete transport dispatch is closed and a sound transport must participate as a first-class FIPS link | — Pending |
| Put microphone and speaker I/O in the browser | Browser permissions and Web Audio avoid native, host-specific audio integrations | — Pending |
| Run FIPS and the bridge in Docker | Makes the FIPS environment reproducible across likely demo laptops | — Pending |
| Require a real IPv6 ping | Proves the acoustic hop carries actual FIPS mesh traffic rather than a staged application effect | — Pending |
| Use audible signalling by default | The recognizable modem sound is central to the memeable demo experience | — Pending |
| Treat near-ultrasonic signalling as opportunistic | It is useful but cannot threaten the one-day core deliverable | — Pending |
| Fragment only beneath the FIPS transport boundary if needed | FIPS itself does not fragment; acoustic frames need manageable on-air duration and recovery | — Pending |
| Keep the modem bridge codec-neutral | The one-day implementation must be able to replace a failed PHY spike without rewriting the FIPS fork | — Pending |
| Gate Cyrinx for 90 minutes before selection | Its measured throughput fits FIPS, but its live browser and two-laptop path is not yet qualified | — Pending |
| Advertise a minimum 1357-byte sound MTU | FIPS subtracts 77 bytes from its transport MTU and IPv6 requires an effective 1280-byte path | — Pending |
| Use one role argument for the complete demo | Demo-day reliability depends on eliminating manual configuration and launch choreography | — Pending |
| Centralize disposable A/B identities and settings | Demo nsecs may be hard-coded, but must be replaceable in one place and never printed | — Pending |
| Bootstrap before adapting | Peers need one known robust control channel before they can measure and negotiate better directional settings | — Pending |
| Commit a settings digest before FIPS readiness | Both sides must prove they selected the same session configuration before admitting network traffic | — Pending |
| Make the primary UI stateful and no-scroll | Two visible laptop screens must explain discovery, calibration, connection, and traffic to an audience at a glance | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-23 after high-throughput codec decision*
