# Requirements: FIPS over Sound

**Defined:** 2026-07-23
**Core Value:** A real OS-level IPv6 ping must travel in both directions across
a live FIPS peer link whose only connection to the isolated node is sound.

## v1 Requirements

Requirements for the Sovereign Engineering demo-day proof of concept.

### FIPS Integration

- [ ] **FIPS-01**: Operator can run a pinned fork of `jmcorgan/fips` containing
      a first-class, configurable sound transport.
- [ ] **FIPS-02**: FIPS can start, stop, inspect, send through, and receive
      complete opaque packets from the sound transport through its normal
      transport lifecycle.
- [ ] **FIPS-03**: Sound transport reports a link MTU of at least 1357 bytes so
      FIPS exposes an effective IPv6 MTU of at least 1280 bytes.
- [ ] **FIPS-04**: Two statically configured sound peers complete the normal
      FIPS handshake and use existing FIPS identity and link encryption without
      protocol-specific bypasses.
- [ ] **FIPS-05**: An established sound peer remains alive through normal FIPS
      heartbeat traffic and reconnects after a bounded acoustic or browser
      interruption.

### Codec Selection

- [ ] **CODEC-01**: The FIPS-facing modem boundary can exchange complete packets
      without depending on a particular acoustic codec implementation.
- [ ] **CODEC-02**: Operator can run a time-boxed Cyrinx qualification on both
      exact demo laptops in both acoustic directions.
- [ ] **CODEC-03**: Cyrinx is selected only if it passes the defined 90-minute
      byte-integrity, acquisition, airtime, and duplicate-delivery gates;
      otherwise the implementation switches immediately to the browser-ready
      fallback.
- [ ] **CODEC-04**: The selected codec provides a fixed, rehearsed, intentionally
      audible profile as the mandatory demo default.

### Acoustic Link

- [ ] **LINK-01**: Every acoustic data unit identifies its protocol version,
      packet, fragment, type, declared length, and integrity value.
- [ ] **LINK-02**: The sound link rejects malformed or corrupt acoustic units
      before any bytes are delivered to FIPS.
- [ ] **LINK-03**: The sound link fragments and reassembles an opaque FIPS
      transport packet of at least 1357 bytes using codec-sized blocks entirely
      below the FIPS boundary.
- [ ] **LINK-04**: Reassembly has explicit limits for packet size, fragment
      count, memory, and expiry and never delivers a partial packet.
- [ ] **LINK-05**: Duplicate acoustic data or acknowledgement units do not cause
      duplicate FIPS packet delivery.
- [ ] **LINK-06**: Lost acoustic units use bounded acknowledgement, timeout,
      and retry behavior whose values are derived from measured frame airtime.
- [ ] **LINK-07**: The acoustic channel provides deterministic half-duplex
      bidirectional service with turn control and guard intervals so peer
      transmissions do not intentionally overlap.
- [ ] **LINK-08**: Acoustic acknowledgements and FIPS handshake or heartbeat
      traffic take priority over ordinary queued data.
- [ ] **LINK-09**: Slow or failed acoustic delivery produces bounded
      backpressure and a visible error rather than unbounded packet growth.

### Browser and Bridge

- [ ] **WEB-01**: Operator can activate the modem with one browser action that
      requests microphone access, satisfies autoplay policy, and starts or
      resumes the audio context.
- [ ] **WEB-02**: The browser requests mono 48 kHz capture with echo
      cancellation, noise suppression, and automatic gain control disabled.
- [ ] **WEB-03**: The browser displays the capture settings actually applied
      and visibly fails preflight when the selected codec's required audio
      format is unavailable.
- [ ] **WEB-04**: Browser and local container exchange binary WebSocket
      messages carrying complete packets or timestamped PCM chunks as required
      by the selected codec, without base64 or JSON encoding of bulk data.
- [ ] **WEB-05**: The bridge validates message type and size, bounds all queues,
      and exposes ready, disconnected, overflow, and last-error states.
- [ ] **WEB-06**: Operator can reset and reconnect the browser, modem state,
      bridge queues, and acoustic epoch through one recovery action.
- [ ] **WEB-07**: The same browser implementation operates in Chromium on the
      two selected macOS/macOS or macOS/Linux demo laptops.

### Deployment and Isolation

- [ ] **DEPLOY-01**: Operator can start each role from a reproducible,
      version-pinned Docker Compose configuration.
- [ ] **DEPLOY-02**: Each FIPS container receives `/dev/net/tun` and only the
      capability required to configure its Linux network interface.
- [ ] **DEPLOY-03**: The receiving FIPS node runs with no enabled or usable FIPS
      transport other than sound.
- [ ] **DEPLOY-04**: The sending FIPS node connects the sound peer to the wider
      FIPS mesh or a dedicated participant mesh-client node.
- [ ] **DEPLOY-05**: Browser bridge ports are local to their respective laptop
      and cannot provide an alternate inter-laptop packet path.

### Demonstration and Verification

- [ ] **DEMO-01**: A participant FIPS node or dedicated mesh-client container
      can issue a real kernel `ping -6` to the acoustically isolated node
      through the sending node.
