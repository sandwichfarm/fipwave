# Phase 3: Negotiate and Deliver Reliable Acoustic Packets - Research

**Researched:** 2026-07-24  
**Domain:** Browser-resident reliable half-duplex acoustic link beneath a complete-packet FIPS boundary  
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Bootstrap and session authority
- Use the pinned `quiet-audible-7k-v1` / `audible-7k-channel-0` profile as the
  conservative profile every role supports. A future profile is selectable
  only when both peers advertise its exact versioned identifier and its real
  encoder/decoder path is tested.
- Role A deterministically initiates discovery and owns the first transmit
  turn; role B responds. Nonces, expected public identities, complementary
  roles, protocol version, message integrity, and explicit state transitions
  bind every session and reject stale or ambient traffic.
- Keep control and data in a compact canonical binary protocol below
  `FipsPacketAdapter`. Bounded JSON remains acceptable only for local
  status/control projection, never for acoustic payload units.
- RESET advances the existing bridge epoch and invalidates the acoustic
  session, pending turns, retransmissions, reassemblies, heartbeats, and
  committed settings as one operation.

### Calibration and settings commitment
- Calibrate both literal directions independently: A sends numbered probes and
  B reports, then B sends and A reports. Preserve sent, received, byte-perfect,
  corrupt, missing, duplicate, discontinuity, latency, signal, clipping, and
  confidence observations where the browser/codec can genuinely measure them.
- Keep the sweep bounded for a live demo. Verify a pair-scoped warm-start
  candidate first, then sweep only a small configured set and fall back to the
  robust bootstrap profile within a hard deadline.
- Directional settings may differ in payload size, repetition, guard interval,
  playback gain, and other genuinely controllable values. Prefer byte
  correctness and stable bidirectional reception over loudness, nominal
  throughput, or maximum gain.
- Frequency is not a free scalar. Negotiate only exact modem profile IDs;
  changing Web Audio sample rate or playback speed is never represented as a
  carrier-frequency change. The existing fixed audible profile remains the
  only required candidate unless research proves another real compatible
  profile.
- Both peers canonicalize the selected A→B and B→A settings, commit the same
  digest, and acknowledge it before any FIPS packet can enter the acoustic
  scheduler.

### Framing, half-duplex, and reliability
- Every acoustic unit includes protocol version, session ID, unit type, packet
  ID, fragment index/count, sequence, declared length, and integrity value.
  Reject malformed, corrupt, wrong-session, expired, or unsupported units
  before mutating delivery state.
- Fragment complete opaque FIPS packets below the existing adapter into
  codec-sized payloads. Reassembly is bounded by packet size, fragment count,
  concurrent packets, total bytes, and expiry and never emits a partial packet.
- Use deterministic burst-and-ack half-duplex service: one owner sends a small
  bounded fragment window, the peer replies with a compact acknowledgement
  bitmap and the next-turn decision, and guard time separates directions.
  Control, acknowledgement, FIPS handshake, and heartbeat classes outrank
  ordinary packet data.
- Retries, backoff, turn deadlines, duplicate suppression, delivered-packet
  history, and queue backpressure are all bounded. Exactly-once delivery is
  keyed by active session plus packet ID; a retry may never create a second
  FIPS delivery.

### Health, recovery, and evidence
- Distinguish local browser/bridge readiness from acoustic-session readiness.
  The FIPS packet adapter remains fail-closed until bootstrap, calibration,
  settings commit/ack, and a current link heartbeat all succeed.
- A small priority heartbeat uses the committed session. Configured missed
  heartbeat/loss thresholds enter `Degraded`, then perform bounded retry,
  bootstrap fallback, or recalibration; exhaustion becomes one actionable
  terminal error rather than an infinite loop.
- Expose bounded, secret-safe session state and counters for discovery,
  handshake, calibration, selected settings, digest acknowledgement,
  fragments, reassembly, integrity failures, duplicates, retries, turns,
  heartbeat, throughput, and readiness.
- Digital two-role simulations and single-laptop speaker-to-microphone evidence
  stay explicitly classified. Neither can be promoted to exact two-laptop
  `Open air` evidence.

### the agent's Discretion
- Exact wire discriminants, checksumming primitive, window size, expiry limits,
  and candidate count may be selected from measured codec geometry during
  research, provided the protocol remains deterministic, bounded, versioned,
  and covered by adversarial tests.
- The implementation may factor pure protocol/state-machine code into a new
  package or colocate it with the browser modem, whichever yields the cleanest
  browser/Node simulation seam without adding an avoidable dependency.

### Deferred Ideas (OUT OF SCOPE)

- Real authenticated FIPS peering, isolation proof, wider-mesh routing, and
  kernel `ping -6` are Phase 4.
- Audience-first no-scroll presentation, launcher orchestration, evidence
  directories, and rehearsal automation are Phase 5.
- Near-ultrasonic profiles, multiplexed peer pairs, and deliberate-interference
  resistance remain post-demo work unless all mandatory phases are already
  stable.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| LINK-01 | Versioned, identified, length-declared, integrity-protected units | Fixed 36-byte `FAS1` envelope and strict decode-before-state rule. [VERIFIED: codebase] |
