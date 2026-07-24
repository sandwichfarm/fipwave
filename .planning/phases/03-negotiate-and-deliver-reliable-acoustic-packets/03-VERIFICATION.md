---
phase: 03-negotiate-and-deliver-reliable-acoustic-packets
verified: 2026-07-24T08:39:39Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Run the real Quiet/Web Audio path on each target laptop with its speaker and microphone enabled; establish a session and send one 1357-byte opaque packet in each direction."
    expected: "Each role records its own measured A→B/B→A calibration ledger, matching settings digest, COMMIT_ACK, current heartbeat, and one byte-identical complete-packet hash. Evidence is labelled Loopback, never Open air."
    why_human: "Injected modem/clock and browser Fixture tests cannot exercise the selected laptop's real microphone, speaker, codec timing, or audio processing."
  - test: "On two physically separate demo laptops, run role A and role B independently and complete bootstrap, literal bidirectional calibration, commitment, heartbeat readiness, then a 1357-byte packet in each direction."
    expected: "Both evidence directories agree on session/settings facts; each direction receives exactly one complete-packet hash with bounded retry/fragment counters. Only this two-machine result may be labelled Open air."
    why_human: "No second laptop or physical acoustic path is available on this host; local WebSocket and Fixture evidence cannot prove the inter-laptop sound hop."
  - test: "During the two-laptop run, obstruct or mute one direction long enough to miss the heartbeat, then restore it."
    expected: "The UI exposes Degraded and a bounded recovery, fallback/recalibration, or one actionable terminal error; FIPS is disarmed while unhealthy and never resumes from a stale callback."
    why_human: "The finite state transition is covered with a fake clock/modem, but room loss and real playback timing must be accepted on the demo hardware."
---

# Phase 3: Negotiate and Deliver Reliable Acoustic Packets Verification Report

**Phase Goal:** As a demo operator, I want to establish a measured and mutually committed acoustic session between both laptops, so that complete FIPS packets receive safe bounded deterministic half-duplex delivery below the FIPS boundary.

**Verified:** 2026-07-24T08:39:39Z  
**Status:** human_needed  
**Re-verification:** No — initial verification

## User Flow Coverage

| Step | Expected | Evidence in codebase | Status |
| --- | --- | --- | --- |
| Establish | Role A alone starts the nonce-bound, versioned session; role B accepts only its configured complementary peer and legal state sequence. | `AcousticSession.start()` only permits A; `receive()` strict-decodes FAS1 before dispatch. The named handshake/calibration Vitest test passed. | ✓ VERIFIED (deterministic) |
| Measure | Both literal directions send bounded numbered probes and retain a quality ledger before directional selection. | `AcousticSession` maintains A→B/B→A ledgers and bounded candidates; the named four-probe/commit test passed. | ✓ VERIFIED (deterministic) |
| Commit | Matching settings digest, COMMIT_ACK, and a current heartbeat are required before the FIPS adapter can arm. | `AcousticSessionAdapter.refresh()` and bridge `ACOUSTIC_READY` controls; named adapter and bridge readiness tests plus two Rust readiness tests passed. | ✓ VERIFIED |
| Deliver | A complete 1357-byte opaque packet is fragmented, acknowledged, reassembled once, and routed below FIPS with bounded half-duplex turns. | `fragmentPacket`/`reassemblePacket`, `AcousticSession.driveTurn()`, and class-preserving adapter wiring; named 1357-byte two-role test passed. | ✓ VERIFIED (deterministic) |
| Physical outcome | The same flow completes across the intended two laptop acoustic hop. | The built-browser test explicitly reports `Fixture`; no physical device evidence exists on this host. | ⚠️ HUMAN REQUIRED |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A conservative shared bootstrap profile establishes a versioned, nonce-bound capability handshake and rejects stale/wrong/corrupt/unsupported/out-of-state input. | ✓ VERIFIED | `apps/modem-ui/src/acoustic-protocol.ts` strictly validates FAS1 before session dispatch; `AcousticSession` binds role, identity, peer, nonce, epoch, profile, and ranges. Named handshake/calibration Vitest test passed; hostile protocol corpus exists. |
| 2 | Both literal directions use numbered bounded calibration probes, preserve quality observations, and may select different settings. | ✓ VERIFIED | `AcousticSession` maintains separate directional probe/report counters and immutable ledger entries; named four-A→B/four-B→A test passed. |
| 3 | Both peers commit/acknowledge one settings digest before FIPS readiness; exact executable profile IDs remain the fallback model. | ✓ VERIFIED | Canonical settings/digest functions and executable profile registry are in `acoustic-protocol.ts`; adapter/bridge/Rust gates require current-epoch acoustic readiness. Named adapter, bridge, and Rust readiness tests passed. |
| 4 | At least 1357 opaque bytes receive integrity-protected fragmentation/reassembly, exactly-once delivery, bounded expiry/retry/reassembly/backpressure below FIPS. | ✓ VERIFIED | FAS1 geometry is capped at 36+217 bytes; session queues, one inbound assembly, delivered-ID history, expiry, and retry ceiling are substantive. Named protocol and bidirectional 1357-byte session tests passed. |
| 5 | Deterministic half-duplex turns prioritize ACK/control/FIPS liveness; sustained loss makes health visible and follows a bounded recovery/error path. | ✓ VERIFIED | `AcousticSession.driveTurn()` owns a four-unit window, guarded token handoff, and control→heartbeat→ordinary FIFO queueing; `markHeartbeatMissed()`/recovery invalidate readiness. Traffic-class Rust test and targeted state tests passed. |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

