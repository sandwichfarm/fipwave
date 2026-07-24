---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 04
current_phase_name: prove-the-sound-only-fips-ping
status: planning
stopped_at: Phase 03 software verified; physical acceptance deferred
last_updated: "2026-07-24T08:41:39.000Z"
last_activity: 2026-07-24
last_activity_desc: Phase 03 software verified; physical acceptance deferred
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 24
  completed_plans: 23
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** A real OS-level IPv6 ping must travel in both directions across a live FIPS peer link whose only connection to the isolated node is sound.
**Current focus:** Phase 04 — prove-the-sound-only-fips-ping

## Current Position

Phase: 04 (prove-the-sound-only-fips-ping) — PLANNING
Plan: 0 of TBD
Status: Ready to plan
Last activity: 2026-07-24 — Phase 03 software verified; physical acceptance deferred

Progress: [██████████] 96%

## Performance Metrics

**Velocity:**

- Total plans completed: 7
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 2 | 7 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01-qualify-the-demo-substrate P01 | 4min | 1 tasks | 4 files |
| Phase 01-qualify-the-demo-substrate P02 | 6min | 2 tasks | 11 files |
| Phase 01-qualify-the-demo-substrate P03 | 14min | 2 tasks | 10 files |
| Phase 01-qualify-the-demo-substrate P04 | 4min | 3 tasks | 10 files |
| Phase 01 P05 | 11min | 3 tasks | 11 files |
| Phase 01 P06 | 8min | 2 tasks | 9 files |
| Phase 01 P07 | 42min | 3 tasks | 11 files |
| Phase 01 P08 | 35min | 3 tasks | 10 files |
| Phase 01 P09 | 114min | 3 tasks | 32 files |
| Phase 02 P01 | 5min | 1 tasks | 5 files |
| Phase 02 P02 | 4min | 1 tasks | 674 files |
| Phase 02 P03 | 6min | 2 tasks | 6 files |
| Phase 02 P04 | 8min | 2 tasks | 3 files |
| Phase 02 P07 | 11min | 2 tasks | 5 files |
| Phase 02 P05 | 22min | 2 tasks | 9 files |
| Phase 02 P06 | 10min | 3 tasks | 8 files |
| Phase 03 P01 | 35m | 2 tasks | 9 files |
| Phase 03 P03 | 8m | 2 tasks | 4 files |
| Phase 03 P02 | 10m | 2 tasks | 5 files |
| Phase 03 P04 | 11m | 2 tasks | 2 files |
| Phase 03 P05 | 6m | 2 tasks | 2 files |
| Phase 03 P06 | 18m | 2 tasks | 4 files |
| Phase 03 P07 | 18m | 2 tasks | 8 files |

## Accumulated Context

### Decisions

Recent decisions affecting current work:

- Phase 2: FIPS uses a first-class codec-neutral SoundTransport with a strict
  1357-byte minimum link MTU and complete opaque-packet boundary.

- Phase 2: One validated A/B resolver owns disposable identities, peer mapping,
  ports, audio/profile defaults, retry, and heartbeat values; public state
  never includes nsecs.

- Phase 2: Browser/FIPS traffic stays on a loopback-only binary WebSocket
  bridge; epoch and socket-generation gates reject stale recovery work.