| LINK-02 | Reject malformed/corrupt units before FIPS | Parser, CRC-32C, session/role/sequence validation and no partial delivery. [VERIFIED: codebase] |
| LINK-03 | Fragment/reassemble ≥1357-byte opaque FIPS packet | 217-byte Quiet payload geometry yields seven fragments at the selected maximum. [VERIFIED: codebase] |
| LINK-04 | Bounded reassembly | One active packet/direction, 1357-byte cap, 16-fragment cap and expiry. [ASSUMED] |
| LINK-05 | No duplicate FIPS delivery | Active-session packet-ID delivery history and ACK idempotence. [ASSUMED] |
| LINK-06 | Measured, bounded timeout/retry | Calibration derives p95 unit/round-trip timings; retry cap is three total attempts. [VERIFIED: codebase] [ASSUMED] |
| LINK-07 | Deterministic half duplex | A starts; sender emits a four-fragment maximum burst plus `TURN_END`; receiver owns the reply turn. [ASSUMED] |
| LINK-08 | Prioritize ACK/control/FIPS liveness | Separate control/ACK queue and an explicit required FIPS traffic-class seam; never parse opaque payloads. [VERIFIED: codebase] [ASSUMED] |
| LINK-09 | Bounded backpressure/error | Four complete packets per direction, byte/age caps, terminal codes and bridge/FIPS disarm. [VERIFIED: codebase] [ASSUMED] |
| NEG-01 | Shared conservative bootstrap profile | Pin only `quiet-audible-7k-v1` / `audible-7k-channel-0`. [VERIFIED: codebase] |
| NEG-02 | Bound, validated capability handshake | Binary HELLO/ACK/CAPS exchange with identity, nonce, roles, profile and ranges. [VERIFIED: codebase] [ASSUMED] |
| NEG-03 | Bidirectional measured calibration | Four numbered probes per candidate in each literal direction, with complete result ledger. [ASSUMED] |
| NEG-04 | Measurement-based directional selection/fallback | Hard reliability gates followed by deterministic score and bootstrap fallback. [ASSUMED] |
| NEG-05 | Matching settings digest before readiness | Canonical binary settings plus full SHA-256 `COMMIT`/`COMMIT_ACK`; only then arm FIPS. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API/Non-cryptographic_uses_of_subtle_crypto] [ASSUMED] |
| NEG-06 | Bounded health and recovery | Heartbeat/degraded/rebootstrap/recalibrate/error state path with no open-ended loop. [VERIFIED: codebase] [ASSUMED] |
| NEG-07 | Profile IDs, never synthetic frequency | Candidate identity contains the exact fixed Quiet profile; no frequency/sample-rate/speed controls exist. [VERIFIED: codebase] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- The live proof remains an actual bidirectional OS-level IPv6 ping, while this phase stops below FIPS authentication and ping proof. [VERIFIED: AGENTS.md]
- Browser code owns microphone/speaker I/O; FIPS remains Dockerized and only receives complete transport packets. [VERIFIED: AGENTS.md]
- The sound transport must advertise at least 1357 bytes; all acoustic fragmentation and recovery stays below FIPS. [VERIFIED: AGENTS.md]
- Tomorrow's demo favors a rehearsable audible vertical slice over multiplexing, ultrasonic mode, or stronger interference resistance. [VERIFIED: AGENTS.md]
- Code discovery normally prefers the codebase graph; it was unavailable for this research, so the orchestrator authorized `rg` and direct file inspection. [VERIFIED: task context]
- Do not add a direct source edit outside the GSD workflow; this artifact is the Phase 3 planning output. [VERIFIED: AGENTS.md]

## Summary

Phase 3 should add one browser-resident `AcousticSession` between the existing complete-packet `FipsPacketAdapter` and the pinned `QuietClient`. It must replace the qualification-only `FQT1` envelope for session traffic with a strict binary `FAS1` unit protocol, while preserving FWAV only for the local browser↔bridge↔FIPS boundary. The project already pins `audible-7k-channel-0`, sees a runtime-clamped Quiet frame ceiling of 253 bytes, and currently reserves a 32-byte application envelope; therefore the Phase 3 header should also be exactly 36 bytes and permit at most 217 acoustic payload bytes. A 1357-byte FIPS packet consequently requires seven fragments at the selected full payload size. [VERIFIED: apps/modem-ui/src/quiet-client.ts] [VERIFIED: apps/modem-ui/src/quiet-client.test.ts]