The software semantics are verified through deterministic and browser-Fixture evidence. They do not certify physical acoustic delivery; the required physical acceptance is the human gate above.

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `apps/modem-ui/src/acoustic-protocol.ts` | Strict FAS1 codec, geometry, settings digest, fragmentation | ✓ VERIFIED | Exists, substantive, imported by session/main/tests; source and named boundary test prove 1357-byte/seven-fragment geometry. |
| `apps/modem-ui/src/acoustic-session.ts` | Negotiation, calibration, ARQ, bounded reassembly, priority, recovery | ✓ VERIFIED | 456-line state machine wired by `configureAcousticSession`; fake modem/clock named behavior tests exercise transitions. |
| `apps/modem-ui/src/acoustic-session-adapter.ts` | Complete-packet FIPS/session lifecycle bridge | ✓ VERIFIED | Wraps `createFipsPacketAdapter`, maps only validated class metadata, and disarms before reset/degrade. |
| `apps/modem-ui/src/quiet-client.ts` | Current-generation one-unit FAS1 transmit/receive seam | ✓ VERIFIED | `sendUnit` bounds input to one Quiet frame and resolves only after local playback/guard; no remote-ACK authority. |
| `packages/bridge/src/{protocol,server,demo-config}.ts` | Validated local controls/configuration and bounded bridge relay | ✓ VERIFIED | Current-epoch capability proof controls FIPS arming; `AUDIO_SETTINGS` is preflight-only; loopback same-origin checks and bounded queues are implemented. |
| `vendor/fips/src/transport/{mod.rs,sound/mod.rs}` | Source-authored class metadata and fail-closed Sound readiness | ✓ VERIFIED | `TrafficClass` travels as FWAV metadata outside payload; worker-up remains distinct from acoustic-ready. Named traffic-class and readiness Rust tests passed. |
| Phase 3 tests | Hostile parser, two-role session, adapter, bridge, Rust, and browser Fixture coverage | ✓ VERIFIED | All 24 declared plan artifacts pass `verify.artifacts`; targeted Vitest, Cargo, and Playwright checks were independently run. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| FIPS semantic callers | Sound FWAV | `TrafficClass` → `send_classified` → FWAV byte 6 | ✓ WIRED | Handshake/rekey use `Control`; the actual MMP heartbeat producer uses `Heartbeat`; default legacy sends remain `Ordinary`. Rust class tests preserve byte-identical payloads and reject unknown class metadata. |
| Sound FWAV | bridge | strict binary `FIPS_PACKET` class/epoch validation | ✓ WIRED | `packages/bridge/src/protocol.ts` and `server.ts` preserve valid class metadata before queue mutation. |
| bridge | browser adapter | binary complete-packet envelope plus class | ✓ WIRED | `FipsPacketAdapter` validates lifecycle/epoch/class and copies payload before callback. |
| browser FIPS adapter | acoustic scheduler | `AcousticSessionAdapter` admission | ✓ WIRED | Envelope bytes/class reach `enqueuePacket`; no FIPS-byte parser exists in the scheduler. |
| scheduler | Quiet | encoded FAS1 through `sendUnit`/`onUnit` | ✓ WIRED | `configureAcousticSession` composes the production path; a local finish only arms the next local scheduling timeout. |
| committed session | bridge/Rust gate | `ACOUSTIC_READY`/`ACOUSTIC_DISARM` proof projection | ✓ WIRED | Current heartbeat proof is required by bridge; Rust rejects preflight/direct/stale paths and disarms before queue cleanup. |

