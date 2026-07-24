# Phase 3: Negotiate and Deliver Reliable Acoustic Packets - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Mode:** Autonomous recommendations accepted by the overnight brief

<domain>
## Phase Boundary

Establish one measured acoustic session between the configured A/B pair and
deliver complete opaque FIPS packets through it. This phase owns bootstrap
control, capability exchange, literal two-direction calibration, directional
settings commitment, acoustic framing, fragmentation/reassembly, deterministic
half-duplex turns, bounded reliability, heartbeat degradation, and the
truthful readiness/metrics contract consumed later. It does not claim an
authenticated FIPS peer or kernel IPv6 ping; those are Phase 4.

</domain>

<decisions>
## Implementation Decisions

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

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/bridge/src/demo-config.ts` is the sole A/B identity, profile,
  calibration, retry, heartbeat, port, and audio authority.
- `packages/bridge/src/protocol.ts` and `server.ts` provide canonical binary
  FWAV framing, current-epoch validation, bounded queues, reset authority, and
  safe snapshots.
- `apps/modem-ui/src/quiet-client.ts` is the pinned fixed-profile browser modem;
  `qualification-session.ts` and the Phase 1 corpus/report code already model
  numbered results, deduplication, byte-perfect checks, and evidence classes.
- `apps/modem-ui/src/fips-packet-adapter.ts` is the complete-packet boundary to
  gate on committed acoustic readiness.
- Phase 2's production Playwright FIPS peer and local WebSocket fixtures provide
  a real browser/bridge integration seam for deterministic two-role tests.

### Established Patterns
- TypeScript is strict; Vitest owns pure/state-machine coverage and Playwright
  owns built-browser behavior.
- Browser audio state, bridge epoch, and WebSocket generation all fail closed;
  stale completion is never accepted after reset.
- Binary bulk data stays out of JSON/base64, every queue is bounded, and
  operator-facing state is exact-schema and secret-safe.
- Fixture and Loopback results never imply physical `Open air` success.

### Integration Points
- Insert the acoustic session/reliability layer between
  `FipsPacketAdapter` and `QuietClient`, preserving complete packets above and
  codec frames below.
- Extend public demo configuration with exact protocol/calibration/ARQ bounds
  rather than introducing scattered constants.
- Extend bridge/browser status projection with the session state and safe
  counters Phase 5 will render.
- Keep the vendored FIPS SoundTransport codec-neutral; it should observe only
  browser arm/readiness and complete packet delivery, not acoustic fragments.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly wants both laptops to sweep transmit and receive
  conditions before establishing FIPS, including directional asymmetry.
- A browser playback gain candidate up to 2.0 (200%) may be tested, but clipping
  and byte correctness decide selection; uncontrollable hardware input gain
  must be reported honestly.
- The recognizable audible modem profile is the safe demo default. Profile or
  frequency experimentation must never displace the working fixed-profile
  path.

</specifics>

<deferred>
## Deferred Ideas

- Real authenticated FIPS peering, isolation proof, wider-mesh routing, and
  kernel `ping -6` are Phase 4.
- Audience-first no-scroll presentation, launcher orchestration, evidence
  directories, and rehearsal automation are Phase 5.
- Near-ultrasonic profiles, multiplexed peer pairs, and deliberate-interference
  resistance remain post-demo work unless all mandatory phases are already
  stable.

</deferred>
