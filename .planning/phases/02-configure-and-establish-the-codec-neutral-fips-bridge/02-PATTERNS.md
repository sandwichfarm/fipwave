# Phase 2: Configure and Establish the Codec-Neutral FIPS Bridge - Pattern Map

**Mapped:** 2026-07-24
**Files analyzed:** 15 anticipated source/config/test files (plus the vendored FIPS snapshot)
**Analogs found:** 15 / 15 (five are pinned-upstream external analogs because `vendor/fips/` does not yet exist)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/bridge/src/demo-config.ts` | config/utility | transform | `packages/bridge/src/runner.ts` | role-match |
| `packages/bridge/test/demo-config.test.ts` | test | transform | `tests/production-runner.test.ts` | role-match |
| `packages/bridge/src/protocol.ts` | utility/protocol | request-response | itself: FWAV validation | exact extension |
| `packages/bridge/test/protocol.test.ts` | test | request-response | itself | exact extension |
| `packages/bridge/src/server.ts` | service | event-driven | itself: browser WebSocket handler/queues | exact extension |
| `packages/bridge/test/fips-packet-bridge.test.ts` | test | event-driven | `tests/production-runner.test.ts` | role/data-flow match |
| `packages/bridge/src/runner.ts` | controller/service | request-response | itself: immutable runner authority | exact extension |
| `vendor/fips/UPSTREAM.md` | config/provenance | file-I/O | `package.json` + existing pinned image conventions | partial |
| `vendor/fips/Cargo.toml` | config | build | upstream `Cargo.toml` | exact external |
| `vendor/fips/src/config/transport.rs` | model/config | transform | upstream `UdpConfig` | exact external |
| `vendor/fips/src/config/mod.rs` | config export | transform | upstream config exports | exact external |
| `vendor/fips/src/transport/sound/mod.rs` | service/transport | streaming | upstream `src/transport/{udp,tcp,loopback}.rs` and `mod.rs` packet seam | role/data-flow match |
| `vendor/fips/src/transport/mod.rs` | provider/dispatcher | event-driven | upstream `TransportHandle` enum dispatcher | exact external |
| `vendor/fips/src/node/mod.rs` | controller/provider | event-driven | upstream transport creation and MTU selection | exact external |
| `compose.fips.yml` and Compose smoke test | config/test | request-response | `compose.preflight.yml`, `tests/tun-preflight.test.ts` | role-match |

## Pattern Assignments

### `packages/bridge/src/demo-config.ts` (config/utility, transform)

**Analog:** `packages/bridge/src/runner.ts:79-101`.

Keep the resolver as the sole authority, freeze validated runtime values, and reject invalid configuration rather than coercing it. The browser must receive only a deliberately constructed public projection.

```ts
// packages/bridge/src/runner.ts:79-82,99
assertText(options.machineId, 'machine ID');
if (options.role !== 'A' && options.role !== 'B') fail('role must be literal A or B');
if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) fail('port is invalid');