Quiet's `transmit()` can queue multiple frames and its `onFinish` fires only when that queued audio has played locally; it is not a remote acknowledgement. `clampFrame: true` is the correct reliability setting because it prevents a modem frame from crossing Web Audio sample blocks, but it can reduce throughput. Implement one bounded four-unit burst, then a `TURN_END`, then wait for a bitmap ACK and its explicit next-turn grant; never infer delivery from `onFinish`. Measure the actual local timing during calibration and derive each direction's timeout from the measured p95 rather than retaining phase-wide fixed retry delays. [CITED: https://quiet.github.io/docs/quiet-js/transmitting/] [CITED: https://quiet.github.io/docs/quiet/encoding/] [VERIFIED: apps/modem-ui/src/quiet-client.ts]

The most consequential integration correction is readiness. Phase 2 currently sends `BROWSER_ARM` to FIPS immediately after `AUDIO_SETTINGS`; in the Rust transport, that single signal makes the configured sound peer `Connected` and permits complete packets. Phase 3 must keep local audio/bridge facts visible but delay that FIPS arm until the acoustic `COMMIT_ACK` and a current heartbeat are both valid; any reset, browser disconnect, degraded terminal state, or session expiry must send the corresponding disarm. [VERIFIED: packages/bridge/src/server.ts] [VERIFIED: vendor/fips/src/transport/sound/mod.rs]

**Primary recommendation:** Build a dependency-free, pure TypeScript acoustic protocol/session package with deterministic fake modem/clock tests first; then bind it to one-unit Quiet sends and make FIPS readiness a projection of committed acoustic readiness, not browser-audio readiness. [VERIFIED: codebase] [ASSUMED]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Unit codec, framing, CRC, sequence and reassembly | Browser / Client | — | Quiet frames enter and leave only browser code; FIPS remains complete-packet and codec-neutral. [VERIFIED: codebase] |
| Session discovery, calibration, turn state, ARQ and heartbeat | Browser / Client | Local bridge status projection | The physical peer is observable only to the browser modem; bridge JSON may expose safe snapshots. [VERIFIED: codebase] |
| FIPS admission gate | API / Backend (local Rust transport) | Browser / Client | Rust must reject sends/inbound delivery until the browser projects committed session readiness. [VERIFIED: vendor/fips/src/transport/sound/mod.rs] |
| Local epoch/reset authority | API / Backend (bridge) | Browser / Client | The bridge already owns the FWAV epoch and broadcasts RESET to browser/FIPS endpoints. [VERIFIED: packages/bridge/src/server.ts] |
| Modem waveform/profile and gain application | Browser / Client | — | `QuietClient` owns its audio context, receiver, transmitter and output gain. [VERIFIED: apps/modem-ui/src/quiet-client.ts] |
| Secret-safe session metrics/status | API / Backend (bridge) | Browser / Client | The bridge's current status endpoint is exact-schema; UI consumes safe scalar state only. [VERIFIED: packages/bridge/src/server.ts] [VERIFIED: apps/modem-ui/src/bridge-state.ts] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| Existing pinned Quiet classic assets | `quiet/quiet-js` commit `72782542a41f1b615a02c2ab43a0edb56edb6ce4` | Fixed audible modem | It is the selected, integrity-pinned browser fallback; no profile or package change is authorized. [VERIFIED: .planning/phases/01-qualify-the-demo-substrate/01-RUNTIME-GAP-RESEARCH.md] |
| TypeScript + browser Web Crypto | Existing project toolchain | Pure binary codec/session, SHA-256 settings digest and random nonce | Already available to browser code; `getRandomValues()` fills integer typed arrays with cryptographically strong random values. [VERIFIED: package.json] [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues] |
| Vitest + Playwright | `4.1.10` / `1.61.1` | State-machine and built-browser validation | Existing strict TypeScript project tests pure code in Vitest and browser behavior in Playwright. [VERIFIED: package.json] [VERIFIED: vitest.config.ts] [VERIFIED: playwright.config.ts] |

### Supporting

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| Existing `ws` bridge | `8.21.1` | Local binary FWAV transfer/status | Retain only for local browser↔container communication; it is not a cross-laptop path. [VERIFIED: package.json] [VERIFIED: packages/bridge/src/server.ts] |
| Existing Rust SoundTransport | Vendored FIPS commit `fc8ebd5` | FIPS-side complete-packet queue, MTU and fail-closed worker | Change only readiness semantics/status needed for the acoustic session; do not put fragments or codec code in Rust. [VERIFIED: vendor/fips/src/transport/sound/mod.rs] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| Fixed Quiet profile ID | Frequency/sample-rate/playback-speed “tuning” | Reject: the configured production candidate has one fixed profile and changing browser playback parameters does not create an interoperable modem profile. [VERIFIED: packages/bridge/src/demo-config.ts] [VERIFIED: apps/modem-ui/src/quiet-client.ts] |
| Explicit half-duplex turn protocol | Simultaneous transmit | Reject: Quiet only gives local scheduling; no echo cancellation or collision protocol is present, while an explicit owner makes each reply safe to schedule. [VERIFIED: apps/modem-ui/src/quiet-client.ts] [ASSUMED] |
| Small bounded protocol/session module | New modem/ARQ dependency | Reject for demo day: project package policy and existing binary/browser test seams make a small tested local module lower risk. [VERIFIED: package.json] [ASSUMED] |

**Installation:** None. This phase must not add a package, CDN asset, or modem profile. [VERIFIED: package.json] [VERIFIED: .planning/phases/03-negotiate-and-deliver-reliable-acoustic-packets/03-CONTEXT.md]

## Package Legitimacy Audit

No external package is installed in this phase. The existing Quiet assets are already pinned and integrity-audited, so no package-legitimacy gate or registry command applies. [VERIFIED: .planning/phases/01-qualify-the-demo-substrate/01-RUNTIME-GAP-RESEARCH.md]

## Architecture Patterns

### System Architecture Diagram

```text
FIPS SoundTransport (complete opaque packet only)
        │ FWAV FIPS_PACKET; gated by acoustic-ready
        ▼
local bridge ──────────────► Browser FipsPacketAdapter
                                 │ packet admission / delivery
                                 ▼
                          AcousticSession
       reset epoch ─────►  ├─ strict FAS1 decoder + CRC/session/role checks
                          ├─ HELLO/CAPS → bidirectional probes → COMMIT/ACK
                          ├─ priority queues → burst(≤4) → TURN_END → ACK bitmap
                          ├─ bounded reassembly/dedupe/heartbeat/recovery
                          └─ safe snapshot / acoustic-ready projection
                                 │ codec-sized units only
                                 ▼
       laptop speaker ◄── QuietClient transmitter / receiver ──► microphone
                                 │
             physical audible air gap to the other laptop's identical path
```

The only inter-laptop arrow is Quiet audio. FWAV, the Node bridge, and FIPS never carry acoustic fragments across laptops. [VERIFIED: AGENTS.md] [VERIFIED: packages/bridge/src/protocol.ts]

### Recommended Project Structure

```text
apps/modem-ui/src/
├── acoustic-protocol.ts          # FAS1 encode/decode, CRC-32C, canonical settings
├── acoustic-session.ts           # pure event-driven state machine, queues and timers
├── acoustic-session-adapter.ts   # QuietClient/FipsPacketAdapter/browser glue
├── acoustic-status.ts            # safe exact-schema public snapshot reducer
├── quiet-client.ts               # add one-unit transmit + raw-unit receive seam
├── fips-packet-adapter.ts        # preserve complete-packet boundary; gate by session
└── main.ts                       # lifecycle wiring, never protocol logic
packages/bridge/src/
├── demo-config.ts                # one validated acoustic bounds/candidates authority
├── protocol.ts                   # local FWAV acoustic-ready/disarm control type(s)
└── server.ts                     # project readiness to FIPS; reset/disarm atomically
vendor/fips/src/transport/sound/mod.rs # honour the projected current-epoch readiness
```

Keep the pure protocol/state machine in `apps/modem-ui/src` rather than a new workspace package unless a real Node consumer appears; Vitest already includes `apps/**/*.test.ts`, and this avoids an unnecessary dependency/package boundary. [VERIFIED: vitest.config.ts] [ASSUMED]

### Pattern 1: Fixed wire geometry and validate-before-mutate

Use this exact v1 unit geometry, little-endian for all integer fields, and reject before allocating a reassembly slot or changing turn/session state. The 36-byte header keeps a 217-byte maximum data/control body within the verified 253-byte Quiet runtime frame ceiling. [VERIFIED: apps/modem-ui/src/quiet-client.ts] [ASSUMED]

| Offset | Bytes | Field | Rule |
|---:|---:|---|---|
| 0 | 4 | magic `FAS1` | Exact ASCII discriminator. [ASSUMED] |
| 4 | 1 | protocol version | Exact value `1`; no downgrade/implicit compatibility. [ASSUMED] |
| 5 | 1 | unit type | `HELLO`, `HELLO_ACK`, `CAPS`, `PROBE`, `REPORT`, `COMMIT`, `COMMIT_ACK`, `DATA`, `TURN_END`, `ACK`, `HEARTBEAT`, `RESET`. [ASSUMED] |
| 6 | 2 | flags | Only documented bits; reject unknown bits. [ASSUMED] |
| 8 | 8 | session ID | 64-bit truncation of both nonces plus ordered roles; zero only during bootstrap HELLO. [ASSUMED] |
| 16 | 4 | sender sequence | Strictly increasing per active session and role; duplicate/stale units do not mutate state. [ASSUMED] |
| 20 | 4 | packet ID | Non-zero only for `DATA`; random/monotonic per session, never reused within delivery-history TTL. [ASSUMED] |
| 24 | 2 | fragment index | `< fragmentCount`; zero for non-data. [ASSUMED] |
| 26 | 2 | fragment count | 1–16 for `DATA`; zero for non-data. [ASSUMED] |
| 28 | 2 | declared packet length | 1–1357 for `DATA`; zero for control. [VERIFIED: packages/bridge/src/demo-config.ts] [ASSUMED] |
| 30 | 2 | body length | Must equal actual remaining bytes and be ≤217. [VERIFIED: apps/modem-ui/src/quiet-client.ts] [ASSUMED] |
| 32 | 4 | CRC-32C | Calculate over header bytes 0–31 plus body; never treat it as authentication. [ASSUMED] |

Use a tiny, table-tested local CRC-32C implementation rather than a package. Quiet itself checks received modem frames, but an independent envelope checksum makes rejection deterministic and covers semantic corruption after modem decode. [CITED: https://quiet.github.io/docs/quiet/how/] [ASSUMED]

### Pattern 2: Canonical session state machine

```text
LocalArmed
  A: Discovering --HELLO--> AwaitHelloAck --CAPS--> CalibratingAToB
  B: Listening  --HELLO--> AwaitCaps     --CAPS--> CalibratingAToB
CalibratingAToB → CalibratingBToA → Committing → AwaitCommitAck
AwaitCommitAck --valid current heartbeat--> Ready
Ready --miss/loss threshold--> Degraded → Recovering → (Listening | Error)
any state --bridge RESET/disarm--> LocalArmed
```

Role A alone originates `HELLO` and the initial transmit turn. Each HELLO/CAPS unit carries protocol version, own public identity, expected complementary role/peer fingerprint, 128-bit nonce, exact supported profile IDs, payload/repetition/gain/guard ranges, heartbeat and calibration bounds. Use `crypto.getRandomValues(new Uint8Array(16))` for the nonce; reject a nonmatching configured peer identity, role, version, nonce/session binding, malformed capability range, unsupported profile, or event that is not legal in the current state. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues] [VERIFIED: packages/bridge/src/demo-config.ts] [ASSUMED]

`COMMIT` contains one canonical binary settings record (ordered A→B then B→A, exact profile ID, payload size, repetition, guard, gain, measured timeout values) and its full SHA-256 digest. `COMMIT_ACK` returns the same 32 bytes. A local matching digest is insufficient: FIPS may be armed only after the ACK and a subsequent valid heartbeat for that session. SHA-256 here detects disagreement; it is not a session-authentication replacement for the Phase 4 FIPS handshake. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API/Non-cryptographic_uses_of_subtle_crypto] [ASSUMED]

