# Phase 4: Prove the Sound-Only FIPS Ping - Pattern Map

**Mapped:** 2026-07-24  
**Files analyzed:** 15 planned new/modified files  
**Analogs found:** 15 / 15

## File Classification

| New/Modified File | Role | Data flow | Closest analog | Match quality |
|---|---|---|---|---|
| `packages/bridge/src/proof.ts` | utility/model | transform | `apps/modem-ui/src/acoustic-status.ts` | role-match |
| `packages/bridge/src/demo-config.ts` | config | transform | itself: `resolveDemoConfig()` | exact extension |
| `packages/bridge/src/runner.ts` | service | request-response/file-I/O | itself: `renderFipsConfig()` + startup ownership | exact extension |
| `packages/bridge/src/server.ts` | service/route | request-response/event-driven | `/bridge-status` and `safeStatus()` | exact extension |
| `scripts/prove-sound-ping.mjs` | utility/controller | request-response | `scripts/fips-compose-smoke.mjs` | role-match |
| `scripts/fips-compose-smoke.mjs` | utility | request-response | itself: runtime inspection assertions | exact extension |
| `compose.fips.yml` | config | process/runtime | itself: bridge/FIPS shared namespace | exact extension |
| `vendor/fips/Dockerfile` | config | build | itself: final runtime image stages | exact extension |
| `vendor/fips/src/control/queries.rs` | service/model | transform | `show_peers`, `show_links`, `show_transports` | exact extension/consume |
| `vendor/fips/src/transport/sound/mod.rs` | service | event-driven | `connection_state()`/`transport_stats()` | exact extension/consume |
| `apps/modem-ui/src/proof-state.ts` | store/utility | transform | `apps/modem-ui/src/bridge-state.ts` | exact role-match |
| `apps/modem-ui/src/main.ts` | component/controller | request-response/event-driven | `refreshBridgeState()` + diagnostic-card renderer | exact extension |
| `apps/modem-ui/src/style.css` | component style | presentation | existing `.card`, `.operator-card`, `dl`, button rules | exact extension |
| `packages/bridge/test/sound-proof.test.ts` | test | transform | `apps/modem-ui/src/acoustic-status.test.ts` | role-match |
| `tests/sound-proof.test.mjs` / existing config/Compose/UI tests | test | request-response/fixture | `tests/fips-compose.test.mjs`, `tests/production-runner.test.ts`, UI tests | role-match |

## Pattern Assignments

### `packages/bridge/src/proof.ts` (utility/model, transform)

**Analog:** `apps/modem-ui/src/acoustic-status.ts`

Use a strict, closed JSON schema at the bridge boundary. Reject unexpected keys, invalid scalar values, and internally inconsistent readiness; return `undefined`/a safe failure rather than defaulting facts to success or zero. Keep this module pure: snapshot join, freshness/epoch/identity validation, bounded proof-result projection, and evidence disposition only.

**Exact-schema and invariant pattern** — `apps/modem-ui/src/acoustic-status.ts:28-39`:

```ts
export function parseAcousticPublicStatus(input: unknown): AcousticPublicStatus | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key as typeof keys[number]))) return undefined;
  // validate every scalar and allowed enum before projection
  if (ready !== (commitAcknowledged && currentHeartbeat && phase === 'Ready')) return undefined;
  return Object.freeze(value as unknown as AcousticPublicStatus);
}
```

**Related public-snapshot pattern** — `apps/modem-ui/src/bridge-state.ts:33-42`: validate full key cardinality, minimum MTU, ISO timestamp, and allowlisted error before `Object.freeze` projection. Apply the same method to control-socket documents; raw control JSON must never reach the browser.

**Control snapshot fields to join:** `vendor/fips/src/control/queries.rs:265-323`, `568-593`, and `1362-1400` establish `npub`, `connectivity`, `link_id`, `transport_type`, peer/link counters, link `transport_id`, transport `type/state/mtu/stats`. Require the expected npub, `connected`, `sound`, the same link/transport ID, exactly one B transport, `worker_up`, `acoustic_ready`, matching acoustic epoch, configured B target, and fresh timestamps before `pingReady: true`.

### `packages/bridge/src/demo-config.ts` (config, transform)

**Analog:** `packages/bridge/src/demo-config.ts:137-178` (`resolveDemoConfig`)

Extend the single immutable config authority rather than adding a second role/topology source. Add role-specific transport policy, deterministic target IPv6, and expected Sound peer/address to the existing `fips` projection; retain fixed peer mapping and no secret in the public type.

