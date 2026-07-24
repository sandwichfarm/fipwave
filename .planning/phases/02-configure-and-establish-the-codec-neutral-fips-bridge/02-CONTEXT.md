# Phase 2: Configure and Establish the Codec-Neutral FIPS Bridge - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Mode:** Autonomous recommendations accepted by the overnight brief

<domain>
## Phase Boundary

Create one validated role/configuration authority, add the smallest viable
first-class sound transport to the pinned FIPS fork, and connect complete
opaque FIPS packets to the existing browser-owned audio runtime through the
bounded binary bridge. Acoustic handshake, calibration, ARQ, and demo
presentation belong to later phases.

</domain>

<decisions>
## Implementation Decisions

### Configuration authority
- `npm run demo -- a|b` will eventually be the public entry point, so Phase 2 must expose a typed role resolver that accepts only `a` or `b`.
- Disposable A/B demo nsecs, public identities, expected peers, local ports, codec capabilities, audio defaults, and timing defaults live in one source of truth.
- Private nsecs may be committed for this disposable demo but must be clearly labelled, never emitted by ordinary logs or browser state, and replaceable in one location.
- Optional overrides are layered over validated defaults; no override is required for the canonical demo.

### FIPS fork and transport boundary
- Pin one exact upstream/fork commit and retain license/provenance.
- Add the smallest viable first-class `sound` transport through FIPS's normal lifecycle instead of bypassing handshake, identity, encryption, routing, heartbeat, or MTU logic.
- The FIPS-facing transport sends and receives complete opaque packets and reports at least 1357 bytes of link MTU.
- Codec names, PCM geometry, fragmentation details, and browser implementation do not leak into the FIPS transport interface.

### Browser/container bridge
- Keep the existing same-origin binary WebSocket boundary and FWAV/protocol validation patterns.
- Bulk packet and PCM payloads stay binary; JSON is reserved for bounded control/state messages.
- Every queue has explicit byte/item/time limits and exposes ready, disconnected, overflow, epoch, and last-error state.
- Bridge ports bind to loopback only so they cannot become an alternate inter-laptop path.

### Lifecycle and recovery
- One reset operation advances the epoch and clears browser, bridge, codec, and transport queues without accepting stale completion.
- Process ownership is explicit so later launch orchestration can stop only children it started.
- Configuration and state failures are fail-closed and actionable; missing secrets, unsupported roles, bad ports, and unavailable transport dependencies do not silently fall back.
- Deterministic integration tests use a codec fixture without weakening physical evidence classification.

### the agent's Discretion
- Exact internal module names and serialization layout may follow existing TypeScript conventions.
- The planner may choose the least risky vendoring/patch mechanism for the pinned FIPS fork after inspecting upstream build and transport patterns.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/bridge/src/server.ts` already owns the local binary WebSocket server, epoch authority, bounded queues, qualification state, and runner-facing snapshots.
- `packages/bridge/src/protocol.ts` already validates binary message headers and PCM metadata.
- `packages/bridge/src/codecs/types.ts`, `command.ts`, and `websocket.ts` provide codec-neutral adapter patterns.
- `packages/bridge/src/runner.ts` is the production same-origin browser/bridge process.
- `compose.preflight.yml` and `scripts/preflight-tun.sh` provide the least-privilege `NET_ADMIN` and `/dev/net/tun` baseline.

### Established Patterns
- TypeScript is strict, tests use Vitest, browser integration uses Playwright, and subprocess interfaces avoid shell interpolation.
- Evidence classes fail closed: Fixture and Loopback never become Open air.
- Runtime identity and role values are read-only once a runner starts.
- Reset advances an epoch and stale media/control completion is rejected.

### Integration Points
- Extend the bridge protocol with complete-packet ingress/egress without changing the existing PCM qualification contract.
- Connect the pinned FIPS transport process to the loopback bridge endpoint inside the local Docker boundary.
- Feed configuration into the runner and future demo launcher rather than duplicating role/port constants.
- Preserve the production UI route and Debug qualification behavior for Phase 5.

</code_context>

<specifics>
## Specific Ideas

- Canonical commands remain `npm run demo -- a` and `npm run demo -- b`.
- Role A is the Wi-Fi-connected gateway; role B has no wider FIPS transport.
- Docker Compose capability spelling must be exactly `NET_ADMIN`.
- The effective IPv6 MTU proof must remain honest: acoustic link MTU at least 1357 yields FIPS MTU at least 1280 after overhead.

</specifics>

<deferred>
## Deferred Ideas

- Bootstrap handshake, bidirectional calibration, settings digest, ARQ, heartbeat degradation, and profile negotiation are Phase 3.
- Real isolated-node FIPS peering and kernel ping are Phase 4.
- Full one-command orchestration, stateful no-scroll UI, artifacts, and rehearsal are Phase 5.

</deferred>
