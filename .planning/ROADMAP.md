# Roadmap: FIPS over Sound

## Overview

Deliver a rehearsable, genuine IPv6 FIPS peer link whose isolated endpoint is
reachable only over audible sound. The critical path first qualifies the exact
laptops, browser audio, Docker/TUN runtime, and acoustic PHY: Cyrinx receives
one strict 90-minute bidirectional gate and is abandoned immediately for a
browser-ready audible fallback if it fails. The resulting FIPS/browser bridge
stays codec-neutral, advertises a sound MTU of at least 1357 bytes, and keeps
fragmentation and acoustic reliability below FIPS. `ggwave` remains a
diagnostic/bootstrap option, not the primary transport; Hush is not the
default. The final proof is a real container-kernel `ping -6` and reply across
the sound-only link, followed by cold-start and recovery rehearsals.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Qualify the Demo Substrate** - Resolve codec, browser-audio, Docker/TUN, and sound-MTU viability on the exact demo laptops.
- [ ] **Phase 2: Establish the Codec-Neutral FIPS Bridge** - Make complete FIPS packets safely exchangeable with the browser modem through a first-class sound transport.
- [ ] **Phase 3: Deliver Reliable Acoustic Packets** - Provide bounded, deterministic half-duplex sound delivery beneath the FIPS boundary.
- [ ] **Phase 4: Prove the Sound-Only FIPS Ping** - Connect an otherwise isolated node to the wider mesh solely through the acoustic FIPS link.
- [ ] **Phase 5: Freeze and Rehearse the Demo** - Make the exact two-laptop proof reproducible, diagnosable, and recoverable.

## Phase Details

### Phase 1: Qualify the Demo Substrate

**Goal**: The exact two demo laptops have a qualified, intentionally audible browser-audio path and a Docker/TUN preflight, leaving either a proven Cyrinx path or an immediate browser-ready fallback before FIPS integration begins.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: CODEC-02, CODEC-03, CODEC-04, WEB-01, WEB-02, WEB-03, WEB-07, DEPLOY-02
**Success Criteria** (what must be TRUE):

  1. On each selected laptop, an operator can arm the modem in one browser action; it requests microphone permission, starts or resumes audio, displays the actually applied mono 48 kHz capture settings with echo cancellation, noise suppression, and automatic gain control disabled, and visibly fails preflight when the selected profile cannot be satisfied.
  2. The same Chromium browser qualification path operates in both directions on the two exact macOS/macOS or macOS/Linux demo laptops.
  3. Within a strict 90-minute Cyrinx qualification, the operator can send the defined unique 256-byte and 1536-byte payload corpus in both directions and selects Cyrinx only when the byte-integrity, cold-acquisition, airtime, and duplicate-delivery gates pass; otherwise the operator immediately uses the browser-ready fallback rather than extending the spike.
  4. The selected demo codec has one fixed, rehearsed, intentionally audible profile, and a Dockerized FIPS preflight has `/dev/net/tun` plus only the network-administration capability needed to configure its Linux interface.

**Plans**: 9/10 plans executed

- [x] 01-01-PLAN.md
- [x] 01-02-PLAN.md
- [x] 01-03-PLAN.md
- [x] 01-04-PLAN.md
- [x] 01-05-PLAN.md
- [x] 01-06-PLAN.md
- [x] 01-07-PLAN.md — Ship the authoritative production runner and verified same-origin codec-asset cache
- [x] 01-08-PLAN.md — Run the fixed Quiet fallback, independent corpus roles, reports, and named verifier
- [x] 01-09-PLAN.md — Add the bounded pinned Cyrinx C batch path with immediate Quiet fallback
- [ ] 01-10-PLAN.md — Collect exact-laptop open-air and exact-host TUN evidence

**UI hint**: yes

### Phase 2: Establish the Codec-Neutral FIPS Bridge

**Goal**: FIPS can use a codec-neutral sound transport to exchange complete opaque packets with an armed local browser modem through a bounded binary bridge.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: FIPS-01, FIPS-02, FIPS-03, CODEC-01, WEB-04, WEB-05, WEB-06
**Success Criteria** (what must be TRUE):

  1. An operator can run a pinned `jmcorgan/fips` fork with a configurable, first-class sound transport that starts, stops, reports state, and sends and receives complete opaque packets through FIPS's normal transport lifecycle.
  2. The sound transport reports a link MTU of at least 1357 bytes, so FIPS exposes an effective IPv6 MTU of at least 1280 bytes.
  3. The browser and its local container exchange complete packets or timestamped PCM chunks in binary WebSocket messages, never base64 or JSON bulk payloads; the bridge rejects invalid type or size, bounds its queues, and visibly reports ready, disconnected, overflow, and last-error states.
  4. One operator recovery action resets and reconnects the browser, modem state, bridge queues, and acoustic epoch.
  5. The FIPS-facing contract stays unchanged when the qualified acoustic codec implementation is replaced, so no Cyrinx-, Hush-, `ggwave`-, or fallback-specific detail leaks into FIPS.