const config = Object.freeze({ machineId: options.machineId, role: options.role, ... } satisfies RunnerQualificationConfig);
```

Use a lower-case input union (`'a' | 'b'`) at the CLI/resolver seam and convert to the existing upper-case runner role only in the projection used by `startProductionRunner`. Keep private `nsec` in the internal resolved type; define a separate public type/object rather than object-spreading it into HTTP/WS state.

### `packages/bridge/test/demo-config.test.ts` (test, transform)

**Analog:** `tests/production-runner.test.ts:163-171`.

Tests should exercise the authority through its public boundary and assert immutable, repeatable output.

```ts
// tests/production-runner.test.ts:164-170
const runner = await startProductionRunner({ machineId: 'laptop-a', role: 'A', port: 0, ... });
const first = await (await fetch(`http://127.0.0.1:${runner.port}/qualification-config`)).json();
expect(first).toMatchObject({ machineId: 'laptop-a', role: 'A', evidenceClass: 'Loopback' });
expect(await (await fetch(`http://127.0.0.1:${runner.port}/qualification-config`)).json()).toEqual(first);
```

Cover only `a`/`b`, override layering/validation, safe port checks, and prove the public projection serializes without either private nsec.

### `packages/bridge/src/protocol.ts` and `packages/bridge/test/protocol.test.ts` (protocol utility/test, request-response)

**Analog:** `packages/bridge/src/protocol.ts:12-21,77-110,113-149`; tests at `packages/bridge/test/protocol.test.ts:15-42,44-69,98-105`.

Add one non-PCM `FIPS_PACKET` enum value and preserve the existing envelope; no parallel packet parser or JSON/base64 path. Non-PCM frames already require zero PCM metadata, which is precisely the codec-neutral packet contract.

```ts
// packages/bridge/src/protocol.ts:101-109
const isPcm = frame.type === MessageType.PCM_CAPTURE || frame.type === MessageType.PCM_PLAYBACK;
if (isPcm) {
  if (sampleRate === 0) fail('sample rate must be declared for PCM');
  if (channels === 0) fail('channel count must be declared for PCM');
  if (encoding !== PcmEncoding.FLOAT32_LE) fail('PCM encoding is unsupported');
  decodePcmPayload(frame.payload, channels);
} else if (sampleRate !== 0 || channels !== 0 || encoding !== PcmEncoding.NONE) {
  fail('non-PCM messages must not declare PCM format');
}
```

```ts
// packages/bridge/test/protocol.test.ts:33-42
it.each([['wrong magic', ...], ['wrong version', ...], ['unknown type', ...], ['wrong length', ...]])(
  'rejects %s', (_name, edit) => {
    const frame = encodeFrame({ type: MessageType.HELLO, epoch: 1, sequence: 0n, payload: Buffer.from('ok') });
    edit(frame); expect(() => decodeFrame(frame)).toThrow();
  },
);
```

Add byte-for-byte packet round-trip plus malformed type/length, PCM-metadata rejection, and epoch/sequence tests. Retain `MAX_PAYLOAD_BYTES`; the FIPS 1357-byte MTU fits well below it.

### `packages/bridge/src/server.ts` and `packages/bridge/test/fips-packet-bridge.test.ts` (service/test, event-driven)

**Analog:** `packages/bridge/src/server.ts:303-327,599-611,859-889,957-984`; test connection pattern in `tests/production-runner.test.ts:173-186`.

Extend `createBridgeServer`, not a separate listener. Add distinct, authenticated-by-path/role browser and FIPS socket legs; maintain a bounded queue for each packet direction, and expose safe connection/overflow/error state. Bulk relay is decoded FWAV binary only.

```ts
// packages/bridge/src/server.ts:303-326
const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
const clients = new Set<WebSocket>(); const queues = new Map<MessageType, Queue>();
for (const type of [...]) queues.set(type, { frames: [], bytes: 0, overflowed: false });