**Plan metadata correction, verified in source:** `03-01-PLAN.md` named `lifecycle/mod.rs` as the heartbeat producer. It emits classified handshake control; the real heartbeat producer is `vendor/fips/src/node/handlers/mmp.rs`, added in phase commit `2f3df14` and explicitly classified `Heartbeat`. The intended source-to-Sound link is therefore verified; the plan's file-level link is stale, not an implementation gap.

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
| --- | --- | --- | --- | --- |
| `AcousticSession` | decoded FAS1 units, settings, packet bytes | `QuietClient.onUnit` → `decodeFas1`; outbound `fragmentPacket` → `QuietClient.sendUnit` | Real browser codec path in production; deterministic tests replace waveform transport only | ✓ FLOWING (Fixture-tested) |
| `AcousticSessionAdapter` | complete FIPS envelope and traffic class | local binary bridge `FIPS_PACKET` via `FipsPacketAdapter` | Validated class + copied packet bytes, gated by current session snapshot | ✓ FLOWING |
| bridge/Rust Sound transport | readiness proof and FWAV packets | browser current-epoch acoustic controls / local FIPS socket | Exact binary controls plus bounded packet queue; no JSON/base64 packet bulk | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| 1357-byte FAS1 geometry | `vitest …acoustic-protocol.test.ts -t 'fragments and exactly reassembles…'` | 1 passed | ✓ PASS |
| Four probes, directional calibration, commit | `vitest …acoustic-session.test.ts -t 'executes four numbered…'` | 1 passed | ✓ PASS |
| Bidirectional exactly-once complete packet | `vitest …acoustic-session.test.ts -t 'round-trips one byte-identical 1357-byte…'` | 1 passed | ✓ PASS |
| Disarm/reset stale callback protection | `vitest …acoustic-session-adapter.test.ts -t 'disarms before reset…'` | 1 passed | ✓ PASS |
| Preflight cannot arm FIPS | `vitest …fips-packet-bridge.test.ts -t 'keeps local audio preflight…'` | 1 passed | ✓ PASS |
| Sound class propagation / readiness fail-closed | `cargo test sound_transport_{traffic_class,readiness} --locked` | 4 passed | ✓ PASS |
| Built browser evidence class | `playwright test …acoustic-session.spec.ts -g 'built browser reports Fixture-status…'` | 1 passed; asserts `Fixture`, `aToBBytes: 1357`, `bToABytes: 1357` | ✓ PASS (Fixture only) |

### Requirements Coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| LINK-01, LINK-02 | ✓ SATISFIED | Strict versioned FAS1 header/CRC/geometry and hostile decoder tests before session/FIPS mutation. |
| LINK-03, LINK-04 | ✓ SATISFIED | 1357-byte fragmentation/reassembly, bounded count/packet/expiry checks, named geometry and session tests. |
| LINK-05 | ✓ SATISFIED | Session packet-ID delivery history, ACK/duplicate suppression, and adapter test coverage. |
| LINK-06, LINK-07 | ✓ SATISFIED | Measured candidate timeout settings, bounded retry, four-unit turn ownership, guards, and fake-clock tests. |
| LINK-08 | ✓ SATISFIED | Source-authored Control/Heartbeat/Ordinary metadata; scheduler priority and Rust opaque-byte preservation tests. |
| LINK-09 | ✓ SATISFIED | Queue/item/byte/age caps, visible safe reasons, disarm-first bridge/Rust behavior, bounded admission tests. |
| NEG-01, NEG-02 | ✓ SATISFIED | Exact executable bootstrap profile, A-only initiation, nonce/identity/role/range/state validation tests. |
| NEG-03, NEG-04 | ✓ SATISFIED | Literal directional numbered ledger, deterministic reliability-first selection, safe fallback/deadline logic. |
| NEG-05 | ✓ SATISFIED | Canonical matching digest + ACK + current heartbeat are required for browser/bridge/Rust readiness. |
| NEG-06 | ✓ SATISFIED | Ready→Degraded→Recovering→Ready/Error is bounded, generation-guarded, and covered by targeted tests. |
| NEG-07 | ✓ SATISFIED | Exact mutually executable profile registry; synthetic frequency/sample-rate/playback-speed controls reject. |

All 16 Phase 3 requirement IDs are declared by plans; none are orphaned.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| — | — | No Phase 3 `TBD`/`FIXME`/`XXX` debt marker or rendering/handler stub found | — | No blocker |

Existing empty Rust match arms and a pre-existing comment containing the word “placeholder” are language/control-flow constructs, not incomplete behavior; no user-visible empty-data stub was found.

## Human Verification Required

### 1. Real local acoustic path

**Test:** Run the real Quiet/Web Audio speaker-to-microphone path on each target laptop and exchange one 1357-byte packet each way.  
**Expected:** Measured calibration and commitment facts are retained with byte-identical complete-packet hashes, labelled `Loopback`.  
**Why human:** Browser Fixture simulation cannot demonstrate actual host audio behavior.

### 2. Exact two-laptop Open air session

**Test:** Run role A and role B on separate laptops through full negotiation and bidirectional 1357-byte delivery.  
**Expected:** Matching session/settings evidence and exactly-once packet hashes in both evidence directories, labelled `Open air` only.  
**Why human:** This host has no second physical laptop; no local transport test can prove the acoustic hop.

### 3. Physical loss/recovery

**Test:** Interrupt the open-air path long enough to miss a heartbeat, then restore it.  
**Expected:** Visible degraded state and bounded recover/fallback/recalibrate/error behavior while FIPS remains disarmed until valid readiness returns.  
**Why human:** Fake-clock behavior proves the state machine, not room acoustics or actual playback timing.

## Gaps Summary

No software implementation gaps were found. Physical acoustic acceptance remains deliberately unproven and cannot be promoted from Fixture or Loopback evidence. The escalation gate is the three manual checks above.

---

_Verified: 2026-07-24T08:39:39Z_  
_Verifier: the agent (gsd-verifier)_
