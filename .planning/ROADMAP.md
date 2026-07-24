# Roadmap: FIPS over Sound

## Overview

Deliver a rehearsable, genuine IPv6 FIPS peer link whose isolated endpoint is
reachable only over audible sound. A conservative shared profile bootstraps
discovery and control; each pair then measures both acoustic directions,
commits matching settings, and admits FIPS traffic only after the negotiated
link is ready. The FIPS/browser bridge stays codec-neutral, advertises a sound
MTU of at least 1357 bytes, and keeps fragmentation and acoustic reliability
below FIPS. The final proof is a real container-kernel `ping -6` and reply
across the sound-only link, launched with one role argument and explained by a
stateful no-scroll demo interface.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Qualify the Demo Substrate** - Resolve codec, browser-audio, Docker/TUN, and sound-MTU viability on the exact demo laptops.
- [x] **Phase 2: Configure and Establish the Codec-Neutral FIPS Bridge** - Centralize role configuration and make complete FIPS packets safely exchangeable with the browser modem through a first-class sound transport. (completed 2026-07-24)
- [ ] **Phase 3: Negotiate and Deliver Reliable Acoustic Packets** - Bootstrap, calibrate, negotiate, and provide bounded deterministic half-duplex sound delivery beneath the FIPS boundary.
- [ ] **Phase 4: Prove the Sound-Only FIPS Ping** - Connect an otherwise isolated node to the wider mesh solely through the acoustic FIPS link.
- [ ] **Phase 5: Present, Freeze, and Rehearse the Demo** - Provide the one-command A/B experience, stateful no-scroll interface, evidence, diagnostics, and repeatable recovery.

## Phase Details

### Phase 1: Qualify the Demo Substrate

**Goal**: As a demo operator, I want to qualify the exact two laptops with an audible browser-audio path and Docker/TUN preflight, so that FIPS integration starts with either a proven Cyrinx path or an immediate browser-ready fallback.
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

### Phase 2: Configure and Establish the Codec-Neutral FIPS Bridge

**Goal**: As a demo operator, I want to resolve each role from one configuration authority and connect FIPS to an armed local browser modem through a bounded codec-neutral sound bridge, so that complete opaque packets can safely cross the local modem boundary.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: FIPS-01, FIPS-02, FIPS-03, CODEC-01, WEB-04, WEB-05, WEB-06, CONFIG-02
**Success Criteria** (what must be TRUE):

  1. One validated configuration authority resolves role A/B identities, disposable demo nsecs, expected peers, ports, codec capabilities, audio defaults, calibration candidates, retries, and heartbeat thresholds without duplicated secret material.
  2. An operator can run a pinned `jmcorgan/fips` fork with a configurable, first-class sound transport that starts, stops, reports state, and sends and receives complete opaque packets through FIPS's normal transport lifecycle.
  3. The sound transport reports a link MTU of at least 1357 bytes, so FIPS exposes an effective IPv6 MTU of at least 1280 bytes.
  4. The browser and its local container exchange complete packets or timestamped PCM chunks in binary WebSocket messages, never base64 or JSON bulk payloads; the bridge rejects invalid type or size, bounds its queues, and visibly reports ready, disconnected, overflow, and last-error states.
  5. One recovery action resets and reconnects browser, modem state, bridge queues, session, and acoustic epoch, while the FIPS-facing contract remains independent of Cyrinx, Quiet, Hush, or any other codec.

**Plans**: 7/7 plans executed

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Trace one validated role-A FIPS_PACKET through the production bridge in both directions.
- [x] 02-02-PLAN.md — Mechanically import and provenance-lock the exact audited FIPS fork.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-03-PLAN.md — Complete the A/B configuration authority and owned production runner lifecycle.
- [x] 02-04-PLAN.md — Bound both packet directions and make RESET preempt stale bridge work.
- [x] 02-07-PLAN.md — Implement the complete first-class SoundTransport and all 13 FIPS dispatch seams.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-05-PLAN.md — Prove shared-namespace, loopback-only FIPS/bridge topology on the executing Docker engine.
- [x] 02-06-PLAN.md — Wire the armed browser packet adapter and render truthful recovery/transport state.

**UI hint**: yes

### Phase 3: Negotiate and Deliver Reliable Acoustic Packets