- Phase 1: Cyrinx gets a strict 90-minute exact-laptop bidirectional qualification and must yield immediately to a browser-ready audible fallback on failure.
- Phase 1: The newer throughput reassessment governs: keep the bridge codec-neutral, require at least a 1357-byte sound MTU, do not make `ggwave` primary, and do not make Hush default.
- Phase 4: The acceptance proof is a real container-kernel `ping -6`; the isolated receiver has no alternate FIPS transport.
- [Phase ?]: Phase 01 uses a fixed eight-package npm allowlist with normalized upstream repository, engine, integrity, release-time, and fetch-time evidence.
- [Phase ?]: Registry audit generation requires active Node 22.23.1; validation-only modes remain portable for later lockfile checks.
- [Phase ?]: Strict tsc owns TypeScript validation while ESLint remains parser-free under the audited package set.
- [Phase ?]: Future Wave 0 commands terminate as argument-safe seams until their owning plans implement them.
- [Phase ?]: Browser audio readiness is derived from applied settings and live context/worklet evidence; unknown values fail closed.
- [Phase ?]: Browser audio reset increments an epoch and rejects stale media, worklet, and PCM playback completion.
- [Phase ?]: FWAV v1 evidence is codec-neutral and only two exact named Open air reports can select a profile.
- [Phase ?]: Cyrinx gets one immutable 90-minute qualification window; a hard miss or expiry immediately routes to Quiet, and Quiet failure is unqualified.
- [Phase ?]: Fixture and loopback results remain human_needed; exact named Open air reports are required for a selection.
- [Phase ?]: Docker/TUN preflight runs with network_mode none, no published ports, and source-plus-inspect authority evidence.
- [Phase ?]: Production runner verifies the complete codec lock before serving only an exact browser asset allowlist.
- [Phase ?]: Quiet uses fixed audible-7k-channel-0 with local onFinish plus guard scheduling only; canonical selection requires runner-stamped exact-host Open-air evidence.
- [Phase ?]: Phase 2: The existing loopback bridge owns separate browser/FIPS packet roles and one epoch authority.
- [Phase ?]: Phase 2: FIPS_PACKET is opaque binary FWAV with no codec or PCM metadata, and counters advance only after forwarding.
- [Phase ?]: Phase 2: FIPS is vendored at immutable commit fc8ebd5 with MIT license, Rust 1.94.1, pre-patch checksums, and no mutable build fetch.
- [Phase ?]: Phase 2: The sound transport may use only direct tokio-tungstenite =0.30.0 while reusing upstream Tokio and futures.
- [Phase ?]: Phase 2: A/B config uses exact-schema overrides, distinct canonical endpoint ports, and a public allowlist that never includes nsecs.
- [Phase ?]: Phase 2: ResourceOwner closes only registered return handles in reverse order and startup failures clean only resources already owned.
- [Phase ?]: Reject packet sends while the opposite endpoint is unavailable instead of retaining retryable packet data.
- [Phase ?]: Treat RESET acknowledgements as bridge-originated frames so they cannot be echoed back as reset requests.
- [Phase ?]: Sound configuration exposes only loopback bridge endpoint, static peer identity, MTU, and queue bounds.
- [Phase ?]: A local sound worker being Up never authorizes packet traffic until the current browser epoch is armed.
- [Phase ?]: FIPS shares only the bridge service network namespace and never publishes its packet endpoint.
- [Phase ?]: The browser runner stays bound to container loopback; an in-container forwarder makes its loopback-only host publication reachable on Docker Desktop.
- [Phase ?]: The browser boundary accepts and emits only complete opaque FIPS_PACKET bytes for an armed epoch/generation.
- [Phase ?]: The UI reports local bridge/FIPS transport facts only and never infers acoustic-peer or ping readiness.
- [Phase ?]: TrafficClass originates at semantic callers and is never inferred from opaque FIPS packet bytes.
- [Phase ?]: FWAV byte 6 carries validated local traffic-class metadata while legacy sends default to Ordinary.
- [Phase ?]: FAS1 is a strict 36-byte little-endian CRC-32C envelope with a 217-byte body and 1357-byte complete-packet cap.
- [Phase ?]: Only exact versioned executable modem profile IDs may be selected; scalar frequency-like settings reject.
- [Phase ?]: FWAV byte 6 carries only validated source-authored FIPS class metadata; browser adapter emits copied opaque envelopes.
- [Phase ?]: Phase 3: Acoustic readiness requires matching canonical settings digest, COMMIT_ACK, and a subsequent current-session heartbeat.
- [Phase ?]: Acoustic packet delivery uses four-unit half-duplex bursts with bodyless-ACK sequence bitmaps, three attempts, bounded queues/reassembly/history, and a finite heartbeat recovery path.
- [Phase ?]: Phase 3: AUDIO_SETTINGS is local preflight only; only a current-epoch acoustic readiness projection may arm FIPS.
- [Phase ?]: Phase 3: Session readiness requires matching settings commitment and current heartbeat; microphone preflight cannot arm FIPS.
- [Phase ?]: Phase 3: The built browser's two-role FAS1 seam is Fixture-only evidence and cannot claim Loopback or Open air.

### Pending Todos

None yet.

### Roadmap Evolution

- 2026-07-24: Expanded Phase 2 with centralized A/B configuration and launcher foundations.
- 2026-07-24: Expanded Phase 3 with bootstrap handshake, bidirectional calibration, settings commitment, and recalibration.
- 2026-07-24: Tightened Phase 4 FIPS readiness and isolated-role requirements around the negotiated acoustic session.
- 2026-07-24: Expanded Phase 5 with the one-command launcher, stateful no-scroll demo UI, structured evidence, and rehearsal.

### Blockers/Concerns

None for continued implementation. Final physical qualification remains
explicitly deferred below and still gates the final Open air claim.

## Deferred Verification

| Phase | State | Resume |
|-------|-------|--------|
| 1 | verification_deferred_human | `$gsd-verify-work 1` |
| 3 | verification_deferred_human | `$gsd-verify-work 3` |

The exact two-laptop Open air and exact-host TUN gate remains mandatory before
making the final physical demo claim. The 2026-07-23 single-laptop physical
self-loop proved real speaker-to-microphone feasibility in both directions but
is intentionally `Loopback`, not qualifying `Open air`, evidence. Per the
overnight execution brief, implementation phases continue while this external
hardware checkpoint remains explicit. Phase 3 software verification passed all
5 must-haves; its remaining physical checks are a real 1357-byte
speaker-to-microphone exchange on each target laptop, the exact two-laptop
Open-air exchange, and an observed physical loss/recovery cycle.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Codec | Near-ultrasonic profile | v2 after audible demo reliability gates pass | 2026-07-23 |
| Presentation | Polished visualization | v2 after core ping proof | 2026-07-23 |

## Session Continuity

Last session: 2026-07-24T08:41:39.000Z
Stopped at: Phase 03 software verified; physical acceptance deferred
Resume file: None