- [ ] **DEMO-02**: The isolated node returns the real kernel ICMPv6 echo reply
      across the same acoustic FIPS link.
- [ ] **DEMO-03**: Operator can visibly show the authenticated FIPS peer, sound
      transport, active link state, and absence of another receiving-node FIPS
      transport before the ping.
- [ ] **DEMO-04**: Operator can visibly correlate acoustic TX/RX activity with
      complete-packet, fragment, integrity-failure, retry, and ICMPv6 counters
      during the demonstration.
- [ ] **DEMO-05**: The repository documents exact launch order, browser
      permission steps, laptop placement, volume, expected ready states,
      isolation checks, ping command, and reset procedure.
- [ ] **DEMO-06**: The frozen setup completes ten consecutive acoustic IPv6
      ping request/reply exchanges on the exact demo laptops.
- [ ] **DEMO-07**: The frozen setup completes three cold starts from stopped
      containers and unopened browser pages.
- [ ] **DEMO-08**: Operator can recover from one browser, bridge, or acoustic
      link interruption and restore a successful ping within 60 seconds.

## v2 Requirements

Deferred until the audible demo passes every v1 reliability gate.

### Additional Codecs

- **CODEC-05**: Operator can select a rehearsed near-ultrasonic profile without
  changing the FIPS-facing transport.
- **CODEC-06**: The modem can select among multiple pre-qualified fixed profiles
  based on measured channel conditions.

### Presentation

- **VIS-01**: Audience can view a live waveform or spectrum visualization that
  does not interfere with audio processing.
- **VIS-02**: Audience can view a polished packet journey from FIPS packet to
  acoustic blocks and back.

### Networking

- **NET-01**: More than one acoustic peer can share a room through addressing
  and collision-aware multiplexing.
- **NET-02**: Host-native macOS applications can reach containerized FIPS
  destinations without running the acceptance command inside Linux.

### Resilience

- **SAFE-01**: Sound link detects and mitigates deliberate non-protocol acoustic
  interference beyond checksum rejection and bounded retry.
- **PERF-01**: Sound link supports adaptive modulation or windowed ARQ for
  materially higher sustained goodput.

## Out of Scope

Explicit exclusions for the demo-day milestone.

| Feature | Reason |
|---------|--------|
| Simultaneous acoustic full duplex | Consumer laptop speaker-to-microphone echo and collisions add risk; deterministic half-duplex still provides bidirectional networking |
| General web, file-transfer, or bulk TCP demonstration | The milestone proves transport viability with real IPv6 ping, not useful broadband service |
| Novel modem design from scratch | Existing codecs must be evaluated before spending the one-day deadline on DSP research |
| Production-grade acoustic networking | Hardware diversity, range, channel adaptation, and long-duration soak testing exceed the proof-of-concept scope |
| Mobile and broad browser support | The demo is pinned to two known laptops and Chromium |
| Native host audio integration | Browser ownership of microphone and speaker is an explicit portability constraint |
| Acoustic authentication or encryption | FIPS already supplies peer identity and encryption; the acoustic layer supplies transmission integrity only |
| Hostile-jamming resistance | Anti-jamming is a separate research problem and not needed to prove the absurd transport |
| More than one acoustic peer pair | Multi-peer discovery, addressing, and channel access would jeopardize the fixed two-node demo |

## Traceability

Roadmap phase mapping is populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FIPS-01 | TBD | Pending |
| FIPS-02 | TBD | Pending |
| FIPS-03 | TBD | Pending |
| FIPS-04 | TBD | Pending |
| FIPS-05 | TBD | Pending |
| CODEC-01 | TBD | Pending |
| CODEC-02 | TBD | Pending |
| CODEC-03 | TBD | Pending |
| CODEC-04 | TBD | Pending |
| LINK-01 | TBD | Pending |
| LINK-02 | TBD | Pending |
| LINK-03 | TBD | Pending |
| LINK-04 | TBD | Pending |
| LINK-05 | TBD | Pending |
| LINK-06 | TBD | Pending |
| LINK-07 | TBD | Pending |
| LINK-08 | TBD | Pending |
| LINK-09 | TBD | Pending |
| WEB-01 | TBD | Pending |
| WEB-02 | TBD | Pending |
| WEB-03 | TBD | Pending |
| WEB-04 | TBD | Pending |
| WEB-05 | TBD | Pending |
| WEB-06 | TBD | Pending |
| WEB-07 | TBD | Pending |
| DEPLOY-01 | TBD | Pending |
| DEPLOY-02 | TBD | Pending |
| DEPLOY-03 | TBD | Pending |
| DEPLOY-04 | TBD | Pending |
| DEPLOY-05 | TBD | Pending |
| DEMO-01 | TBD | Pending |
| DEMO-02 | TBD | Pending |
| DEMO-03 | TBD | Pending |
| DEMO-04 | TBD | Pending |
| DEMO-05 | TBD | Pending |
| DEMO-06 | TBD | Pending |
| DEMO-07 | TBD | Pending |
| DEMO-08 | TBD | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 0
- Unmapped: 38

---
*Requirements defined: 2026-07-23*
*Last updated: 2026-07-23 after initial definition*