**Goal**: As a demo operator, I want to establish a measured and mutually committed acoustic session between both laptops, so that complete FIPS packets receive safe bounded deterministic half-duplex delivery below the FIPS boundary.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: LINK-01, LINK-02, LINK-03, LINK-04, LINK-05, LINK-06, LINK-07, LINK-08, LINK-09, NEG-01, NEG-02, NEG-03, NEG-04, NEG-05, NEG-06, NEG-07
**Success Criteria** (what must be TRUE):

  1. A conservative shared bootstrap profile establishes a versioned, nonce-bound capability handshake and rejects stale sessions, wrong peers, unsupported profiles, corrupt control messages, and invalid state transitions.
  2. The peers send numbered calibration probes in both literal directions over a bounded candidate sweep, preserve measured loss/corruption/duplicate/timing evidence, and may choose different directional transmission settings.
  3. Both peers commit and acknowledge one settings digest before FIPS readiness; unsupported frequency changes are never fabricated, and the pinned audible profile remains a safe fallback.
  4. A complete opaque FIPS transport packet of at least 1357 bytes travels in both roles by fragmenting into integrity-protected acoustic blocks and reassembling below FIPS with exactly-once delivery and bounded memory, expiry, timeout, retry, and backpressure.
  5. Explicit half-duplex turns prioritize acknowledgements and FIPS handshake/heartbeat traffic; sustained loss exposes degraded state and triggers bounded retry, recalibration, fallback, or an actionable error.

**Plans**: 4/7 plans executed

- [x] 03-01-PLAN.md
- [x] 03-02-PLAN.md
- [x] 03-03-PLAN.md
- [x] 03-04-PLAN.md
- [ ] 03-05-PLAN.md
- [ ] 03-06-PLAN.md
- [ ] 03-07-PLAN.md

### Phase 4: Prove the Sound-Only FIPS Ping

**Goal**: As a demo participant, I want to reach the otherwise isolated FIPS node as an authenticated acoustic peer of the wider mesh, so that it returns a real kernel IPv6 echo reply across the same sound link.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: FIPS-04, FIPS-05, DEPLOY-03, DEPLOY-04, DEPLOY-05, DEMO-01, DEMO-02, DEMO-03, DEMO-04, CONFIG-04
**Success Criteria** (what must be TRUE):

  1. Two configured sound peers complete the normal FIPS handshake using existing FIPS identity and link encryption only after the acoustic settings digest is acknowledged, remain alive through normal heartbeat traffic, and reconnect after a bounded acoustic or browser interruption.
  2. The receiving FIPS node has no enabled or usable FIPS transport other than sound; the sending node connects it to the wider mesh, and browser bridge ports remain local to their individual laptops so they cannot serve as an alternate inter-laptop path.
  3. A participant FIPS node or dedicated mesh-client container issues a real kernel `ping -6` to the acoustically isolated node through the sending node, and the isolated node returns the real ICMPv6 echo reply over that acoustic FIPS link.
  4. Before and during the ping, an operator can visibly show the authenticated peer, sound transport, active link state, absence of another receiving-node transport, and correlated acoustic TX/RX, complete-packet, fragment, integrity-failure, retry, and ICMPv6 counters.

**Plans**: TBD
**UI hint**: yes

### Phase 5: Present, Freeze, and Rehearse the Demo

**Goal**: As a demo operator, I want to launch the sound-only ping proof with one role argument and explain it on two no-scroll screens, so that the demo preserves evidence and can be checked recovered and repeated without improvised setup.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: DEPLOY-01, DEMO-05, DEMO-06, DEMO-07, DEMO-08, CONFIG-01, CONFIG-03, UI-01, UI-02, UI-03, UI-04, UI-05, OBS-01
**Success Criteria** (what must be TRUE):

  1. `npm run demo -- a` and `npm run demo -- b` are the canonical complete-stack commands; role is the only required difference, preflight is automatic, disposable identities stay private, and owned processes/audio settings are cleaned on every exit path.
  2. Each screen shows the current discovery-through-error state, relevant handshake/calibration/commit details, and connected TX/RX, heartbeat, profile, quality, retry, throughput, FIPS, and ping evidence without scrolling at 1366×768 or 1440×900; existing diagnostics remain in Debug mode.
  3. Every run writes one structured timestamped evidence directory and the repository documents prerequisites, expected states, permission behavior, placement, ping, reset, recalibration, recovery, artifacts, limitations, and a presenter script.
  4. Automated two-role and real single-laptop speaker-to-microphone paths prove startup, bidirectional transport, state rendering, cleanup, and recovery; exact two-laptop Open air evidence remains explicitly distinguishable and is never inferred.
  5. With the setup frozen on the exact demo laptops, the final operator checkpoint covers ten consecutive acoustic IPv6 ping exchanges, three cold starts, and recovery from one interruption within 60 seconds.

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Qualify the Demo Substrate | 9/10 | In Progress|  |
| 2. Configure and Establish the Codec-Neutral FIPS Bridge | 7/7 | Complete    | 2026-07-24 |
| 3. Negotiate and Deliver Reliable Acoustic Packets | 4/7 | In Progress|  |
| 4. Prove the Sound-Only FIPS Ping | 0/TBD | Not started | - |
| 5. Present, Freeze, and Rehearse the Demo | 0/TBD | Not started | - |
