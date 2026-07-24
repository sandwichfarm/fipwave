# Phase 2: Configure and Establish the Codec-Neutral FIPS Bridge - Research

**Researched:** 2026-07-24
**Domain:** FIPS transport integration, local binary WebSocket bridge, role configuration
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

- Bootstrap handshake, bidirectional calibration, settings digest, ARQ, heartbeat degradation, and profile negotiation are Phase 3.
- Real isolated-node FIPS peering and kernel ping are Phase 4.
- Full one-command orchestration, stateful no-scroll UI, artifacts, and rehearsal are Phase 5.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FIPS-01 | Pinned FIPS fork with configurable first-class sound transport | Exact upstream commit, vendor strategy, config and dispatch seams are identified. [VERIFIED: github.com/jmcorgan/fips] |
| FIPS-02 | Normal lifecycle exchanges opaque complete packets | `TransportHandle`, `PacketTx`, `ReceivedPacket`, start/stop/send and control inspection seams are identified. [VERIFIED: github.com/jmcorgan/fips] |
| FIPS-03 | Sound link MTU >=1357 / effective IPv6 MTU >=1280 | Upstream subtracts its documented 77-byte IPv6 overhead; tests must cover 1357 → 1280. [VERIFIED: github.com/jmcorgan/fips] |
| CODEC-01 | Codec-neutral complete-packet modem boundary | Separate `FIPS_PACKET` binary frames from PCM and codec code; no codec field reaches Rust transport. [VERIFIED: codebase] |
| WEB-04 | Binary packet/PCM WebSocket exchange | RFC 6455 binary messages plus existing FWAV binary validation are sufficient. [CITED: https://www.rfc-editor.org/info/rfc6455] |
| WEB-05 | Validation, bounded queues, observable states | Existing bridge has origin checking, a 256 KiB message cap, queue accounting, and an epoch; extend those policies to packet queues. [VERIFIED: codebase] |
| WEB-06 | One reset/reconnect recovery action | Existing reset already advances the bridge epoch and clears media queues; include FIPS transport queues and reconnect generation in the same authority. [VERIFIED: codebase] |
| CONFIG-02 | One validated A/B authority | Add a typed resolver as the sole source for roles, identities, ports, profiles and timing defaults. [VERIFIED: .planning/REQUIREMENTS.md] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Use codebase-memory graph discovery before text search for code relationships; graph discovery found the bridge's server/protocol/runner boundaries and their callers. [VERIFIED: AGENTS.md]
- Preserve the demo's actual OS-level IPv6 ping goal, browser-owned audio, Dockerized FIPS, isolated receiving node, complete-packet FIPS interface, and >=1357-byte sound MTU. [VERIFIED: AGENTS.md]
- Optimize for a reliable same-day vertical slice on macOS/macOS or macOS/Linux with Docker and Chromium. [VERIFIED: AGENTS.md]
- Do not bypass FIPS's encryption, identity, routing, heartbeat, or lifecycle; acoustic fragmentation/reliability stays below its transport interface. [VERIFIED: AGENTS.md]
- Keep changes within the GSD workflow; TypeScript remains strict, existing tests use Vitest and browser coverage uses Playwright. [VERIFIED: AGENTS.md] [VERIFIED: codebase]

## Summary

Pin and vendor upstream `jmcorgan/fips` at `fc8ebd5a06d6f042c57f03107f403116365a16b4` (master observed 2026-07-23), then add a small first-class connectionless `sound` transport to that source. The upstream architecture is deliberately concrete: it creates transports from `TransportsConfig`, stores them in `TransportHandle`, and dispatches lifecycle, send, state, MTU, discovery, connection, and stats behavior through enum match arms. A correct Phase 2 patch therefore touches all of those seams and injects received opaque packets as `ReceivedPacket` on FIPS's existing `PacketTx`; it must not bolt a separate packet path around the node. [VERIFIED: github.com/jmcorgan/fips]

The existing TypeScript bridge is an appropriate local authority, not something to replace. It already restricts the browser WebSocket to loopback and same origin, parses a fixed binary FWAV envelope, caps messages at 256 KiB, tracks epoch/sequence, and bounds existing PCM queues. Extend it with a second local FIPS-facing socket endpoint and two bounded complete-packet queues. Use a new binary `FIPS_PACKET` FWAV message type with no PCM metadata; reserve JSON for compact validated status/control only. [VERIFIED: codebase] [CITED: https://www.rfc-editor.org/info/rfc6455]

For tomorrow's reproducibility, commit a normal repository-local `vendor/fips/` source snapshot plus `UPSTREAM.md` rather than a mutable branch, a recursive submodule, or a Docker build-time clone. Record upstream URL, immutable commit, source date, MIT license, Rust toolchain, and the sound-patch files. This is a recommendation based on the project's one-day/reproducibility constraint; it is not an upstream requirement. [ASSUMED]

**Primary recommendation:** Vendor `fc8ebd5`, implement its complete `sound` transport lifecycle with `tokio-tungstenite` 0.30.0, and relay only opaque binary packet frames between the FIPS socket and armed browser through the existing bounded, epoch-owned bridge. [VERIFIED: github.com/jmcorgan/fips] [VERIFIED: crates.io]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| A/B role resolution and secret-safe defaults | Local bridge / launcher | Browser display | One immutable validated object must author process configuration; browser receives only safe scalar state. [VERIFIED: .planning/phases/02-configure-and-establish-the-codec-neutral-fips-bridge/02-CONTEXT.md] |
| Browser microphone, speaker, PCM, codec runtime | Browser / Client | Local bridge | Browser ownership is a locked portability constraint. [VERIFIED: AGENTS.md] |
| FWAV validation, queue bounds, epoch and status | Local bridge service | Browser / Client | It is the boundary shared by untrusted browser messages and the local FIPS transport. [VERIFIED: codebase] |
| Opaque FIPS packet lifecycle, MTU and `ReceivedPacket` injection | FIPS daemon in Docker | Local bridge service | FIPS owns its normal transport lifecycle and all peer/security semantics. [VERIFIED: github.com/jmcorgan/fips] |
| Physical packet fragmentation, ARQ and half-duplex modem scheduling | Browser / Client | Local bridge | Deferred to Phase 3 and must remain below the opaque packet boundary. [VERIFIED: .planning/ROADMAP.md] |
| Host exposure of the browser bridge | Docker / Static boundary | Local bridge | Host-publish only loopback; the FIPS container joins the bridge service network namespace to reach its loopback endpoint. [CITED: https://docs.docker.com/compose/how-tos/networking/] [ASSUMED] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `jmcorgan/fips` vendored source | `fc8ebd5a06d6f042c57f03107f403116365a16b4`, `0.5.0-dev` | Normal FIPS identity, handshake, encryption, routing, heartbeat, TUN and transport lifecycle | This is the required integration target and exposes the concrete transport seams needed here. [VERIFIED: github.com/jmcorgan/fips] |
| Rust | `1.94.1` | Build the pinned FIPS fork and sound transport | The upstream `rust-toolchain.toml` pins this exact toolchain; it is installed through rustup on this machine. [VERIFIED: github.com/jmcorgan/fips] [VERIFIED: local environment] |
| `tokio-tungstenite` | `=0.30.0`, published within the prior week | Async binary WebSocket client in the FIPS sound transport | Official crate docs provide Tokio WebSocket streams/sinks; use it instead of implementing RFC 6455 in Rust. [VERIFIED: crates.io] [CITED: https://docs.rs/tokio-tungstenite/latest/tokio_tungstenite/] |
| Existing `ws` bridge | `8.21.1` locked | Same-origin browser/FIPS binary relay | Already installed, audited by the repository, and used by the bridge server. [VERIFIED: package.json] [VERIFIED: codebase] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| FIPS's existing `tokio` and `futures` dependencies | lockfile-resolved by `vendor/fips/Cargo.lock` | Reconnect worker, packet channel, stream/sink operations | Reuse them; do not add a second async runtime. [VERIFIED: github.com/jmcorgan/fips] |
| Docker Compose | `v2.40.3-desktop.1` installed | Keep bridge host publication loopback-only and let FIPS join its local network namespace | Use `network_mode: service:bridge` for the Phase 2 local pair. [VERIFIED: local environment] [CITED: https://docs.docker.com/compose/how-tos/networking/] |
| Vitest / Playwright | `4.1.10` / `1.61.1` locked | Bridge/unit and browser recovery validation | Preserve the repository's existing test tooling. [VERIFIED: package.json] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Repository-local vendor snapshot | Git submodule or build-time clone | A submodule adds clone/init failure modes; a build-time clone permits unreviewed upstream drift unless carefully pinned. Vendor for the demo, keep provenance beside it. [ASSUMED] |
| `tokio-tungstenite` | Hand-written WebSocket client | RFC 6455 framing, masking, close, and protocol error handling are not demo work; use the maintained Tokio adapter. [CITED: https://docs.rs/tokio-tungstenite/latest/tokio_tungstenite/] |
| Shared bridge network namespace | `host.docker.internal` from FIPS | `service:{name}` is a Compose-supported local namespace relationship; host gateway behavior is less uniform across the required macOS/Linux pair. [CITED: https://docs.docker.com/compose/how-tos/networking/] [ASSUMED] |

**Installation:**

```bash
# in vendor/fips/Cargo.toml — exact direct dependency, no TLS needed for ws://127.0.0.1
tokio-tungstenite = "=0.30.0"

cd vendor/fips
cargo build --locked
```

**Version verification:** `cargo search tokio-tungstenite --limit 1` and `cargo info tokio-tungstenite@0.30.0` confirmed version 0.30.0, MIT license, `rust-version: 1.85`, and repository `snapview/tokio-tungstenite`; the upstream FIPS checkout compiled its locked test targets with Rust 1.94.1. [VERIFIED: crates.io] [VERIFIED: github.com/jmcorgan/fips]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `tokio-tungstenite` [VERIFIED: crates.io] | crates.io | 9+ years | 4,375,262/week | `github.com/snapview/tokio-tungstenite` | OK | Approved; exact `=0.30.0` direct dependency. [VERIFIED: crates.io] |

**Packages removed due to [SLOP] verdict:** none.

**Packages flagged as suspicious [SUS]:** none.

The legitimacy seam returned `OK`; `cargo search` and the official repository/docs confirmed the package identity. Rust crates do not run npm-style `postinstall` scripts. [VERIFIED: crates.io]

## Architecture Patterns

### System Architecture Diagram

```text
 Browser page (same origin, armed)
   | binary FWAV: PCM / FIPS_PACKET         JSON: compact validated status only
   v
 Bridge service (container network namespace)
   - validates magic/version/type/length/epoch/sequence
   - owns browser + FIPS connections, queues, counters, reset generation
   | 127.0.0.1 inside the shared namespace: binary FIPS_PACKET only
   v
 FIPS sound transport (FIPS container)
   - reconnect worker, MTU=1357 minimum, static remote address
   - no codec, PCM, fragment, or browser types
   | outbound: complete opaque bytes             inbound: ReceivedPacket
   v
 Existing FIPS Node packet channel <-> normal peer/identity/encryption/routing lifecycle

 Host publication: 127.0.0.1:PORT -> bridge service only
 No bridge port is published to a LAN interface; no inter-laptop packet path exists here.
```

Docker Compose documents `network_mode: service:{name}` as a supported way for one service to access another service's networking. Publish the bridge's browser port as `127.0.0.1:HOST:CONTAINER`; Docker warns that omitting the host IP publishes to all interfaces. The exact compose wiring remains an implementation choice to verify in a Linux-engine smoke test. [CITED: https://docs.docker.com/compose/how-tos/networking/] [CITED: https://docs.docker.com/reference/compose-file/services/]

### Recommended Project Structure

```text
packages/bridge/src/
├── demo-config.ts           # typed `a`/`b` resolver and safe public projection
├── protocol.ts              # FWAV v1 + FIPS_PACKET message validation
├── server.ts                # browser/FIPS endpoints, packet queues, reset authority
└── runner.ts                # consumes resolved role config; no duplicated constants
vendor/fips/
├── UPSTREAM.md              # URL, fc8ebd5..., source date, MIT provenance, patch list
├── Cargo.lock               # locked vendored dependency graph
└── src/
    ├── config/transport.rs  # SoundConfig / TransportsConfig.sound
    ├── transport/sound/     # codec-neutral local WebSocket transport
    ├── transport/mod.rs     # Sound type + TransportHandle dispatch
    └── node/mod.rs          # construction and sound fallback for transport MTU
compose.fips.yml             # bridge + FIPS service namespace and loopback host publication
```

The names are recommended TypeScript/Rust placements, not locked user decisions. [ASSUMED]

### Pattern 1: Complete-packet adapter through FIPS's normal packet channel

**What:** `SoundTransport::send_async` accepts one opaque `&[u8]`, rejects it above configured MTU, and writes one binary bridge frame. Its receive task validates one complete bridge packet, then sends `ReceivedPacket::new(transport_id, configured_remote_addr, data)` to FIPS's existing bounded `PacketTx`. [VERIFIED: github.com/jmcorgan/fips]

**When to use:** Always in Phase 2; acoustic fragmentation and reliability are explicitly later/lower-layer concerns. [VERIFIED: .planning/ROADMAP.md]

**Example:**

```rust
// Source: https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/src/transport/mod.rs
// The sound receive worker must hand a complete payload to the existing path.
packet_tx.send(ReceivedPacket::new(transport_id, remote_addr, data)).await?;
```

### Pattern 2: Enum-complete first-class transport integration

**What:** Add `SoundTransport` to `TransportHandle` and update every delegated operation: async `start`, `stop`, `send`, ID/name/type/state/MTU/link MTU/discovery/connection behavior, congestion/stats, plus `Node::create_transports`. Add `SoundConfig` and `TransportsConfig.sound`; export it from `config/mod.rs`. [VERIFIED: github.com/jmcorgan/fips]

**When to use:** Required because the upstream transport abstraction is an enum dispatcher, not a dynamic registration API. [VERIFIED: github.com/jmcorgan/fips]

### Pattern 3: One epoch authority across both socket legs

**What:** A reset increments one bridge epoch, clears browser PCM/codec queues and both FIPS-packet queues, aborts/replaces reconnect work, and emits the next-epoch reset acknowledgement. Both browser and FIPS clients reject stale epoch completions before mutating counters or injecting packets. [VERIFIED: codebase] [ASSUMED]

**When to use:** Browser reconnect, malformed/overflow recovery, or explicit operator reset. [VERIFIED: .planning/phases/02-configure-and-establish-the-codec-neutral-fips-bridge/02-CONTEXT.md]

### Anti-Patterns to Avoid

- **A FIPS sidecar that writes into a TUN or peer internals:** bypasses normal identity, handshake, routing, heartbeat and MTU behavior. Use `PacketTx` / `TransportHandle` instead. [VERIFIED: AGENTS.md] [VERIFIED: github.com/jmcorgan/fips]
- **One socket/client role for browser and FIPS:** it cannot express independent ownership and reconnect state. Use distinct validated browser and FIPS bridge endpoint roles. [ASSUMED]
- **JSON/base64 packet payloads:** wastes bandwidth and violates WEB-04. Use FWAV binary payloads. [VERIFIED: .planning/REQUIREMENTS.md]
- **Reporting 1357 while only accepting smaller packets:** creates a false IPv6 MTU claim. Enforce `data.len() <= mtu` on the Rust send and test exactly 1357 bytes. [VERIFIED: github.com/jmcorgan/fips]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket protocol client in Rust | Hand-rolled HTTP upgrade, masking and RFC 6455 state machine | `tokio-tungstenite = "=0.30.0"` | It provides Tokio WebSocket streams/sinks and maintained protocol handling. [VERIFIED: crates.io] |
| FIPS handshake/encryption/routing | Custom packet tunnel or application-level peer protocol | Upstream `TransportHandle` and `PacketTx` lifecycle | FIPS already owns the security/routing semantics required by the demo. [VERIFIED: github.com/jmcorgan/fips] |
| Binary message validation | Ad-hoc byte parsing in each endpoint | Existing `encodeFrame` / `decodeFrame` FWAV module, extended with one packet type | It already validates magic, version, declared length, PCM geometry, payload cap and epoch/sequence. [VERIFIED: codebase] |
| Docker host gateway special cases | Per-OS `host.docker.internal` workaround | Shared `network_mode: service:bridge` local namespace | It keeps the FIPS connection on loopback and avoids a host-to-container routing dependency. [CITED: https://docs.docker.com/compose/how-tos/networking/] [ASSUMED] |

**Key insight:** The codec-neutral boundary is not an abstraction layer that needs a new modem framework. It is a narrow contract: complete opaque packet in/out, bounded local state, validated reset epoch, and transport lifecycle state. [VERIFIED: .planning/phases/02-configure-and-establish-the-codec-neutral-fips-bridge/02-CONTEXT.md]

## Common Pitfalls

### Pitfall 1: Updating only the `Transport` trait implementation

**What goes wrong:** Rust compiles part of a new transport but `TransportHandle` cannot dispatch lifecycle/state/MTU operations or `Node::create_transports` never constructs it. [VERIFIED: github.com/jmcorgan/fips]

**Why it happens:** FIPS uses a concrete enum wrapper to support async methods beyond its synchronous trait. [VERIFIED: github.com/jmcorgan/fips]

**How to avoid:** Treat config export, `TransportsConfig`, `create_transports`, every `TransportHandle` match, stats, and tests as one atomic fork patch. [VERIFIED: github.com/jmcorgan/fips]

**Warning signs:** `show_transports` omits `sound`, the node starts with no sound handle, or a non-exhaustive match appears. [VERIFIED: github.com/jmcorgan/fips]

### Pitfall 2: Passing the MTU unit test while TUN starts with 1203 effective bytes

**What goes wrong:** Upstream derives global TUN MTU from the minimum operational transport, and before one is operational its fallback currently consults UDP then 1280. [VERIFIED: github.com/jmcorgan/fips]

**Why it happens:** A sound reconnect worker may be disconnected from the browser while the FIPS node starts. [ASSUMED]

**How to avoid:** Make the sound transport operational as a local lifecycle worker at node start and extend the fallback selection to consider configured sound MTU; test `transport_mtu()==1357` and `effective_ipv6_mtu()==1280` before any peer is established. [VERIFIED: github.com/jmcorgan/fips] [ASSUMED]

**Warning signs:** `fipsctl`/control state shows sound MTU 1357 but the reported effective IPv6 MTU is 1203. [VERIFIED: github.com/jmcorgan/fips]

### Pitfall 3: Container loopback means the wrong machine

**What goes wrong:** A FIPS container connecting to `127.0.0.1` reaches itself rather than a host bridge, or a workaround publishes the bridge to the LAN. [CITED: https://docs.docker.com/compose/how-tos/networking/]

**How to avoid:** Run bridge and FIPS as separate services with `fips.network_mode: service:bridge`; bind the bridge itself to loopback in that namespace and publish the browser-facing port explicitly as `127.0.0.1:...`. Verify rendered compose and `docker inspect`, not just YAML text. [CITED: https://docs.docker.com/compose/how-tos/networking/] [ASSUMED]

### Pitfall 4: Letting a bridge queue turn a temporary browser outage into unbounded memory

**What goes wrong:** FIPS continues to enqueue full packets while browser/codec is absent. [VERIFIED: .planning/REQUIREMENTS.md]

**How to avoid:** Give each packet direction an item cap, byte cap and maximum age; reject/return actionable `bridge_disconnected` or `queue_overflow`, expose it in status, and require reset/reconnect rather than silently buffering. OWASP specifically recommends message-size limits and validation for WebSocket inputs. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html]

### Pitfall 5: Phase-2 packet relay masquerading as an acoustic link

**What goes wrong:** Test fixture/loopback evidence is shown as physical or packets cross an alternate laptop path. [VERIFIED: .planning/STATE.md]

**How to avoid:** Keep this phase local to each laptop, preserve Fixture/Loopback/Open-air evidence class fail-closed, and defer acoustic fragmentation/handshake/ping claims. [VERIFIED: codebase] [VERIFIED: .planning/ROADMAP.md]

## Code Examples

### Sound transport configuration shape

```yaml
# Shape only; field names are planner discretion.
transports:
  sound:
    bridge_url: "ws://127.0.0.1:8787/fips"
    peer_addr: "sound-peer"
    mtu: 1357
    queue_packets: 64
    queue_bytes: 262144
```

The configuration must be `#[serde(deny_unknown_fields)]`, reject MTU below 1357, and contain no codec/PCM fields. The exact YAML names above are an implementation recommendation. [VERIFIED: github.com/jmcorgan/fips] [ASSUMED]

### Binary packet extension rule

```typescript
// Source pattern: packages/bridge/src/protocol.ts
// FIPS_PACKET is non-PCM: its payload is opaque binary and sample metadata is zero.
decodeFrame(frame); // validates FWAV magic/version/type/declared length/cap first
if (decoded.type !== MessageType.FIPS_PACKET) throw new Error('unexpected packet role');
forwardOpaquePacket(decoded.payload);
```

Use a separate `MessageType.FIPS_PACKET` value rather than reusing PCM or qualification types. The field name/value is discretionary; the binary-validation-first rule is established by the existing protocol. [VERIFIED: codebase] [ASSUMED]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Assumed generic transport plug-in | Current FIPS master uses `Transport` plus a concrete `TransportHandle` enum | Current pinned commit | A sound transport patch must update enum dispatch and construction seams, not only implement a trait. [VERIFIED: github.com/jmcorgan/fips] |
| Browser bridge only carried PCM/qualification frames | Phase 2 extends the existing FWAV envelope with opaque complete packets | Phase 2 | Preserve the established binary validation boundary while keeping codec details above it. [VERIFIED: codebase] [ASSUMED] |

**Deprecated/outdated:** Do not use the Phase 1 qualification-only bridge contract as the FIPS data path; it lacks a complete-packet message type and FIPS client endpoint. [VERIFIED: codebase]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A repository-local vendor snapshot is less risky than a submodule for the one-day demo. | Summary / Alternatives | Medium — project may prefer a fork remote once authority exists. |
| A2 | `network_mode: service:bridge` works on each selected Docker engine and retains the desired localhost route. | Architecture / Pitfall 3 | Medium — verify immediately with the compose smoke on macOS and Linux. |
| A3 | `SoundConfig` field names and a `FIPS_PACKET` FWAV value can follow the recommended names. | Project Structure / Code Examples | Low — naming only; protocol versioning and tests protect compatibility. |
| A4 | A local sound worker can be considered operational before browser arming while its send path fail-closes. | Pitfall 2 | Medium — decide exact FIPS status semantics and test TUN MTU at startup. |

## Open Questions — RESOLVED

1. **RESOLVED — Shared network namespace across target Docker engines**
   - Decision: Accept `network_mode: service:bridge` with explicit loopback publication provisionally as the Phase 2 topology. Compose documents the mechanism, and 02-05 owns source, rendered-config and live engine smoke coverage. [CITED: https://docs.docker.com/compose/how-tos/networking/]
   - Enforcement: The automated smoke must prove one shared namespace, browser origin reachability, FIPS-to-bridge loopback reachability and absence of non-loopback host publication on the executing Docker engine. Any render, inspect, readiness or reachability mismatch fails closed; implementation must not widen the bind or add a LAN fallback. [ASSUMED]
   - Residual verification: The second target engine/hardware pair remains a rehearsal/UAT matrix item rather than an unresolved architecture choice; the same smoke must pass unchanged there before claiming cross-engine compatibility. [ASSUMED]

2. **RESOLVED — FIPS worker lifecycle while the browser is unarmed**
   - Decision: FIPS may expose worker lifecycle `Up` so the configured 1357-byte transport MTU participates in normal node/TUN setup, while a separate `browserReady: false` state remains authoritative for packet service. [VERIFIED: github.com/jmcorgan/fips] [VERIFIED: .planning/phases/02-configure-and-establish-the-codec-neutral-fips-bridge/02-UI-SPEC.md]
   - Enforcement: Until the current-epoch browser modem has completed `Arm modem`, sends fail with the safe disconnected result, inbound work is rejected and accepted counters do not advance. Plans 02-07, 02-04 and 02-06 test Rust, bridge and real-browser sides of this split state. [ASSUMED]
   - Claim boundary: Worker `Up` never means browser ready, acoustic link ready, peer connected or ping ready. [VERIFIED: .planning/phases/02-configure-and-establish-the-codec-neutral-fips-bridge/02-CONTEXT.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Rust toolchain | Vendored FIPS build | ✓ | `1.94.1` via rustup in pinned checkout | — [VERIFIED: local environment] |
| Cargo locked test build | Fork validation | ✓ | `1.94.1`; `cargo test --no-run --locked` passed for upstream pin | — [VERIFIED: local environment] |
| Docker / Compose | Local bridge/FIPS namespace smoke | ✓ | Docker `28.5.2`; Compose `v2.40.3-desktop.1` | — [VERIFIED: local environment] |
| Node | Existing bridge build/test | ⚠ version mismatch | active `v25.2.1`; project declares `22.23.1` | Activate/install Node `22.23.1`; do not silently accept another runtime. [VERIFIED: local environment] [VERIFIED: package.json] |
| Host `/dev/net/tun` | Container kernel-TUN demo | ✗ on this macOS host | — | Existing Docker TUN preflight is the authority; host device absence is expected outside Linux containers. [VERIFIED: local environment] [VERIFIED: compose.preflight.yml] |
| Chromium executable | Manual browser smoke | ✗ on PATH | — | Playwright-managed Chromium / target demo browser; verify in Phase 2 smoke. [VERIFIED: local environment] |

**Missing dependencies with no fallback:** Node `22.23.1` must be activated/installed before treating the repository's package-engine contract as satisfied. [VERIFIED: package.json] [VERIFIED: local environment]

**Missing dependencies with fallback:** A PATH-visible Chromium is absent, but the existing Playwright browser path can cover automated browser tests; manual validation remains on the selected Chromium laptop. [VERIFIED: package.json] [ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.10`; Playwright `1.61.1`; vendored FIPS `cargo test` [VERIFIED: package.json] [VERIFIED: github.com/jmcorgan/fips] |
| Config file | `vitest.config.ts`, `playwright.config.ts`, `vendor/fips/rust-toolchain.toml` [VERIFIED: codebase] [VERIFIED: github.com/jmcorgan/fips] |
| Quick run command | Use `./node_modules/.bin/vitest run packages/bridge/test/protocol.test.ts tests/production-runner.test.ts` after Node 22 activation. [VERIFIED: package.json] [ASSUMED] |
| Full suite command | `npm run check` plus `cd vendor/fips && cargo test --locked` [VERIFIED: package.json] [VERIFIED: github.com/jmcorgan/fips] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONFIG-02 | Only `a`/`b` resolve; invalid overrides fail; public projection excludes nsec | unit | `./node_modules/.bin/vitest run packages/bridge/test/demo-config.test.ts` | ❌ Wave 0 |
| WEB-04 | Browser and FIPS endpoints relay byte-identical binary complete packets, never JSON/base64 | integration | `./node_modules/.bin/vitest run packages/bridge/test/fips-packet-bridge.test.ts` | ❌ Wave 0 |
| WEB-05 | Invalid type/length/role and queue limit reject; safe state exposes ready/disconnected/overflow/error | unit/integration | `./node_modules/.bin/vitest run packages/bridge/test/protocol.test.ts packages/bridge/test/fips-packet-bridge.test.ts` | ❌ Wave 0 / protocol exists |
| WEB-06 | One reset clears both packet directions and rejects prior-epoch completion | integration | `./node_modules/.bin/vitest run packages/bridge/test/fips-packet-bridge.test.ts tests/production-runner.test.ts` | ❌ Wave 0 / runner exists |
| CODEC-01 | Rust transport has no codec/PCM field and forwards opaque bytes | Rust unit | `cd vendor/fips && cargo test sound_transport --locked` | ❌ Wave 0 |
| FIPS-01 / FIPS-02 | Config creates sound handle; start/stop/send/receive use normal `PacketTx` lifecycle | Rust integration | `cd vendor/fips && cargo test sound_transport --locked` | ❌ Wave 0 |
| FIPS-03 | 1357-byte acceptance and `effective_ipv6_mtu()==1280` | Rust unit | `cd vendor/fips && cargo test sound_mtu --locked` | ❌ Wave 0 |
| FIPS-01 / WEB-05 | Compose renders FIPS sharing bridge namespace and publishes only loopback port | config smoke | `docker compose -f compose.fips.yml config` plus inspect assertion | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** targeted Vitest test plus target `cargo test sound_* --locked`. [ASSUMED]
- **Per wave merge:** `npm run typecheck && npm run test:unit && cd vendor/fips && cargo test --locked`. [VERIFIED: package.json] [ASSUMED]
- **Phase gate:** Compose namespace smoke, browser/FIPS fixture relay, and full suites green before `$gsd-verify-work`. [ASSUMED]

### Wave 0 Gaps

- [ ] `packages/bridge/test/demo-config.test.ts` — CONFIG-02 role/default/secret-redaction tests.
- [ ] `packages/bridge/test/fips-packet-bridge.test.ts` — dual endpoint, binary relay, limits, state, epoch reset.
- [ ] `vendor/fips/src/transport/sound/mod.rs` tests — lifecycle, MTU, oversize rejection, inbound `ReceivedPacket`, reconnect fixture.
- [ ] `tests/fips-compose.test.mjs` or an extension to existing compose validation — namespace and explicit host loopback publication.
- [ ] Node `22.23.1` activation check before Node validation.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Partial | FIPS keeps its existing peer identity/handshake; the local bridge does not invent a peer-auth bypass. [VERIFIED: github.com/jmcorgan/fips] |
| V3 Session Management | Yes | Bridge epoch/generation rejects stale reset, media and packet completions. [VERIFIED: codebase] |
| V4 Access Control | Yes | Browser endpoint enforces same-origin loopback; FIPS endpoint stays in the local shared namespace; host port publishes only `127.0.0.1`. [VERIFIED: codebase] [CITED: https://docs.docker.com/reference/compose-file/services/] [ASSUMED] |
| V5 Input Validation | Yes | Decode fixed FWAV header before payload use; exact endpoint role/type allowlists, caps, queue bounds and safe error projection. [VERIFIED: codebase] [CITED: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html] |
| V6 Cryptography | Yes | Reuse FIPS encryption and browser/Rust platform randomness; do not add codec-layer crypto. [VERIFIED: AGENTS.md] |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-site connection to a local bridge | Spoofing | Exact loopback origin validation for browser upgrades and no LAN host publication. [VERIFIED: codebase] [CITED: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html] |
| Malformed/oversized FWAV packet | Tampering / DoS | Verify magic/version/type/declared size before dispatch; reject at cap and count safe error. [VERIFIED: codebase] |
| Stale packet/reset completion | Replay | Epoch plus monotonically validated sequence/generation; clear volatile queues on reset. [VERIFIED: codebase] |
| Browser outage fills memory | DoS | Per-direction packet queue item/byte/age caps; fail closed and make recovery visible. [VERIFIED: .planning/REQUIREMENTS.md] [ASSUMED] |
| nsec exposed in state/logs | Information disclosure | Resolver separates private runtime config from browser/public state; bounded safe messages never include config documents. [VERIFIED: .planning/phases/02-configure-and-establish-the-codec-neutral-fips-bridge/02-CONTEXT.md] [ASSUMED] |
| Bridge accidentally becomes laptop-to-laptop path | Elevation / Spoofing | Compose explicit loopback host IP, no host networking, and inspect-based topology test. [CITED: https://docs.docker.com/reference/compose-file/services/] [ASSUMED] |

## Sources

### Primary (MEDIUM confidence — official source inspected; Context7 unavailable in this runtime)

- [FIPS pinned source](https://github.com/jmcorgan/fips/tree/fc8ebd5a06d6f042c57f03107f403116365a16b4) — commit, Cargo/toolchain/license, configuration, transport trait/handle, node construction, packet channel and MTU calculation. [VERIFIED: github.com/jmcorgan/fips]
- [FIPS transport dispatch](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/src/transport/mod.rs) — `Transport`, `TransportHandle`, lifecycle and MTU delegation. [VERIFIED: github.com/jmcorgan/fips]
- [FIPS node transport construction](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/src/node/mod.rs) — `create_transports` and operational-MTU fallback. [VERIFIED: github.com/jmcorgan/fips]
- [tokio-tungstenite 0.30.0 docs](https://docs.rs/tokio-tungstenite/latest/tokio_tungstenite/) — Tokio binary WebSocket stream/sink API. [VERIFIED: crates.io]

### Secondary (MEDIUM confidence)

- [RFC 6455](https://www.rfc-editor.org/info/rfc6455/) — WebSocket binary data frames. [CITED: https://www.rfc-editor.org/info/rfc6455]
- [Docker Compose networking](https://docs.docker.com/compose/how-tos/networking/) and [Compose services reference](https://docs.docker.com/reference/compose-file/services/) — service network mode and explicit loopback port publication. [CITED: https://docs.docker.com/compose/how-tos/networking/]
- [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) — origin validation, message limits and binary input validation. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html]

### Tertiary (LOW confidence)

- None; implementation naming and same-day deployment choices are explicitly listed in the Assumptions Log. [ASSUMED]

## Metadata

**Confidence breakdown:**

- Standard stack: MEDIUM — exact FIPS commit and crate version were verified from official sources/registry, but Context7 was unavailable. [VERIFIED: github.com/jmcorgan/fips] [VERIFIED: crates.io]
- Architecture: MEDIUM — FIPS and bridge seams were inspected directly; shared-namespace wiring needs an exact-engine smoke. [VERIFIED: codebase] [ASSUMED]
- Pitfalls: MEDIUM — enum/MTU behavior is source-verified; deployment behavior is partly a documented inference. [VERIFIED: github.com/jmcorgan/fips] [ASSUMED]

**Research date:** 2026-07-24
**Valid until:** 2026-07-31 (FIPS master and `tokio-tungstenite` are fast-moving).