```ts
if (input !== 'a' && input !== 'b') throw new Error('demo config role must be literal a or b');
const raw = overrides === undefined ? {} : record(overrides, 'override_invalid');
exactKeys(raw, ['bridge', 'fips', 'retries', 'heartbeat', 'peerPublicKey', 'acoustic'], 'override_unknown_key');
if ('peerPublicKey' in raw) fail('peer_mapping_is_fixed');
// ... validate bounds, derive role + fixed opposite peer, then deep-freeze
return freeze({ inputRole: input, role, identity, peer, bridge,
  fips: { linkMtu, expectedPeerPublicKey: peer.publicKey }, ... });
```

**Secret/public separation** — `packages/bridge/src/demo-config.ts:181-195`: keep nsec-bearing fields exclusively in `DemoConfig`; expand `toPublicDemoConfig()` only with explicit allowlisted non-secret proof facts.

### `packages/bridge/src/runner.ts` (service, request-response/file-I/O)

**Analog:** `packages/bridge/src/runner.ts:87-116` and `119-129`

Render the role-owned FIPS YAML from `DemoConfig`, not from browser input. For Role B, render the only `transports` entry as `sound` and only peer address as Sound. Preserve normal FIPS `auto_connect` and `auto_reconnect`; do not create a demo handshake or restart path.

```ts
'transports:',
'  sound:',
`    bridge_url: "${config.bridge.fipsUrl}"`,
`    peer_addr: "sound-${config.inputRole === 'a' ? 'b' : 'a'}"`,
`    mtu: ${config.fips.linkMtu}`,
'peers:',
`  - npub: "${config.peer.publicKey}"`,
'    addresses:',
'      - transport: sound',
'    connect_policy: auto_connect',
'    auto_reconnect: true',
```

**Atomic secret config publication** — `packages/bridge/src/runner.ts:119-129`:

```ts
const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
try {
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, output);
} catch (error) {
  await unlink(temporary).catch(() => undefined);
  throw error;
}
```

Keep the listener-before-secret-config order from `startProductionRunner()` at `131-215`, its injected dependencies for tests, `ResourceOwner` cleanup, and its deliberately generic external `runner startup failed` error.

### `packages/bridge/src/server.ts` (service/route, request-response/event-driven)

**Analog:** `packages/bridge/src/server.ts:350` and `416-424`

Extend the existing loopback-only server with a bounded proof-status endpoint and a proof action endpoint only if they use the same origin/host and safe JSON response conventions. Project observed state into counters; do not let browser connection status become FIPS peer truth.

```ts
if (url.pathname === '/bridge-status' && !url.search) {
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(safeStatus()));
  return;
}
```

```ts
const refreshState = () => {
  for (const [type, queue] of queues) state.queueCounts[queueName(type)] = queue.frames.length;
  for (const [direction, queue] of packetQueues) {
    const target = direction === 'browser-to-fips' ? state.packetQueues.browserToFips : state.packetQueues.fipsToBrowser;
    target.items = queue.frames.length;
    target.bytes = queue.bytes;
  }
};
```

### `scripts/prove-sound-ping.mjs` (utility/controller, request-response)

**Analog:** `scripts/fips-compose-smoke.mjs:73-120`

Use `execFile` promisified once, literal argument arrays, bounded timeout/buffer, explicit inspected container ID, and `try/finally` cleanup. Make command execution injectable for fixture tests. The script must first ask the pure proof join whether it is ready; only then invoke `docker exec <role-a-fips-id> ping -6 -n -c 1 -W 15 <configured-b-fips0-ipv6>`. Never call a shell or concatenate command text.

```js
const execFileAsync = promisify(execFile);
const inspected = JSON.parse((await execFileAsync('docker', ['inspect', ...ids], {
  maxBuffer: 1024 * 1024,
})).stdout);
const tunOutput = await execFileAsync('docker', ['exec', fips.Id, 'sh', '-ec', '...'], {
  maxBuffer: 1024 * 1024,
});
```