while (queue.frames.length && now - queue.frames[0]!.enqueuedAt > MAX_QUEUE_AGE_MS) {
  const expired = queue.frames.shift()!; queue.bytes -= expired.frame.payload.byteLength + HEADER_BYTES;
}
if (queue.bytes + frame.payload.byteLength + HEADER_BYTES > MAX_MESSAGE_BYTES) {
  queue.overflowed = true; state.overflowedQueues = [...new Set([...state.overflowedQueues, queueName(frame.type)])];
  fail(`FWAV ${queueName(frame.type)} queue overflow`);
}
```

```ts
// packages/bridge/src/server.ts:867-888
if (!isBinary) fail('binary_frames_required');
const frame = decodeFrame(asBuffer(rawData));
if (frame.epoch !== state.epoch || frame.sequence <= lastSequence.value) fail('stale_or_duplicate_frame');
if (connection.mustResetBeforeUse && frame.type !== MessageType.RESET) fail('recovery_reset_required');
...
const previousEpoch = state.epoch;
const resetting = reset(alreadyPreempted);
...
await resetting; lastSequence.value = -1n;
```

```ts
// packages/bridge/src/server.ts:599-610
generation += 1; state.epoch += 1; ... clearQueues(); reconnectAllowed = true;
const resetFrame = encodeFrame({ type: MessageType.RESET, epoch: state.epoch, sequence: 0n, payload: Buffer.alloc(0) });
for (const client of clients) if (client.readyState === client.OPEN) client.send(resetFrame);
```

The new integration test should open the two endpoint roles, relay opaque `FIPS_PACKET` payloads byte-identically in both directions, reject browser/FIPS role mistakes and malformed frames, prove queue limits, then reset and prove old-epoch frames cannot deliver.

### `packages/bridge/src/runner.ts` (controller/service, request-response)

**Analog:** `packages/bridge/src/runner.ts:79-139,141-154`.

Runner remains an adapter: consume the resolved demo config and pass its safe role/port/UI inputs into the bridge. Do not duplicate per-role constants or expose secrets in `qualification-config`.

```ts
// packages/bridge/src/runner.ts:124-138
const bridgeOptions = {
  host: LOOPBACK_HOST, port: options.port, artifactDir: path.join(PROJECT_ROOT, '.artifacts', 'qualification'),
  uiDir: options.uiDir ?? path.join(PROJECT_ROOT, 'dist', 'modem-ui'), qualificationConfig: config,
  ...
} satisfies BridgeServerOptions;
const bridge = await createBridgeServer(bridgeOptions);
return { ...bridge, config };
```

Use `execFile` argument arrays for eventual child ownership/orchestration; do not introduce shell interpolation. Pair every started FIPS child with an owned handle and stop only that handle.

### `vendor/fips/UPSTREAM.md` and `vendor/fips/Cargo.toml` (provenance/build config)

**External analog:** pinned upstream [`Cargo.toml`](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/Cargo.toml):1-40.

Vendor a normal source snapshot and record URL, exact commit `fc8ebd5a06d6f042c57f03107f403116365a16b4`, source date, MIT license/provenance, Rust toolchain, and local patch list. Preserve the upstream dependency/runtime instead of adding another async runtime; add exactly pinned `tokio-tungstenite = "=0.30.0"` in the existing dependency section and update the committed lockfile.

```toml
# upstream Cargo.toml:23-34
thiserror = "2.0"
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1", features = ["rt", "macros", "signal", "sync", "net", "time", "process", "io-util"] }
futures = "0.3"
```

### `vendor/fips/src/config/transport.rs` and `vendor/fips/src/config/mod.rs` (model/config, transform)

**External analog:** pinned upstream [`src/config/transport.rs`](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/src/config/transport.rs):44-172 and its transport aggregate/export in `src/config/mod.rs`.

Model `SoundConfig` after `UdpConfig`: serde defaults, `deny_unknown_fields`, explicit accessor methods, and semantic validation. It may contain bridge URL, static peer address, MTU, and bounded queue settings only; it must contain no codec, PCM, browser, or fragment fields. MTU accessor/validation must fail below 1357.

```rust
// upstream src/config/transport.rs:44-57,124-127
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UdpConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mtu: Option<u16>,
}
impl UdpConfig {
    pub fn mtu(&self) -> u16 { self.mtu.unwrap_or(DEFAULT_UDP_MTU) }
}
```

### `vendor/fips/src/transport/sound/mod.rs` (transport service, streaming)

**External analog:** pinned upstream [`src/transport/mod.rs`](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/src/transport/mod.rs):50-103,109-150 plus the existing `udp`/`tcp` transport lifecycle modules in the vendored snapshot.

This is a narrow complete-packet adapter. Use the existing `PacketTx` and `ReceivedPacket`, a reconnecting `tokio-tungstenite` client to local loopback, and existing `TransportError` variants. Validate the bridge binary frame and its packet type before injection; reject oversized outbound FIPS packets before serializing.

```rust
// upstream src/transport/mod.rs:50-103
pub struct ReceivedPacket {
    pub transport_id: TransportId,
    pub remote_addr: TransportAddr,
    pub data: Vec<u8>,
    pub timestamp_ms: u64,
}
pub type PacketTx = tokio::sync::mpsc::Sender<ReceivedPacket>;
pub fn packet_channel(buffer: usize) -> (PacketTx, PacketRx) {
    tokio::sync::mpsc::channel(buffer)
}
```

```rust
// upstream src/transport/mod.rs:124-149
#[error("send failed: {0}")]
SendFailed(String),
#[error("receive failed: {0}")]
RecvFailed(String),
#[error("mtu exceeded: packet {packet_size} > mtu {mtu}")]
MtuExceeded { packet_size: usize, mtu: u16 },
```

The receive worker injects `ReceivedPacket::new(transport_id, configured_remote_addr, data)` only after full-frame validation. State `Up` means its local lifecycle worker is alive; a missing browser leg makes sends fail closed and reports disconnected telemetry.

### `vendor/fips/src/transport/mod.rs` and `vendor/fips/src/node/mod.rs` (provider/controller, event-driven)

**External analog:** pinned upstream [`src/transport/mod.rs`](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/src/transport/mod.rs):7-44,109-150,248-260 and [`src/node/mod.rs`](https://github.com/jmcorgan/fips/blob/fc8ebd5a06d6f042c57f03107f403116365a16b4/src/node/mod.rs):53-67,162-200.

Add `sound` as a first-class enum-dispatched transport, not a sidecar. Update every `TransportHandle` match (start/stop/send, state, MTU/link MTU, identity/name/type, connection/discovery/statistics behavior), import/construct it from `Node::create_transports`, and include configured sound MTU in the pre-operational TUN fallback so the effective IPv6 MTU is honestly 1280.

```rust
// upstream src/node/mod.rs:162-200
#[error("node start failed: no operational transports")]
NoOperationalTransports,
...
pub fn is_operational(&self) -> bool {
    matches!(self, NodeState::Running | NodeState::Degraded)
}
```

Tests belong beside `sound/mod.rs` and must cover lifecycle dispatch, one inbound `ReceivedPacket`, exact 1357-byte acceptance, oversize rejection, reconnect fixture, and `effective_ipv6_mtu() == 1280` at startup.

### `compose.fips.yml` and Compose validation (config/test, request-response)

**Analog:** `compose.preflight.yml:1-14` and `tests/tun-preflight.test.ts:75-109`.

Copy the explicit least-privilege spelling. FIPS shares the bridge service namespace (`network_mode: service:bridge`); only the bridge browser endpoint is published and it must be `127.0.0.1:HOST:CONTAINER`. Do not publish a FIPS packet endpoint or use host networking.

```yaml
# compose.preflight.yml:6-14
devices:
  - /dev/net/tun:/dev/net/tun
