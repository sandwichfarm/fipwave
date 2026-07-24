# Phase 4: Prove the Sound-Only FIPS Ping - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 turns the verified Phase 3 acoustic packet service into a normal,
authenticated FIPS peer link and proves it with a real Linux kernel IPv6 echo
request and reply. Role B must have no enabled or usable FIPS transport other
than Sound; role A is the participant/wider-mesh side. This phase owns peer
authentication, role-specific transport isolation, the real `ping -6`
acceptance command, runtime-derived proof facts, and bounded reconnect. The
one-command launcher, no-scroll presentation UI, evidence-directory polish,
ten-ping rehearsal, and cold-start rehearsal remain Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Authenticated peer activation

- **D-01:** Normal upstream FIPS authentication, link encryption, handshake,
  heartbeat, and reconnect machinery must be reused unchanged; there is no
  demo-only peer protocol or pre-authenticated bypass.
- **D-02:** A Sound peer may enter the FIPS connection lifecycle only when the
  current acoustic session has a matching committed settings digest,
  `COMMIT_ACK`, and a current heartbeat. Worker-up, browser-connected, and audio
  preflight remain insufficient. — **Reversibility:** costly — changing this
  boundary later would touch the browser, bridge, Rust transport, peer state
  machine, and evidence contract.
- **D-03:** Acoustic invalidation disarms packet admission before FIPS observes
  link loss. Re-authentication after recovery must use the normal FIPS peer
  lifecycle and current acoustic epoch; stale peer or browser work cannot
  restore the link.

### Isolated-node topology

- **D-04:** Role B's generated FIPS configuration contains Sound as its only
  transport and the configured A identity as its only demo peer address.
  Runtime inspection—not configuration text alone—must prove that no UDP, TCP,
  Ethernet, Tor, Nym, BLE, or alternate FIPS transport is active or usable.
- **D-05:** Browser and FIPS bridge endpoints remain inside each laptop and
  bind only to loopback. They may never become an inter-laptop packet path.
  Docker service-namespace sharing remains a local implementation detail.
- **D-06:** Role A is the participant/wider-mesh side. It may use an existing
  supported FIPS transport for upstream mesh access when the target
  environment provides one, but the A↔B peer address is Sound only and role
  selection must be sufficient to choose the configuration. Exact upstream
  transport selection and host discovery are the planner's discretion; no new
  required operator parameter may be introduced.
- **D-07:** The disposable A/B identities and deterministic `fips0` IPv6
  addresses may remain fixed for this demo. Private nsecs stay in the
  secret-bearing generated config and never enter browser/public status.

### Real kernel ping authority

- **D-08:** The acceptance ping originates from the Linux kernel in role A's
  real FIPS container/network namespace and targets role B's deterministic
  `fips0` IPv6 address. The system `ping -6` process, real ICMPv6 request/reply,
  exit status, sequence, latency, and packet-loss output are authoritative.
- **D-09:** A browser event, synthetic ICMP payload, direct WebSocket echo, unit
  fixture, or host-network ping cannot satisfy the acceptance proof. Fixture
  tests may validate orchestration only and must remain labelled `Fixture`.
- **D-10:** The ping command must fail closed unless the current authenticated
  FIPS peer is bound to Sound, the acoustic session is ready in the same
  epoch, role B's isolation proof passes, and the target address matches the
  configured B identity.

### Recovery and proof facts

- **D-11:** One bounded normal recovery path handles a browser/acoustic
  interruption: disarm, expose degraded state, recover/recalibrate if allowed,
  re-establish the authenticated peer, then permit a new ping. There is no
  hidden process restart or alternate transport failover.
- **D-12:** Phase 4 exposes structured runtime facts for authenticated peer,
  Sound transport, active link, B isolation, acoustic TX/RX,
  complete-packet/fragment/integrity/retry counters, and ICMPv6 outcome.
  Counters advance from observed events only; UI inference is prohibited.
- **D-13:** Evidence classes remain strict: deterministic orchestration is
  `Fixture`, one-machine physical speaker/microphone is `Loopback`, and only
  two named machines with matching records may be `Open air`. Missing physical
  hardware produces `human_needed`, never a fabricated pass.
- **D-14:** Phase 4 needs one successful request/reply acceptance proof and one
  bounded interruption/reconnect proof. Ten consecutive exchanges, three cold
  starts, 60-second rehearsal scoring, and presenter choreography are Phase 5.

### the agent's Discretion

- Choose the smallest existing FIPS control/snapshot seam that can expose
  authenticated peer identity, link/transport, and counters without parsing
  logs as the primary contract.
- Choose whether the role-A kernel ping is invoked by a small Node
  orchestrator, a Compose health/proof service, or a direct bounded
  `docker exec`, provided the system binary and namespace remain authoritative.
- Choose the existing FIPS upstream transport for optional wider-mesh access
  on role A after researching Docker Desktop/macOS and Linux compatibility.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and phase contracts