For the new ping runner, use `ping` directly in the `docker exec` argument list (not the smoke script's `sh -ec` diagnostic command), include `{ timeout: 20_000, maxBuffer: 64 * 1024 }`, preserve raw process output only in the proof artifact, and project only bounded parsed exit/loss/sequence/latency fields to status.

### `scripts/fips-compose-smoke.mjs` and `compose.fips.yml` (runtime config, request-response/process)

**Analog:** `scripts/fips-compose-smoke.mjs:26-58`

Add role-B isolation assertions beside existing live inspect/TUN assertions. Assert runtime facts—not just rendered YAML: exactly one FIPS transport of type Sound from the bounded Node control client, no FIPS published ports, shared bridge namespace, exact `NET_ADMIN`, `/dev/net/tun`, and loopback browser publication.

```js
if (Object.keys(fips.NetworkSettings?.Ports ?? {}).length !== 0) throw new Error('fips must not publish ports');
if (!String(fips.HostConfig?.NetworkMode ?? '').startsWith('container:')) throw new Error('fips namespace must target bridge container');
if (fips.HostConfig?.Privileged !== false || bridge.HostConfig?.Privileged !== false) throw new Error('privileged mode must be false');
exact(fips.HostConfig?.CapDrop, ['ALL'], 'fips dropped capabilities');
exact(fips.HostConfig?.CapAdd, ['NET_ADMIN'], 'fips capabilities');
```

Retain the current bounded polling pattern (`scripts/fips-compose-smoke.mjs:94-116`) and cleanup. Do not add host networking or LAN browser endpoints to Compose.

### `vendor/fips/Dockerfile` (config/build)

**Analog:** the existing multi-stage final-image conventions in `vendor/fips/Dockerfile`.

Install `iputils-ping` in the bridge runtime layer; retain pinned base packages and the current non-privileged image posture. Do not copy/build `fipsctl`; use a bounded Node client against the private shared Unix socket. Tests should inspect the final bridge image for `/usr/bin/ping` and verify that the client can issue only the three allowlisted queries.

### `vendor/fips/src/control/queries.rs` and `vendor/fips/src/bin/fipsctl.rs` (service/model, transform)

**Analog:** existing query projections; consume them rather than creating a log parser or a new control protocol.

```rust
// queries.rs:265-293
"npub": peer.npub(),
"connectivity": format!("{}", peer.connectivity()),
"link_id": peer.link_id().as_u64(),
"authenticated_at_ms": peer.authenticated_at(),
// resolved from the peer's active link
peer_json["transport_type"] = json!(handle.transport_type().name);
```

```rust
// queries.rs:568-593 and 1362-1400
"link_id": link.link_id().as_u64(),
"transport_id": link.transport_id().as_u32(),
"state": format!("{}", link.state()),
// ...
"type": handle.transport_type().name,
"state": format!("{}", handle.state()),
"mtu": handle.mtu(),
t_json["stats"] = handle.transport_stats();
```

`vendor/fips/src/bin/fipsctl.rs:144-160` documents the reference mapping to `show_peers`, `show_links`, and `show_transports`; the proof runner's bounded Node client must call only those command names, parse their bounded JSON, and join them by IDs.

### `vendor/fips/src/transport/sound/mod.rs` (service, event-driven)

**Analog:** `SoundTransport::connection_state()` at `648-667` and `transport_stats()` at `370-386`

Do not weaken this seam. FIPS normal dialing is allowed only when the Sound transport says its configured address is connected, which in turn requires worker `Up` and bridge-projected readiness. Preserve disarm-before-recovery behavior and expose observed scalar stats through the existing transport snapshot.

```rust
pub fn connection_state(&self, addr: &TransportAddr) -> ConnectionState {
    if addr != &self.configured_peer() {
        ConnectionState::Failed("sound peer is not configured".into())
    } else {
        let runtime = self.runtime.lock().expect("sound runtime");
        if runtime.state == TransportState::Up && runtime.browser_ready {
            ConnectionState::Connected
        } else { ConnectionState::Failed("sound browser is not armed".into()) }
    }
}
```

```rust
json!({
  "worker_up": runtime.state == TransportState::Up,
  "acoustic_ready": runtime.browser_ready,
  "epoch": runtime.epoch,
  "tx_packets": runtime.counters.tx_packets,
  "rx_packets": runtime.counters.rx_packets,
  "rejected": runtime.counters.rejected,
  "overflowed": runtime.counters.overflowed,
})
```

### `apps/modem-ui/src/proof-state.ts` (store/utility, transform)

**Analog:** `apps/modem-ui/src/bridge-state.ts:33-60`

Create a pure strict parser/reducer separate from DOM rendering. It should accept only bridge-projected proof state, clear the latest ping outcome on stale epoch/disarm/heartbeat/peer/link/isolation failure, and require a fresh current snapshot before re-enabling ping.

```ts
if (action.type === 'snapshot') {
  if (action.snapshot.epoch < state.epoch || state.status === 'resetting') return state;
  return { ...action.snapshot, status, stale: status === 'disconnected' };
}
if (action.type === 'reset-start') return { ...state, status: 'resetting', stale: true };
if (action.type === 'reset-ack') {
  if (state.status !== 'resetting' || action.epoch !== state.epoch + 1) return state;
  return { ...state, epoch: action.epoch, /* clear epoch-owned values */ };
}
```

### `apps/modem-ui/src/main.ts` and `apps/modem-ui/src/style.css` (component/controller, request-response/event-driven)

**Analog:** `apps/modem-ui/src/main.ts:356-374`, `746-925`; `apps/modem-ui/src/style.css:1-57`

Add a separate in-flight proof fetch guard and call the proof reducer before rendering. Insert the semantic `FIPS proof status` card after the Bridge/FIPS card, use a `dl` in prescribed field order, and add controls to the existing operator card. Role B receives refresh plus explanatory text only; Role A receives native disabled/busy ping only when `proofState.pingReady` is current.

```ts
bridgeStatusFetch = fetch('/bridge-status', { cache: 'no-store' })
  .then(async (response) => {
    if (!response.ok) throw new Error('Bridge status is unavailable');
    const snapshot = validateBridgeSnapshot(await response.json());
    if (!snapshot) throw new Error('Bridge status was invalid');
    bridgeState = reduceBridgeState(bridgeState, { type: 'snapshot', snapshot });
  })
  .catch((error: unknown) => {
    bridgeState = reduceBridgeState(bridgeState, { type: 'reset-failed', reason });
  })
  .finally(() => { bridgeStatusFetch = undefined; render(); });
```

```ts
const button = element('button', label);
button.type = 'button';
button.disabled = disabled;
button.className = className;
button.addEventListener('click', () => { void action(); });
```

Reuse `.card`, `.operator-card`, `.console-grid`, `dl`, `.measurements`, native button focus, 44px button minimum, 320px breakpoint, and contained `.corpus-card` table overflow. Add no presenter/no-scroll layout, animation, or new component library.

### Tests (test, transform/request-response/fixture)

**Analogs:** `packages/bridge/test/demo-config.test.ts`, `tests/production-runner.test.ts:164-230`, `tests/fips-compose.test.mjs`, `apps/modem-ui/src/bridge-state.test.ts`, and `apps/modem-ui/src/acoustic-status.test.ts`.

Follow the existing injected-dependency test style. Fixture tests must call a fake command runner and label evidence `Fixture`; only the manual paired two-laptop record may become `Open air`. Test exact role B config cardinality and rejection of alternate transport/port/capability mutations, literal ping argument array/timeout, fail-closed snapshot mismatches/staleness, reset/disarm invalidation, and UI role/aria/copy contracts.

`tests/production-runner.test.ts:201-230` is the startup-order and cleanup pattern: assert the listener exists before secret config publication, inject a bridge factory, force failure, and verify cleanup without secret leakage.

## Shared Patterns

### Fail closed at every boundary

**Sources:** `apps/modem-ui/src/acoustic-status.ts:28-39`, `apps/modem-ui/src/bridge-state.ts:33-42`, `packages/bridge/src/demo-config.ts:137-178`

Use exact object keys, scalar ranges/enums, cross-field invariants, immutable projections, and safe reason codes. Unknown/stale/missing state means blocked, never inferred-ready.

### Epoch and ownership invalidation

**Sources:** `apps/modem-ui/src/bridge-state.ts:44-60`; `vendor/fips/src/transport/sound/mod.rs:165-174,648-667`

Each bridge replacement starts disarmed. Reducers reject older snapshots; reset acknowledgement is the only path out of resetting. Clear proof outcome and `pingReady` on disarm, epoch change, heartbeat loss, peer loss, or non-Sound link.

### Bounded subprocesses and runtime authority

**Sources:** `scripts/fips-compose-smoke.mjs:73-120`; `packages/bridge/src/runner.ts:198`; `tests/production-runner.test.ts:201-230`

Use `execFile`/argument arrays, explicit timeout + buffer, no shell interpolation, and structured process results. Live `docker inspect`, bounded control-socket snapshots, and in-namespace system `ping -6` are proof sources; logs remain diagnostics only.

### Local-only topology

**Sources:** `packages/bridge/src/demo-config.ts:137-156`; `scripts/fips-compose-smoke.mjs:26-47`; `compose.fips.yml`

The bridge is loopback-bound, FIPS has no published port and shares the bridge namespace, and runtime inspection rejects broadened privileges/capabilities/publication. Do not add an A↔B browser/HTTP/WebSocket path.

### Native diagnostic UI

**Sources:** `apps/modem-ui/src/main.ts:746-925`; `apps/modem-ui/src/style.css:1-57`

Render bounded state with semantic DOM, `dl`/tables, native buttons, and exactly one proof live region. Preserve the existing dark cards and responsive scrolling page; Phase 5 owns launcher/presenter redesign.

## No Analog Found

| File | Role | Data flow | Reason / planner guidance |
|---|---|---|---|
| None | — | — | Every planned responsibility has a direct local analogue; `proof.ts` and `proof-state.ts` are new names but should copy the existing strict parser/reducer patterns. |

## Metadata

**Analog search scope:** `packages/bridge`, `apps/modem-ui`, `scripts`, `tests`, `compose.fips.yml`, `vendor/fips`  
**Files scanned:** 22 source/config/test files plus FIPS control and Sound seams  
**Pattern extraction date:** 2026-07-24