cap_add:
  - NET_ADMIN
security_opt:
  - no-new-privileges:true
privileged: false
network_mode: none
read_only: true
```

```ts
// tests/tun-preflight.test.ts:93-109
expect(() => validateComposeTopology(renderedCompose())).not.toThrow();
expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], network_mode: 'host' } } })).toThrow('host network');
expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], ports: ['0.0.0.0:8787:8787'] } } })).toThrow('loopback');
```

Extend the source/rendered/inspect assertions for the new two-service topology instead of trusting YAML text alone.

## Shared Patterns

### Binary validation before state mutation

**Source:** `packages/bridge/src/server.ts:867-872`, `packages/bridge/src/protocol.ts:130-149`.

Decode the bounded FWAV frame first, then check current epoch and monotonic sequence, then mutate queue/counter state. Packet payload is opaque only after those checks.

### One epoch/reset authority

**Source:** `packages/bridge/src/server.ts:599-611`; `packages/bridge/src/protocol.ts:52-70`.

Reset increments exactly one epoch, clears every queue, and makes late completion harmless. Apply this to both browser and FIPS packet legs, reconnect work, and codec queues.

### Fail-closed validation and safe state

**Source:** `packages/bridge/src/runner.ts:79-90`, `packages/bridge/src/server.ts:314-326`.

Reject invalid role/port/frame/queue conditions with actionable errors. Expose readiness/disconnection/overflow/epoch/last error, but never nsec or internal secrets.

### Loopback-only / least privilege

**Source:** `packages/bridge/src/server.ts:255-258`, `compose.preflight.yml:6-14`.

The bridge server itself insists on `127.0.0.1`; Compose tests reject wide binds, host networking, privilege escalation, and additional capabilities.

### Evidence classification remains fail-closed

**Source:** `packages/bridge/src/runner.ts:82-99`, `tests/production-runner.test.ts:164-171`.

Codec fixtures and loopback integration tests prove deterministic behavior only. They must not change evidence class to Open air or become a physical-link claim.

## No Analog Found

| File/Concern | Role | Data Flow | Reason / Planner Direction |
|---|---|---|---|
| Browser/FIPS endpoint-role handshake details | middleware | request-response | The current server has one browser owner, not two independent endpoint roles. Extend its validated upgrade/connection state rather than copy a nonexistent auth layer. |
| FIPS sound WebSocket wire implementation | transport service | streaming | No local Rust source exists until vendoring. Use pinned upstream UDP/TCP lifecycle shape plus the research-prescribed `tokio-tungstenite` framing. |

## Metadata

**Analog search scope:** `packages/bridge/src`, `packages/bridge/test`, `tests`, Compose/scripts, and pinned upstream FIPS commit `fc8ebd5a06d6f042c57f03107f403116365a16b4`.
**Files scanned:** 13 local files and 5 upstream source/config files.
**Pattern extraction date:** 2026-07-24.