### Pattern 3: Measured directional calibration

Start by retesting an exact pair-scoped warm-start record; it is usable only when all four numbered probes in both directions are byte-perfect and current. On a warm-start miss, try at most three fixed candidates in a 120-second calibration deadline: bootstrap `{profile: quiet-audible-7k-v1, payload: 96, repetition: 1, guard: 750, gain: 1.0}`, full-frame `{payload: 217, repetition: 1, guard: 750, gain: 1.0}`, then only a configured non-clipping gain candidate up to `2.0`. Do not expose arbitrary carrier frequency, sample-rate or playback-speed controls. [VERIFIED: apps/modem-ui/src/quiet-client.ts] [VERIFIED: packages/bridge/src/demo-config.ts] [ASSUMED]

For each candidate, A emits probe IDs 0–3 then receives B's compact report; B repeats the same process. Persist/send only bounded observations: sent, valid receive, byte-perfect, corrupt, missing, duplicate, discontinuity, local completion, peer report round trip, applied gain, clipping observable from browser data, and confidence. A candidate passes only with four byte-perfect, nonduplicate, noncorrupt probes and no discontinuity per literal direction. Choose independently per direction by highest passed count, then lowest p95 observed round-trip, then lower gain, then larger payload; if none pass, commit the bootstrap candidate only when its own hard gates pass, otherwise end in `calibration_failed`. [ASSUMED]

### Pattern 4: Four-unit burst-and-ACK ARQ