**Plans**: TBD
**UI hint**: yes

### Phase 3: Deliver Reliable Acoustic Packets

**Goal**: Each laptop's modem provides safe, bounded, deterministic half-duplex acoustic delivery of complete FIPS packets below the FIPS boundary.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: LINK-01, LINK-02, LINK-03, LINK-04, LINK-05, LINK-06, LINK-07, LINK-08, LINK-09
**Success Criteria** (what must be TRUE):

  1. A complete opaque FIPS transport packet of at least 1357 bytes travels in both roles by fragmenting into codec-sized acoustic blocks and reassembling below FIPS, with exactly one complete packet delivered for each accepted transmission.
  2. Every acoustic unit carries its protocol version, packet and fragment identity, type, declared length, and integrity value; malformed or corrupt units, oversized assemblies, expired assemblies, and partial packets never reach FIPS.
  3. The two peers use explicit half-duplex turns and guard intervals, prioritize acknowledgements and FIPS handshake or heartbeat traffic, and use measured-airtime-derived bounded acknowledgement, timeout, and retry behavior without deliberate transmission overlap.
  4. Duplicate data or acknowledgement units cannot cause duplicate FIPS delivery, while slow or failed delivery applies bounded backpressure and exposes a visible error instead of allowing packet growth without limit.

**Plans**: TBD

### Phase 4: Prove the Sound-Only FIPS Ping

**Goal**: An otherwise isolated FIPS node is a real authenticated acoustic peer of the wider mesh and returns a kernel IPv6 echo reply across the same sound link.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: FIPS-04, FIPS-05, DEPLOY-03, DEPLOY-04, DEPLOY-05, DEMO-01, DEMO-02, DEMO-03, DEMO-04
**Success Criteria** (what must be TRUE):

  1. Two statically configured sound peers complete the normal FIPS handshake using existing FIPS identity and link encryption, remain alive through normal heartbeat traffic, and reconnect after a bounded acoustic or browser interruption.
  2. The receiving FIPS node has no enabled or usable FIPS transport other than sound; the sending node connects it to the wider mesh, and browser bridge ports remain local to their individual laptops so they cannot serve as an alternate inter-laptop path.
  3. A participant FIPS node or dedicated mesh-client container issues a real kernel `ping -6` to the acoustically isolated node through the sending node, and the isolated node returns the real ICMPv6 echo reply over that acoustic FIPS link.
  4. Before and during the ping, an operator can visibly show the authenticated peer, sound transport, active link state, absence of another receiving-node transport, and correlated acoustic TX/RX, complete-packet, fragment, integrity-failure, retry, and ICMPv6 counters.

**Plans**: TBD
**UI hint**: yes

### Phase 5: Freeze and Rehearse the Demo

**Goal**: The exact two-laptop sound-only ping proof can be launched, checked, recovered, and repeated by an operator without improvised setup.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: DEPLOY-01, DEMO-05, DEMO-06, DEMO-07, DEMO-08
**Success Criteria** (what must be TRUE):

  1. An operator can start every role from version-pinned Docker Compose configuration and follow repository instructions covering launch order, browser permissions, laptop placement, volume, expected ready states, isolation checks, the ping command, and reset procedure.
  2. With the setup frozen on the exact demo laptops, ten consecutive acoustic IPv6 ping request/reply exchanges complete successfully.
  3. From stopped containers and unopened browser pages, the operator completes three successful cold starts using the documented procedure.
  4. After one browser, bridge, or acoustic-link interruption, the operator restores a successful ping within 60 seconds using the documented recovery action.

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Qualify the Demo Substrate | 9/10 | In Progress|  |
| 2. Establish the Codec-Neutral FIPS Bridge | 0/TBD | Not started | - |
| 3. Deliver Reliable Acoustic Packets | 0/TBD | Not started | - |
| 4. Prove the Sound-Only FIPS Ping | 0/TBD | Not started | - |
| 5. Freeze and Rehearse the Demo | 0/TBD | Not started | - |
