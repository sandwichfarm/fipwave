# Phase 3: Negotiate and Deliver Reliable Acoustic Packets — Pattern Map

**Mapped:** 2026-07-24  
**Files classified:** 20  
**Analogs found:** 17 / 20

This map is intentionally constrained to the browser-resident acoustic link
below `FipsPacketAdapter`, current-epoch bridge controls, and the codec-neutral
Rust complete-packet transport. It does not authorize a second laptop-to-laptop
network path or inspection of opaque FIPS payload bytes.

## File Classification

| New / modified file | Role | Data flow | Closest analogue | Match |
|---|---|---|---|---|
| `apps/modem-ui/src/acoustic-protocol.ts` | utility/model | binary transform | `quiet-client.ts` | role-match |
| `apps/modem-ui/src/acoustic-protocol.test.ts` | test | adversarial transform | `quiet-client.test.ts` | exact |
| `apps/modem-ui/src/acoustic-session.ts` | service/state machine | event-driven | `cyrinx-case-watchdog.ts`, `qualification-session.ts` | role-match |
| `apps/modem-ui/src/acoustic-session.test.ts` | test | fake-clock event-driven | `cyrinx-case-watchdog.test.ts` | role-match |
| `apps/modem-ui/src/acoustic-session-adapter.ts` | adapter | request/response + event-driven | `fips-packet-adapter.ts` | role-match |
| `apps/modem-ui/src/acoustic-session-adapter.test.ts` | integration test | event-driven | `fips-packet-adapter.test.ts` | exact |
| `apps/modem-ui/src/acoustic-status.ts` (if needed) | reducer/model | status transform | `bridge-state.ts` | exact |
| `apps/modem-ui/src/quiet-client.ts` | modem service | event-driven audio | itself / `QuietReceiverEvidence` | exact |
| `apps/modem-ui/src/fips-packet-adapter.ts` | boundary adapter | opaque packet request/response | itself | exact |
| `apps/modem-ui/src/main.ts` | composition root | browser lifecycle | itself | exact |
| `apps/modem-ui/src/bridge-state.ts` | reducer/model | status transform | itself | exact |
| `apps/modem-ui/e2e/acoustic-session.spec.ts` | browser E2E test | built UI + deterministic seam | `e2e/fips-packet-bridge.spec.ts` | role-match |
| `packages/bridge/src/demo-config.ts` | config/validation | transform | itself | exact |
| `packages/bridge/src/protocol.ts` | protocol utility | binary transform | itself | exact |
| `packages/bridge/src/server.ts` | local bridge service | WebSocket/event-driven | itself | exact |
| `packages/bridge/test/fips-packet-bridge.test.ts` | bridge integration test | WebSocket request/response | itself | exact |
| `packages/bridge/test/demo-config.test.ts` | config test | transform | itself | exact |
| `vendor/fips/src/transport/sound/mod.rs` | Rust transport | bounded async queue | itself | exact |
| `vendor/fips/src/transport/mod.rs` + narrow caller(s) | Rust dispatch/priority seam | async request/response | `TransportHandle::send` | partial — Wave 0 trace |
| Rust sound tests in `sound/mod.rs` | Rust async test | queue/readiness | existing sound tests | exact |

## Pattern Assignments

### `apps/modem-ui/src/acoustic-protocol.ts` and `acoustic-protocol.test.ts`