The active turn owner drains priority control/ACK first, then at most four `DATA` fragments from one packet, then emits `TURN_END(packetId, windowBase, sentBitmap)`. It waits for the opposite role's `ACK(packetId, windowBase, receivedBitmap, nextTurn)`; the receiver sends its ACK only after the received `TURN_END` plus its configured guard. Missing-bit retries contain only missing fragments; a lost `TURN_END` or ACK retries the same bounded window. Quiet's one transmitter must be idle before a response is scheduled, and sender/receiver `onFinish` plus guard is used only as a local collision-avoidance boundary. [CITED: https://quiet.github.io/docs/quiet-js/transmitting/] [VERIFIED: apps/modem-ui/src/quiet-client.ts] [ASSUMED]

Use `maxAttempts: 3` total attempts per window, exponential backoff bounded by the dead-link window, and compute `ackTimeoutMs = clamp(p95ProbeRoundTripMs + p95UnitAirtimeMs + 2*guardMs, 4_000, 15_000)`. The calibration report supplies the p95 values; its deadline avoids pretending the static Phase 2 `500–2000 ms` retry values describe air time. The header's 16-bit fragment fields permit a cap of 16, while the configured maximum packet requires only seven fragments at 217 bytes and fifteen at the 96-byte bootstrap setting. [VERIFIED: packages/bridge/src/demo-config.ts] [VERIFIED: apps/modem-ui/src/quiet-client.ts] [ASSUMED]

### Pattern 5: Bounded reassembly and exactly-once delivery

Allocate at most one reassembly per inbound direction: maximum 1357 bytes, maximum 16 fragments, 30-second expiry (or `2 * measuredAckTimeout`, whichever is smaller), and no more than one delivered-ID history of 32 packet IDs per active session with the same TTL. A duplicate fragment increments a counter but changes neither stored bytes nor delivery; once all fragments exist, concatenate by index, enforce declared length, validate CRC, record delivery ID, and only then call `FipsPacketAdapter.send()` toward local FIPS. No partial result, late retry, old session or old epoch may reach FIPS. [VERIFIED: apps/modem-ui/src/fips-packet-adapter.ts] [VERIFIED: packages/bridge/src/demo-config.ts] [ASSUMED]

### Critical integration: current bridge arm is too early

`server.ts` currently treats browser `AUDIO_SETTINGS` as `browserArmed` and immediately forwards `BROWSER_ARM`; Rust then accepts a complete FIPS packet whenever its worker is up and `browser_ready` is true. Add separate local control values such as `ACOUSTIC_READY`/`ACOUSTIC_DISARM` in FWAV and have the bridge translate only those current-epoch controls into Rust's existing `BROWSER_ARM`/`BROWSER_DISARM`. `AUDIO_SETTINGS` must remain a local preflight fact only. Browser reset/disconnect, timeout exhaustion and degraded recovery must project `ACOUSTIC_DISARM` before any new packet can be admitted. [VERIFIED: packages/bridge/src/server.ts] [VERIFIED: packages/bridge/src/protocol.ts] [VERIFIED: vendor/fips/src/transport/sound/mod.rs] [ASSUMED]

### Anti-Patterns to Avoid

- **Reusing qualification `FQT1`:** it encodes corpus case IDs and a digest prefix, not arbitrary session/packet semantics or reliable delivery bounds. Replace rather than extend it. [VERIFIED: apps/modem-ui/src/quiet-client.ts]
- **Queueing all FIPS packets in one Quiet transmitter:** Quiet may queue multiple `transmit()` calls and issue one eventual `onFinish`, so it cannot delimit an ACK turn or bound latency. [CITED: https://quiet.github.io/docs/quiet-js/transmitting/]
- **Declaring readiness after local audio arm:** current `BROWSER_ARM` semantics would permit FIPS before a peer commits settings. Gate on session readiness. [VERIFIED: packages/bridge/src/server.ts] [VERIFIED: vendor/fips/src/transport/sound/mod.rs]
- **Parsing FIPS bytes in the browser for scheduling:** Phase 2 deliberately provides opaque complete packets. Priority needs explicit metadata from the FIPS side, not a heuristic protocol parser. [VERIFIED: apps/modem-ui/src/fips-packet-adapter.ts] [VERIFIED: vendor/fips/src/transport/sound/mod.rs]
- **Treating simulated or self-loop results as Open air:** preserve the existing `Fixture`/`Loopback`/`Open air` evidence distinction. [VERIFIED: apps/modem-ui/src/quiet-client.ts] [VERIFIED: .planning/STATE.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Modulation, FEC, acquisition | A new DSP/modem | Existing pinned Quiet profile and assets | Quiet already frames and rejects errored modem frames; the phase only owns the link protocol above it. [CITED: https://quiet.github.io/docs/quiet/how/] [VERIFIED: .planning/phases/01-qualify-the-demo-substrate/01-RUNTIME-GAP-RESEARCH.md] |
| Local browser↔FIPS IPC | Custom TCP/protocol or JSON bulk frames | Existing FWAV/WebSocket bridge | It already validates binary envelope, current epoch, endpoint roles, size and queue bounds. [VERIFIED: packages/bridge/src/protocol.ts] [VERIFIED: packages/bridge/src/server.ts] |
| Cryptographic peer authentication | New acoustic identity protocol | Existing FIPS handshake in Phase 4 | The Phase 3 checksum/digest detects accidental corruption/settings mismatch only; Phase 4 owns authenticated peer proof. [VERIFIED: .planning/ROADMAP.md] [ASSUMED] |
| Timer simulation | Real-time sleeps in unit tests | Injected monotonic clock, timer and fake modem | Existing tests already use deterministic clocks/timers for bridge and qualification logic. [VERIFIED: packages/bridge/src/server.ts] [VERIFIED: apps/modem-ui/src/quiet-client.test.ts] |

**Key insight:** the small local protocol is warranted because the codec's frame integrity and local playback callback do not provide session binding, deterministic reverse turns, whole-packet delivery, or bounded recovery. Do not hand-roll the waveform layer. [CITED: https://quiet.github.io/docs/quiet/how/] [CITED: https://quiet.github.io/docs/quiet-js/transmitting/] [ASSUMED]

## Common Pitfalls

### Pitfall 1: FIPS becomes “connected” after microphone preflight

**What goes wrong:** `AUDIO_SETTINGS` currently sends `BROWSER_ARM`, and Rust's `connection_state()` reports `Connected` when the worker and that arm are present, before a remote acoustic session exists. [VERIFIED: packages/bridge/src/server.ts] [VERIFIED: vendor/fips/src/transport/sound/mod.rs]

**How to avoid:** separate local audio arm from acoustic-ready projection, emit the latter only after `COMMIT_ACK` plus heartbeat, and disarm atomically on reset/degraded/error. [ASSUMED]

**Warning signs:** status says FIPS transport started/connected while session state is `Discovering`, `Calibrating`, `Committing`, `Degraded` or `Error`. [ASSUMED]

### Pitfall 2: Quiet's fixed envelope has no room for a casual JSON control message

**What goes wrong:** current runtime geometry is 253 bytes total and 221 bytes after a 32-byte envelope; identity/capability JSON can exceed it or become ambiguous. [VERIFIED: apps/modem-ui/src/quiet-client.ts] [VERIFIED: apps/modem-ui/src/quiet-client.test.ts]

**How to avoid:** use length-prefixed binary control records, one identity per handshake message, strict scalar ranges and the 217-byte FAS1 body cap. [ASSUMED]

**Warning signs:** one message is silently split by Quiet, parser sees a control frame without its declared body, or a capability list has no fixed cap. [CITED: https://quiet.github.io/docs/quiet-js/transmitting/] [ASSUMED]

### Pitfall 3: `onFinish` mistaken for receipt

**What goes wrong:** `onFinish` only reports local playback completion after all queued bytes, and it may coalesce multiple transmit calls; it cannot prove the peer received anything. [CITED: https://quiet.github.io/docs/quiet-js/transmitting/]

**How to avoid:** transmit one protocol unit at a time, measure local completion, require remote ACK bitmap, and send a `TURN_END` before the peer may reply. [ASSUMED]

**Warning signs:** delivery counter increments on local completion or a sender changes turns with no valid peer control unit. [ASSUMED]

### Pitfall 4: Retry causes second FIPS injection

**What goes wrong:** an ACK may be lost after all fragments arrived, so the sender retries a packet the receiver has already delivered. [ASSUMED]

**How to avoid:** retain session-scoped delivered packet IDs after delivery, replay the same ACK for a known packet/window, and never call the adapter again. [ASSUMED]

**Warning signs:** `reassemblyCompleted` or FIPS RX rises twice for one `(sessionId, packetId)`. [ASSUMED]

### Pitfall 5: LINK-08 cannot be satisfied by byte guessing

**What goes wrong:** `SoundTransport::send_async()` and `TransportHandle::send()` accept only `&[u8]`; the current FWAV FIPS packet carries no priority. Browser code cannot reliably distinguish FIPS handshake/heartbeat bytes without violating the opaque boundary. [VERIFIED: vendor/fips/src/transport/sound/mod.rs] [VERIFIED: vendor/fips/src/transport/mod.rs] [VERIFIED: packages/bridge/src/protocol.ts]

**How to avoid:** make an explicit, non-payload local traffic-class seam in the FIPS/bridge call path before scheduling begins; at minimum it must distinguish control/heartbeat from ordinary data and survive FWAV validation. This is a mandatory Wave 0 design check, not permission to parse FIPS payloads. [ASSUMED]

**Warning signs:** test implementation can prioritize ACK/control but has no testable source of FIPS handshake/heartbeat class. [ASSUMED]

## Code Examples

### Unit acceptance ordering

```typescript
function acceptAcousticUnit(raw: Uint8Array, now: number): void {
  const unit = decodeFas1(raw);                    // magic/version/length/CRC/ranges
  if (unit.sessionId !== state.sessionId) return;
  if (unit.role !== peerRole(state.role)) return;
  if (unit.sequence <= state.highestSequence) return;
  if (!isLegalTransition(state.phase, unit.type)) return;
  if (isExpired(unit, now)) return;

  // Only a fully validated unit may now update sequence, ACK, reassembly or state.
  state.highestSequence = unit.sequence;
  dispatchValidatedUnit(unit, now);
}
```

This follows the existing FWAV rule that magic/version/declared length are checked before dispatch and that stale epoch/sequence frames cannot advance state. [VERIFIED: packages/bridge/src/protocol.ts] [ASSUMED]

### One bounded burst

```typescript
const window = selectMissingFragments(packet, baseIndex, 4);
await modem.sendUnits([...window.map(encodeData), encodeTurnEnd(packet.id, baseIndex, bitmap(window))]);
await sleep(settings.guardMs); // local Quiet completion/guard only
const ack = await waitForAck(packet.id, baseIndex, settings.ackTimeoutMs);
retryOnlyMissing(ack.receivedBitmap);
```

`sendUnits` must await Quiet local completion for this one bounded turn and must not queue another burst before the ACK/timeout transition. Quiet's API documents that `onFinish` is after all queued data, which is why one turn must own one transmitter queue. [CITED: https://quiet.github.io/docs/quiet-js/transmitting/] [ASSUMED]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Qualification corpus `FQT1` fragments | General FAS1 session/data units | Phase 3 | Corpus case IDs/digest prefixes cannot be reused as production packet identities. [VERIFIED: apps/modem-ui/src/quiet-client.ts] [ASSUMED] |
| Local `onFinish` plus fixed guard, no ACK | Measured turn end, ACK bitmap, bounded retry | Phase 3 | Turns become deterministic and delivery is remote-confirmed. [VERIFIED: .planning/phases/01-qualify-the-demo-substrate/01-08-SUMMARY.md] [ASSUMED] |
| Browser arm is FIPS packet readiness | Committed session plus heartbeat is FIPS packet readiness | Phase 3 | Local audio status remains truthful without falsely claiming a peer. [VERIFIED: packages/bridge/src/server.ts] [VERIFIED: vendor/fips/src/transport/sound/mod.rs] [ASSUMED] |

**Deprecated/outdated:** Do not use the qualification UI's manual A→B/B→A corpus scheduling as the packet scheduler. It explicitly has no ACK, retry, ARQ or remote-result wait. [VERIFIED: .planning/phases/01-qualify-the-demo-substrate/01-08-SUMMARY.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | A 36-byte FAS1 header with CRC-32C and a 217-byte body is the best same-day geometry. | Architecture Patterns | Medium — another fixed layout could be valid, but must stay under the verified 253-byte frame limit. |
| A2 | Window 4, 3 total attempts, 16 fragments, one concurrent reassembly, 32 delivered IDs and 30-second cap give the required reliability without excessive state. | Architecture Patterns | Medium — revise only from calibration/test evidence, not intuition. |
| A3 | Four probes × three candidates × two directions fits a 120-second calibration deadline on exact laptops. | Calibration | High — time-box must be measured in the first physical run. |
| A4 | FIPS traffic class can be supplied through a narrow explicit local metadata seam without parsing opaque FIPS bytes. | Pitfall 5 | High — current APIs expose only bytes; plan Wave 0 must identify the producer seam before implementation. |
| A5 | CRC-32C plus SHA-256 settings digest is adequate corruption/commit detection below the later FIPS authentication layer. | Wire / Commit | Medium — neither is an acoustic peer-authentication protocol. |

## Open Questions

1. **How will FIPS handshake/heartbeat traffic get a trustworthy priority class?**
   - What we know: the current transport send interface accepts only opaque bytes and current FWAV has no class field. [VERIFIED: vendor/fips/src/transport/mod.rs] [VERIFIED: vendor/fips/src/transport/sound/mod.rs]
   - What's unclear: the narrowest FIPS call path that can attach a class without inspecting payload bytes. [ASSUMED]
   - Recommendation: make this the first Wave 0 source trace and test; do not mark LINK-08 complete on an ACK-only priority queue. [ASSUMED]

2. **What are exact two-laptop p95 unit and round-trip timings?**
   - What we know: a local Chromium Quiet smoke emitted 1536 bytes in about 5.49 seconds and the existing implementation has a 750 ms guard, but neither is an Open-air throughput claim. [VERIFIED: .planning/phases/01-qualify-the-demo-substrate/01-RUNTIME-GAP-RESEARCH.md] [VERIFIED: apps/modem-ui/src/quiet-client.ts]
   - What's unclear: the selected candidate timing, clipping and loss on the exact A/B pair. [ASSUMED]
   - Recommendation: derive operational timeout from calibration; classify its evidence accurately and retain bootstrap fallback. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---:|---|---|
| Node.js | TypeScript build/Vitest/runner | ⚠ | `v25.2.1`; project requires `22.23.1` | Activate Node `22.23.1` before validation. [VERIFIED: local environment] [VERIFIED: package.json] |
| npm | Existing project validation | ✓ | `11.6.2` | — [VERIFIED: local environment] |
| Docker / Compose | Existing FIPS bridge/topology | ✓ | Docker `28.5.2`; Compose `v2.40.3` | — [VERIFIED: local environment] |
| Rust/Cargo | Existing vendored FIPS readiness change | ⚠ | `1.92.0`; Phase 2 pin requires `1.94.1+` | Activate the vendor-pinned toolchain. [VERIFIED: local environment] [VERIFIED: AGENTS.md] |
| Playwright Chromium cache | Browser test path | ✓ | cached `chromium-1228` | Target demo Chromium remains manual evidence. [VERIFIED: local environment] |
| PATH Chromium | Exact-laptop/manual acoustic run | ✗ | — | Use target Chromium or Playwright browser for automated tests. [VERIFIED: local environment] |

**Missing dependencies with no fallback:** Node `22.23.1` and Rust `1.94.1+` must be active for project-contract validation and any Rust readiness change. [VERIFIED: package.json] [VERIFIED: AGENTS.md] [VERIFIED: local environment]

**Missing dependencies with fallback:** PATH Chromium is absent; Playwright's cached Chromium covers automated behavior, but cannot substitute for exact-laptop `Open air` evidence. [VERIFIED: local environment] [VERIFIED: .planning/STATE.md]

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | Vitest `4.1.10`, Playwright `1.61.1`, vendored FIPS `cargo test`. [VERIFIED: package.json] |
| Config file | `vitest.config.ts`, `playwright.config.ts`, `playwright.production.config.ts`, `vendor/fips/rust-toolchain.toml`. [VERIFIED: codebase] |
| Quick run command | `./node_modules/.bin/vitest run apps/modem-ui/src/acoustic-protocol.test.ts apps/modem-ui/src/acoustic-session.test.ts apps/modem-ui/src/fips-packet-adapter.test.ts packages/bridge/test/fips-packet-bridge.test.ts` after Node 22 activation. [VERIFIED: package.json] [ASSUMED] |
| Full suite command | `npm run check && (cd vendor/fips && cargo test sound_transport --locked)`. [VERIFIED: package.json] [ASSUMED] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| LINK-01, LINK-02 | FAS1 rejects every bad magic/version/type/length/CRC/session/role/sequence case before state change | unit/property | `vitest run apps/modem-ui/src/acoustic-protocol.test.ts` | ❌ Wave 0 |
| LINK-03, LINK-04 | 1357 bytes round-trip through 7 maximum-payload fragments; caps/expiry never emit partial | unit | `vitest run apps/modem-ui/src/acoustic-session.test.ts` | ❌ Wave 0 |
| LINK-05 | Duplicate data/ACK/retry produces exactly one adapter delivery | unit | `vitest run apps/modem-ui/src/acoustic-session.test.ts apps/modem-ui/src/fips-packet-adapter.test.ts` | ❌ Wave 0 / adapter exists |
| LINK-06, LINK-07 | Fake-clock four-unit turn, bitmap loss, measured timeout/backoff and collision-free direction changes | deterministic integration | `vitest run apps/modem-ui/src/acoustic-session.test.ts` | ❌ Wave 0 |
| LINK-08 | ACK/control preempts data and explicit FIPS class preempts ordinary data | Rust/TS integration | `vitest run apps/modem-ui/src/acoustic-session.test.ts packages/bridge/test/fips-packet-bridge.test.ts && (cd vendor/fips && cargo test sound_transport --locked)` | ❌ Wave 0 |
| LINK-09 | Packet/item/byte/age caps give bounded safe error and no stale replay | unit/integration | `vitest run apps/modem-ui/src/acoustic-session.test.ts packages/bridge/test/fips-packet-bridge.test.ts` | ❌ Wave 0 / bridge limits exist |
| NEG-01, NEG-02 | A-only HELLO, peer/role/nonce/profile/range/state-transition rejection | unit | `vitest run apps/modem-ui/src/acoustic-session.test.ts` | ❌ Wave 0 |
| NEG-03, NEG-04 | Literal bidirectional probes, result ledger, deterministic directional score/fallback/deadline | unit | `vitest run apps/modem-ui/src/acoustic-session.test.ts` | ❌ Wave 0 |
| NEG-05 | Canonical settings digest mismatch cannot arm FIPS; matching ACK plus heartbeat does | browser/bridge/Rust integration | `vitest run packages/bridge/test/fips-packet-bridge.test.ts && (cd vendor/fips && cargo test sound_transport --locked)` | ❌ Wave 0 |
| NEG-06 | missed heartbeat reaches degraded then bounded recovery or terminal error | fake-clock integration | `vitest run apps/modem-ui/src/acoustic-session.test.ts` | ❌ Wave 0 |
| NEG-07 | only exact fixed profile ID is accepted; unsupported profile/frequency fields reject | unit | `vitest run apps/modem-ui/src/acoustic-protocol.test.ts packages/bridge/test/demo-config.test.ts` | ❌ Wave 0 / config exists |

### Sampling Rate

- **Per task commit:** targeted Vitest files plus `cargo test sound_transport --locked` for a Rust/bridge readiness change. [ASSUMED]
- **Per wave merge:** `npm run typecheck && npm run test:unit && npm run test:browser`. [VERIFIED: package.json]
- **Phase gate:** full suites green; deterministic two-role simulation and an explicitly classified single-laptop speaker→microphone run demonstrate reset/recovery and a 1357-byte packet before Phase 4. [VERIFIED: .planning/STATE.md] [ASSUMED]

### Wave 0 Gaps

- [ ] `apps/modem-ui/src/acoustic-protocol.test.ts` — hostile FAS1 decoder corpus, CRC, canonical settings digest and maximum geometry.
- [ ] `apps/modem-ui/src/acoustic-session.test.ts` — fake modem/clock two-role handshake, calibration, turns, loss, retries, dupes, expiry, heartbeat and backpressure.
- [ ] `apps/modem-ui/src/acoustic-session-adapter.test.ts` — adapter cannot emit/receive FIPS bytes before commit+heartbeat or after reset.
- [ ] Extend `packages/bridge/test/fips-packet-bridge.test.ts` — `AUDIO_SETTINGS` does not arm FIPS; only current-epoch acoustic-ready does; disarm/reset clears it.
- [ ] Extend `vendor/fips/src/transport/sound/mod.rs` tests — projected acoustic-ready controls are the only packet gate and reset invalidates them.
- [ ] `apps/modem-ui/e2e/acoustic-session.spec.ts` — built UI with deterministic modem seam exposes truthful local/session readiness without an alternate inter-laptop path.
- [ ] Resolve the explicit FIPS traffic-class seam before implementing LINK-08.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | Partial | Verify configured public identities/roles in acoustic bootstrap, but make no authentication claim; FIPS provides authenticated peering in Phase 4. [VERIFIED: packages/bridge/src/demo-config.ts] [VERIFIED: .planning/ROADMAP.md] [ASSUMED] |
| V3 Session Management | Yes | Random nonce, session ID, epoch reset, monotonic sequence, expiry and explicit legal transitions. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues] [ASSUMED] |
| V4 Access Control | Yes | Only current session/role can affect packet scheduler; FIPS remains disarmed until acoustic readiness. [VERIFIED: vendor/fips/src/transport/sound/mod.rs] [ASSUMED] |
| V5 Input Validation | Yes | Fixed-size header, declared body cap, CRC before state, bounded queues/reassembly and safe scalar status. [VERIFIED: packages/bridge/src/protocol.ts] [VERIFIED: packages/bridge/src/server.ts] [ASSUMED] |
| V6 Cryptography | Partial | Use platform CSPRNG and SHA-256 for nonce/digest; never represent checksum/digest as authentication or hand-roll encryption. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues] [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API/Non-cryptographic_uses_of_subtle_crypto] [ASSUMED] |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Ambient/stale modem unit | Spoofing / Replay | Validate profile/version, configured identity/role, session nonce/ID, epoch and monotonic sequence before mutation. [ASSUMED] |
| Corrupt or malformed decoded payload | Tampering / DoS | Strict body length/range/CRC validation before allocation or FIPS delivery. [ASSUMED] |
| Reassembly or packet queue exhaustion | DoS | Hard packet/fragment/concurrency/byte/age caps, reject counter and terminal safe error. [VERIFIED: packages/bridge/src/server.ts] [ASSUMED] |
| Lost ACK replaying a completed packet | Tampering / Replay | Session-scoped delivered-ID history and idempotent ACK replay. [ASSUMED] |
| Unsafe readiness claim | Elevation | Separate local audio readiness from acoustic committed+heartbeat readiness; disarm FIPS on loss. [VERIFIED: vendor/fips/src/transport/sound/mod.rs] [ASSUMED] |

## Sources

### Primary (HIGH confidence)

- [Current Quiet client and tests](../../apps/modem-ui/src/quiet-client.ts) — fixed profile, 253-byte clamped unit, 32-byte qualification envelope, 221-byte body, `onFinish` + 750 ms local guard, existing receive/reassembly reset behavior. [VERIFIED: codebase]
- [FIPS packet adapter](../../apps/modem-ui/src/fips-packet-adapter.ts), [FWAV protocol](../../packages/bridge/src/protocol.ts), and [bridge server](../../packages/bridge/src/server.ts) — current complete-packet and reset/readiness seams. [VERIFIED: codebase]
- [Vendored SoundTransport](../../vendor/fips/src/transport/sound/mod.rs) — current FIPS packet acceptance, queue bounds and `BROWSER_ARM` readiness semantics. [VERIFIED: codebase]

### Secondary (MEDIUM confidence)

- [Quiet.js transmitting API](https://quiet.github.io/docs/quiet-js/transmitting/) — `frameLength`, transmit splitting, queue-level `onFinish`, `onEnqueue`, `clampFrame`, destruction. [CITED: https://quiet.github.io/docs/quiet-js/transmitting/]
- [Quiet encoder frame clamping](https://quiet.github.io/docs/quiet/encoding/) and [Quiet overview](https://quiet.github.io/docs/quiet/how/) — frame clamp semantics and codec-level checksumming/discard. [CITED: https://quiet.github.io/docs/quiet/encoding/] [CITED: https://quiet.github.io/docs/quiet/how/]
- [MDN Crypto.getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues) and [MDN digest use](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API/Non-cryptographic_uses_of_subtle_crypto) — browser nonce and digest APIs. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues] [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API/Non-cryptographic_uses_of_subtle_crypto]

### Tertiary (LOW confidence)

- The exact proposed FAS1 discriminants, limits, candidate sweep values, scoring and traffic-class propagation plan are implementation recommendations pending deterministic tests and exact-laptop calibration. [ASSUMED]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependency; current pinned Quiet, bridge, adapter and vendored transport were inspected. [VERIFIED: codebase]
- Architecture: MEDIUM — the readiness flaw and codec geometry are source-verified; FIPS traffic-class propagation requires Wave 0 source tracing. [VERIFIED: codebase] [ASSUMED]
- Pitfalls: MEDIUM — Quiet callback semantics and current FIPS arm behavior are cited/source-verified; acoustic timing/physical reliability remains unmeasured. [CITED: https://quiet.github.io/docs/quiet-js/transmitting/] [VERIFIED: codebase] [ASSUMED]

**Research date:** 2026-07-24  
**Valid until:** 2026-07-31; reassess immediately if the pinned Quiet assets, profile geometry, or FIPS bridge contract changes. [VERIFIED: codebase] [ASSUMED]