- `.planning/ROADMAP.md` — Phase 4 goal, boundary, success criteria, and Phase
  5 handoff.
- `.planning/REQUIREMENTS.md` — `FIPS-04`, `FIPS-05`, `DEPLOY-03..05`,
  `DEMO-01..04`, and `CONFIG-04` acceptance obligations.
- `.planning/PROJECT.md` — project value, demo-day constraint, two-laptop
  topology, and evidence honesty rules.
- `.planning/phases/03-negotiate-and-deliver-reliable-acoustic-packets/03-CONTEXT.md`
  — locked acoustic session, MTU, half-duplex, readiness, and evidence-class
  decisions inherited by this phase.
- `.planning/phases/03-negotiate-and-deliver-reliable-acoustic-packets/03-VERIFICATION.md`
  — 5/5 verified software truths and the exact physical gates still deferred.

### Current role/configuration and container authority

- `packages/bridge/src/demo-config.ts` — disposable identities, deterministic
  peers, link MTU, retries, heartbeat, and exact public/private projection.
- `packages/bridge/src/runner.ts` — generated secret-bearing FIPS config,
  lifecycle ownership, and current runtime/evidence composition.
- `compose.fips.yml` — bridge/FIPS shared local namespace, TUN capability, and
  loopback-only browser publication.
- `scripts/fips-compose-smoke.mjs` — current container inspect, `fips0`, role
  IPv6, first-process, and log evidence gates.

### FIPS peer and Sound implementation

- `vendor/fips/src/config/peer.rs` — peer addresses, auto-connect, and
  auto-reconnect configuration contract.
- `vendor/fips/src/config/transport.rs` — supported upstream transport
  configuration and strict parsing.
- `vendor/fips/src/transport/sound/mod.rs` — Sound readiness, packet
  admission, MTU, queue, and bridge lifecycle.
- `vendor/fips/src/peer/active.rs` — authoritative authenticated peer state and
  connected/disconnected lifecycle.

No external specification is authoritative for this phase; the repository
contracts above are canonical.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `resolveDemoConfig()` and `renderFipsConfig()` already own A/B identities,
  static Sound peer addressing, deterministic `fips0` addressing, and
  secret/public separation.
- `compose.fips.yml` already creates the real FIPS daemon, TUN interface,
  exact `NET_ADMIN` capability, loopback browser port, and shared local
  namespace needed for a kernel ping proof.
- `assertFipsRuntimeInspect()`, `assertFipsTunRuntime()`, and
  `assertFipsDaemonLogs()` already provide strict runtime—not requested
  config—evidence and can be extended rather than replaced.
- `SoundTransport` already separates worker-up from browser/acoustic readiness,
  validates browser packet admission, and supplies a 1357-byte complete-packet
  link below FIPS.
- FIPS peer state already has authenticated timestamps, connected state,
  auto-connect, and bounded auto-reconnect semantics.

### Established Patterns

- Exact-schema parsing, bounded queues/timers, generation/epoch guards,
  disarm-before-cleanup, and current-owner validation are mandatory.
- Binary packet paths remain opaque; JSON is restricted to bounded status and
  evidence metadata.
- Docker/Compose assertions inspect live container state and reject broadened
  capabilities, namespaces, or publications.
- Fixture, Loopback, and Open-air evidence are never interchangeable.

### Integration Points

- Extend role-aware config rendering to express role B's Sound-only transport
  invariant and role A's optional upstream mesh transport without duplicating
  identities.
- Add an authoritative FIPS control/snapshot projection for authenticated peer
  and Sound link facts, then correlate it with the existing acoustic bridge
  state.
- Execute the bounded `ping -6` inside role A's live FIPS namespace and write
  its real result into the structured proof state.
- Extend Compose/runtime tests to prove isolation, authenticated link gating,
  ping authority, and reset/reconnect behavior without claiming physical
  sound in deterministic tests.

</code_context>

<specifics>
## Specific Ideas

- The live demo proof is deliberately ordinary and memeable: a normal kernel
  `ping -6` succeeds while the isolated laptop's only FIPS peer transport is
  audible sound.
- Computer A is selected with role parameter `a`; computer B is selected with
  role parameter `b`. No additional required per-machine argument is allowed.
- Both laptop screens will later be visible, but the no-scroll stateful GUI is
  Phase 5. Phase 4 should expose the trustworthy state/counters that GUI will
  consume.

</specifics>

<deferred>
## Deferred Ideas

- One-command full-stack launcher and role-only CLI polish — Phase 5.
- No-scroll presentation screens and Debug mode — Phase 5.
- Ten consecutive pings, three cold starts, final 60-second recovery score,
  evidence-directory freeze, documentation, and presenter script — Phase 5.
- Multiplexed acoustic connections and near-ultrasonic profiles — later
  milestone.

</deferred>

---

*Phase: 4-Prove the Sound-Only FIPS Ping*
*Context gathered: 2026-07-24*