**Copy from:** [`apps/modem-ui/src/quiet-client.ts`](../../../apps/modem-ui/src/quiet-client.ts#L128), [`apps/modem-ui/src/quiet-client.test.ts`](../../../apps/modem-ui/src/quiet-client.test.ts#L18).

Use one fixed little-endian binary encoder/decoder, with validation before
allocation or state mutation. The current fragment envelope demonstrates the
appropriate shape: fixed constants, a `DataView`, exact magic/length checks,
and copied payloads rather than borrowed mutable data.

```ts
// quiet-client.ts:128-154
const fragmentCount = Math.max(1, Math.ceil(payload.byteLength / QUIET_DATA_BYTES));
if (fragment.payload.byteLength > QUIET_DATA_BYTES) {
  throw new Error('Quiet fragment exceeds fixed envelope capacity');
}
const view = new DataView(output.buffer);
view.setUint16(14, fragment.declaredLength, true);
// decode first checks minimum size, magic, total frame cap, and index bounds.
```

Apply this to FAS1: exact `FAS1`, version 1, known type/flags, declared body
length equal to actual remaining bytes, 36-byte header, body at most 217 bytes,
fragment count 1–16 and declared complete packet length 1–1357. Keep CRC and
canonical settings serialization pure and synchronous if possible; the async
SHA-256 digest belongs behind one explicit `Promise` API. Tests should mutate
one header field at a time and assert no caller-visible session transition.

**Caution:** do not extend `FQT1`; it is corpus-indexed qualification evidence,
not a production packet/session protocol. Quiet's fixed runtime ceiling is 253
bytes (`quiet-client.ts:3-8`), so FAS1 must use 36 + 217, not the old 32 + 221.

### `apps/modem-ui/src/acoustic-session.ts` and `acoustic-session.test.ts`

**Copy from:** [`cyrinx-case-watchdog.ts`](../../../apps/modem-ui/src/cyrinx-case-watchdog.ts#L46), [`qualification-session.ts`](../../../apps/modem-ui/src/qualification-session.ts#L16), and their unit tests.

The established browser state-machine convention is a small class with private
fields, injected time/timer effects, named invalid-state errors, idempotent
identity keys, and snapshot copies. It never lets a late callback advance a
state transition.

```ts
// cyrinx-case-watchdog.ts:56-76
constructor(private readonly onFailure: (value: CyrinxBrowserCase) => void,
  private readonly timeoutMs = CYRINX_BROWSER_CASE_TIMEOUT_MS,
  private readonly timers: TimerApi = defaultTimers) { ... }

if (sameCyrinxBrowserCase(this.#active, value)) return;
this.cancel();
this.#active = value;
this.#timer = this.timers.setTimeout(() => { ... this.emitOnce(active); }, this.timeoutMs);
```

Create explicit injected interfaces such as `AcousticClock { nowMs(): number }`,
`AcousticTimers`, and `AcousticModem { send(unit): Promise<void>; onUnit(...) }`.
The fake modem must only carry FAS1 units between two local session instances;
it must not use WebSocket or pretend to be an inter-laptop transport. Make
`reset(epoch)` one atomic invalidation: cancel timers, clear pending turns,
reassembly, dedupe history, committed settings and readiness before exposing a
new snapshot. Use stable reason codes (`acoustic_*`) and bounded scalar
counters, not raw unit bytes.

**Required scheduler ordering:** control/ACK first, then explicit FIPS traffic
class, then ordinary opaque data; one owner, up to four DATA units, TURN_END,
guard, ACK bitmap, bounded retry/backoff. Reassembly must allocate only after
`decodeFas1` has succeeded and must copy fragments. Keep a single inbound
reassembly/direction, 1357-byte, 16-fragment, expiry, queue and delivered-ID
bounds as configuration—not scattered literals.

**Caution:** `onFinish` is a local turn boundary only. Do not advance delivery,
the peer turn, or FIPS readiness until a valid remote ACK / commit ACK / current
heartbeat respectively. Tests should drive time manually and prove late timers,
duplicate DATA and lost ACK never produce a second adapter delivery.

### `apps/modem-ui/src/acoustic-session-adapter.ts`, `fips-packet-adapter.ts`, and tests

**Copy from:** [`fips-packet-adapter.ts`](../../../apps/modem-ui/src/fips-packet-adapter.ts#L19) and [`fips-packet-adapter.test.ts`](../../../apps/modem-ui/src/fips-packet-adapter.test.ts#L5).

The packet boundary is already correctly tiny and opaque:

```ts
// fips-packet-adapter.ts:21-41
let lifecycle: { epoch: number; generation: number } | undefined;
if (!lifecycle) return { accepted: false, reason: 'not-armed' };
if (lifecycle.epoch !== epoch || lifecycle.generation !== generation) {
  return { accepted: false, reason: 'stale' };
}
options.onPacket(packet.slice());
```

Do not give `FipsPacketAdapter` a codec, fragment, ACK, profile, or parser.
Instead, the new adapter owns the session readiness predicate and calls
`arm(epoch,generation)` only after matching settings digest acknowledgement and
a current session heartbeat. It calls `invalidate()` before reset/disconnect,
degraded state, timeout exhaustion, or terminal error. Every adapter handoff
copies a complete `Uint8Array`; no partial reassembly can cross this boundary.

**Caution:** existing `main.ts` arms the adapter immediately after browser audio
preflight (`main.ts:716-722`). Replace that lifecycle with session-derived arm,
but retain audio preflight as an honest local fact. Tests must cover both
directions before/after commit+heartbeat and stale generation/reset rejection.

### `apps/modem-ui/src/quiet-client.ts`

**Copy from:** its guarded single corpus-send lifecycle at lines 260–365 and
the receive generation checks around lines 312–323.

Expose a deliberately narrow unit seam: arm by epoch/role, receive one raw
codec frame, and transmit one FAS1 unit with a Promise resolving after local
finish plus guard. Preserve its generation test in every async callback and
its reset order: increment generation, cancel/destroy, clear state, close
contexts, then drop epoch/role. Keep `QUIET_PROFILE` fixed to
`audible-7k-channel-0`; gain is a bounded output-only candidate and must not
be reported as carrier frequency.

```ts
// quiet-client.ts:275-286
const playbackGain = options.playbackGain ?? 1;
if (!Number.isFinite(playbackGain) || playbackGain <= 0 || playbackGain > 4) {
  throw new Error('Quiet playback gain must be greater than 0 and no more than 4');
}
```

Phase 3's config should cap negotiated demo gain at 2.0 even though this lower
level remains defensively broader. Keep the existing `Fixture` / `Loopback` /
`Open air` union and never derive an `Open air` claim from a fake modem or the
same-device receiver.

### `apps/modem-ui/src/acoustic-status.ts` / `bridge-state.ts` / `main.ts`

**Copy from:** [`bridge-state.ts`](../../../apps/modem-ui/src/bridge-state.ts#L32).

Public status is exact-schema, scalar, validated and fail-closed:

```ts
if (Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !fields.includes(key))) return undefined;
if (!nonNegative(value.epoch) || !nonNegative(value.txPackets)) return undefined;
return Object.freeze({ ... });
```

Add a separate acoustic snapshot/reducer rather than overloading bridge status
with raw protocol data. Project only phase, local audio readiness, committed
settings/profile/digest acknowledgement, heartbeat freshness, bounded counters
and a safe error code. `main.ts` remains lifecycle wiring/rendering; protocol
rules remain in the pure session. Snapshot render must retain reset authority:
a status response cannot leave `resetting` before the bridge RESET ack
(`bridge-state.ts:46-57`).

### `apps/modem-ui/e2e/acoustic-session.spec.ts`

**Copy from:** `apps/modem-ui/e2e/fips-packet-bridge.spec.ts` and the existing
production/browser split. Use the built browser and a deterministic injected
modem seam. Assert visible safe session/readiness state, and that it remains
unarmed/degraded when the seam withholds COMMIT_ACK/heartbeat. Never make the
fixture bridge act as an acoustic path between role A and B, and classify its
evidence as `Fixture`.

### `packages/bridge/src/demo-config.ts` and test

**Copy from:** [`demo-config.ts`](../../../packages/bridge/src/demo-config.ts#L84).

All new candidates/bounds belong in `DEFAULTS`, typed readonly interfaces, and
the exact-schema override parser. Preserve the hard-coded A/B identity mapping,
deep freeze, public allowlist and narrow `fail('snake_case')` reason convention.

```ts
const retries = { ...DEFAULTS.retries, ...patch };
if (retries.minDelayMs > retries.maxDelayMs) fail('retry_bounds_invalid');
if (heartbeat.deadLinkTimeoutMs <= heartbeat.intervalMs) fail('heartbeat_bounds_invalid');
```

Add a typed acoustic protocol section for maximum frame body, packet size,
window, attempts, queue/reassembly/delivery caps, calibration candidates and
gain/guard bounds. Accept exact supported profile IDs only; reject arbitrary
frequency, sample-rate and playback-speed fields by exact-key validation.

### `packages/bridge/src/protocol.ts`, `server.ts`, and bridge test

**Copy from:** [`protocol.ts`](../../../packages/bridge/src/protocol.ts#L87),
[`server.ts`](../../../packages/bridge/src/server.ts#L468), and
[`fips-packet-bridge.test.ts`](../../../packages/bridge/test/fips-packet-bridge.test.ts#L96).

FWAV validates framing before dispatch, then the server verifies epoch and
monotonic sequence before any queue mutation. Preserve that ordering and use
new zero-payload current-epoch bridge-only control types such as
`ACOUSTIC_READY` / `ACOUSTIC_DISARM` (names chosen by implementation) to
project *committed session* readiness to FIPS. `AUDIO_SETTINGS` stays a local
audio preflight record and must no longer call `notifyFipsBrowserState(true)`.

```ts
// server.ts:468-476
const notifyFipsBrowserState = (armed: boolean): void => {
  if (!fipsOwner || fipsOwner.readyState !== fipsOwner.OPEN) return;
  fipsOwner.send(encodeFrame({
    type: armed ? MessageType.BROWSER_ARM : MessageType.BROWSER_DISARM,
    epoch: state.epoch, sequence: 0n, payload: Buffer.alloc(0),
  }));
};
```

Keep bridge packet queues bounded and drop failed delivery instead of replaying
it (`server.ts:408-465`). Reset, browser close, degraded, terminal session
error and stale epoch must disarm first and clear queued acoustic-session
state. Tests should open both local endpoints, assert AUDIO_SETTINGS produces
no FIPS arm, only current-epoch acoustic-ready does, and reset/disconnect/
degraded produce exactly one disarm.

### `vendor/fips/src/transport/sound/mod.rs` and Rust tests

**Copy from:** [`sound/mod.rs`](../../../vendor/fips/src/transport/sound/mod.rs#L271) and its existing tests around lines 592–720.

Rust's established pattern is one runtime lock transaction for validation,
capacity reservation and rollback; error strings are static, secret-safe codes.

```rust
if !runtime.browser_ready {
    runtime.counters.rejected += 1;
    runtime.last_error = Some("sound_browser_not_armed");
    return Err(TransportError::SendFailed("sound browser is not armed".into()));
}
```

Retain codec neutrality: complete opaque FIPS packets only, no fragments,
profile IDs, calibration state or acoustic parser. Change the meaning of the
existing browser-ready gate only through the newly projected current-epoch
acoustic readiness. Existing inbound controls already validate zero payload,
zero sequence, Up state and exact epoch before mutating readiness
(`sound/mod.rs:450-462`); mirror that discipline. Reset clears readiness,
sequence watermark, queues/counters as it does at lines 435–448.

### Mandatory Wave 0: FIPS traffic-class source trace

**Closest analogue:** `TransportHandle::send` at
[`vendor/fips/src/transport/mod.rs:729`](../../../vendor/fips/src/transport/mod.rs#L729), with concrete callers in
`node/lifecycle/mod.rs:714`, `node/handlers/handshake.rs:225/402/471`,
`node/handlers/timeout.rs:339`, and data-plane caller
`node/dataplane/peer_actions.rs:185`.

Today the shared dispatch signature is exactly:

```rust
pub async fn send(&self, addr: &TransportAddr, data: &[u8]) -> Result<usize, TransportError>
```

and `SoundTransport::send_async` receives only `&[u8]`. Therefore Phase 3 must
first identify the smallest source-level non-payload metadata seam that
distinguishes handshake/rekey/heartbeat/control from ordinary data. It must
propagate through `TransportHandle`, FWAV's local `FIPS_PACKET` metadata, the
bridge packet queue, and browser adapter *without parsing bytes*. The preferred
pattern is a narrow typed `TrafficClass` parameter/default at dispatch and
explicit priority queues; do not special-case based on byte prefixes. This is
the only file set with no complete current analogue, so make it a dedicated
Wave 0 plan/test before claiming LINK-08.

## Shared Patterns

### Epoch and generation authority

Apply to session, adapter, browser glue, bridge controls and Rust transport.
FWAV's `EpochTracker` (`protocol.ts:60-78`), browser reducer reset gate
(`bridge-state.ts:46-57`) and Quiet generation invalidation provide the shared
rule: validate current epoch/generation before callback effects; RESET is the
only authority to establish the next epoch; late work is ignored, not repaired.

### Bounded resource accounting

Use fixed caps plus counters and safe terminal codes. The bridge expires first,
then checks item/byte caps before mutation (`server.ts:422-435`); Rust reserves
bytes and rolls back on `try_send` failure (`sound/mod.rs:311-344`). Session
queues/reassembly/delivered history must use the same order and never continue
retrying indefinitely.

### Exact schema and secret-safe evidence

Status/config accepts only known keys and safe scalar facts. Keep raw packets,
nonces, identities, packet digests beyond their safe short projection, and
browser authority fields out of JSON. Digital fake modem = `Fixture`; local
speaker/mic = `Loopback`; only two physical laptops can be `Open air`.

## No Analog Found

| File / seam | Reason | Planner action |
|---|---|---|
| Explicit FIPS `TrafficClass` producer-to-browser seam | FIPS dispatch currently passes opaque bytes only. | Wave 0 source trace and a focused Rust/TS integration test before LINK-08 implementation. |
| General FAS1 protocol | FQT1 is corpus-specific and cannot be extended safely. | New pure module, using fixed geometry/validate-before-mutate patterns above. |
| Bidirectional acoustic ARQ simulator | No current modem/clock abstraction. | New injected fake modem/clock seam; do not use sleeps or loopback evidence as correctness proof. |

## Metadata

**Analog search scope:** `apps/modem-ui/src`, `apps/modem-ui/e2e`,
`packages/bridge/src`, `packages/bridge/test`, `vendor/fips/src/transport`, and
FIPS transport callers.  
**Pattern extraction date:** 2026-07-24
