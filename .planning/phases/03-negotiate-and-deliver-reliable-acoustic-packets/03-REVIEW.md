---
phase: 03-negotiate-and-deliver-reliable-acoustic-packets
reviewed: 2026-07-24T06:58:25Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - apps/modem-ui/e2e/acoustic-session.spec.ts
  - apps/modem-ui/e2e/fips-packet-bridge.spec.ts
  - apps/modem-ui/src/acoustic-protocol.test.ts
  - apps/modem-ui/src/acoustic-protocol.ts
  - apps/modem-ui/src/acoustic-session-adapter.test.ts
  - apps/modem-ui/src/acoustic-session-adapter.ts
  - apps/modem-ui/src/acoustic-session.test.ts
  - apps/modem-ui/src/acoustic-session.ts
  - apps/modem-ui/src/acoustic-status.test.ts
  - apps/modem-ui/src/acoustic-status.ts
  - apps/modem-ui/src/fips-packet-adapter.test.ts
  - apps/modem-ui/src/fips-packet-adapter.ts
  - apps/modem-ui/src/main.ts
  - apps/modem-ui/src/quiet-client.ts
  - packages/bridge/src/demo-config.ts
  - packages/bridge/src/protocol.ts
  - packages/bridge/src/server.ts
  - packages/bridge/test/demo-config.test.ts
  - packages/bridge/test/fips-packet-bridge.test.ts
  - vendor/fips/src/node/dataplane/peer_actions.rs
  - vendor/fips/src/node/handlers/handshake.rs
  - vendor/fips/src/node/handlers/mmp.rs
  - vendor/fips/src/node/handlers/rekey.rs
  - vendor/fips/src/node/handlers/timeout.rs
  - vendor/fips/src/node/lifecycle/mod.rs
  - vendor/fips/src/node/mod.rs
  - vendor/fips/src/transport/mod.rs
  - vendor/fips/src/transport/sound/mod.rs
findings:
  critical: 4
  warning: 3
  info: 1
  total: 8
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-07-24T06:58:25Z  
**Depth:** standard  
**Files Reviewed:** 28  
**Status:** issues_found

## Summary

The FAS1 codec boundary is generally bounded and the Rust source-side traffic-class propagation is compatible with its callers. However, the browser composition never initiates the final heartbeat, so a real two-laptop session cannot reach `Ready` or arm FIPS. The currently negotiated acoustic settings are also not applied to data framing, and ACKs are not bound to the packet they acknowledge. These are shipping blockers for the advertised reliable FIPS transport.

The focused unit suite was run and passed (53 tests in 6 files), but its session tests manually inject the otherwise missing heartbeat and therefore do not exercise the production startup path.

## Critical Issues

### CR-01: The production handshake deadlocks in `AwaitingHeartbeat`

**File:** `apps/modem-ui/src/acoustic-session.ts:490-510`; `apps/modem-ui/src/main.ts:905-908`

**Issue:** The commit receiver enters `AwaitingHeartbeat` and sends `CommitAck` at line 498; the commit initiator only enters `AwaitingHeartbeat` at line 503. Neither transition emits the first heartbeat. `onHeartbeat()` only replies after one is already received (line 509), and the production startup path only calls `start()` and `refresh()`. Consequently, both laptops remain in `AwaitingHeartbeat`, `snapshot.ready` remains false, and the adapter never sends `ACOUSTIC_READY` to FIPS. The unit tests conceal this by manually calling `b.heartbeat()` (for example, `acoustic-session.test.ts:181`).

**Fix:** Define one authority for the initial heartbeat (for example, B immediately after committing `CommitAck`), then send it from that transition. Add a production-path test that starts both sessions without manually invoking a public `heartbeat()` method and asserts both adapters arm the same epoch.

### CR-02: A ready link has no heartbeat deadline or periodic heartbeat scheduler

**File:** `apps/modem-ui/src/acoustic-session.ts:240-245, 269-274, 505-510`; `apps/modem-ui/src/main.ts:145-165`

**Issue:** `heartbeat()` is a one-shot public method and no timer calls it after readiness. There is also no stored last-received-heartbeat time or timer that invokes `markHeartbeatMissed()` when the peer goes silent. In the production modem, `markHeartbeatMissed()` is reached only after a local Quiet send failure (line 150), not after peer loss. A peer can therefore disappear after arming while the browser and Rust transport continue to report/accept `Ready`, contradicting the fail-closed heartbeat/degraded-recovery contract.

**Fix:** On entering `Ready`, arm generation- and epoch-bound periodic transmit and dead-link timers. Refresh the receive deadline only for a valid current-session heartbeat (and, if intended, other authenticated current-session traffic); on expiry, disarm before transitioning to `Degraded`. Clear both timers in every reset, error, and dispose path. Cover silent-peer expiry and late old-generation timer callbacks.

### CR-03: Negotiated payload settings are committed but never used for packet framing

**File:** `apps/modem-ui/src/acoustic-session.ts:215, 511`; `apps/modem-ui/src/acoustic-protocol.ts:291-312`; `apps/modem-ui/src/main.ts:161-164`

**Issue:** The handshake commits a directional `payloadBytes` setting, including the real UI's 96-byte candidate, but `enqueuePacket()` calls `fragmentPacket()` without it. `fragmentPacket()` always slices at `FAS1_MAX_BODY_BYTES` (217 bytes). Thus a link that selected 96 bytes as the safe calibration setting immediately transmits 217-byte FAS1 bodies, invalidating the calibration result and creating a different on-air frame size from the one that was committed.

**Fix:** Make the active direction's committed payload bound an explicit argument to fragmentation and validate it against the committed settings on both send and receive. Use it for the number and geometry of DATA fragments, and add a test selecting 96 bytes that proves no emitted DATA body exceeds 96 bytes and that a 1357-byte packet still reassembles.

### CR-04: ACK bitmaps are not bound to a packet, allowing delayed ACKs to acknowledge unrelated data

**File:** `apps/modem-ui/src/acoustic-session.ts:323-359`

**Issue:** `#lastAck` records a `packetId`, but `sendAck()` discards it and emits a bodyless ACK with `packetId: 0` (line 348). `onAck()` receives only the bitmap and applies it to whichever `#active` packet happens to be outstanding (lines 351-358). A delayed ACK from a previous turn can therefore mark the same-shaped next packet fully delivered even when the receiver never saw it. The cached ACK also is not cleared when a new inbound packet/turn begins. This breaks delivery confirmation and undermines the claimed exactly-once complete-packet delivery.

**Fix:** Extend the ACK wire contract to carry and validate the acknowledged packet ID (and preferably the relevant burst/attempt generation), reset cached ACK state on a new inbound packet/turn, and ignore ACKs that do not match the active packet. Add deterministic delayed-ACK tests for consecutive one-fragment packets and for a stale complete bitmap against a multi-fragment packet.

## Warnings

### WR-01: The real UI reports a synthetic perfect calibration instead of a measured sweep

**File:** `apps/modem-ui/src/main.ts:161-164`

**Issue:** The production session supplies exactly one candidate and a `measureProbe` callback that always reports byte-perfect receipt, zero latency, no clipping, and confidence 1. It neither uses the configured candidate set in `demo-config.ts` nor derives values from the Quiet/audio path. The UI can therefore display a negotiated/safe connection despite no candidate comparison or clipping/signal evidence.

**Fix:** Feed the configured candidates into the session; collect receiver-side decode, timing, queue/discontinuity, and clipping data per literal probe; and reject candidates without measured evidence. Keep unmeasured fields visibly unknown rather than asserting perfect values.

### WR-02: FAS1 accepts non-canonical fragment geometry

**File:** `apps/modem-ui/src/acoustic-protocol.ts:132-140, 316-337`

**Issue:** DATA validation limits each body and the total packet length, but does not require a fragment count/body layout consistent with the packet length. For example, two one-byte DATA units declaring `packetLength: 2` and `fragmentCount: 2` pass `reassemblePacket()`, although the canonical maximum-body geometry requires one fragment. This leaves a parser ambiguity and lets ambient input consume additional turns for a packet that should have been rejected before session mutation.

**Fix:** Define canonical DATA geometry for the active negotiated payload size: require the exact expected fragment count, require every nonfinal body to have that size, and require the final body to have the exact remainder. Validate before adding the unit to the inbound assembly. Test undersized/multifragment encodings of short packets.

### WR-03: The bridge accepts an unauthenticated browser assertion as acoustic readiness

**File:** `packages/bridge/src/server.ts:1044-1057`; `vendor/fips/src/transport/sound/mod.rs:461-474`

**Issue:** Any connected browser owner can send a syntactically valid `ACOUSTIC_READY` frame and the bridge immediately forwards `BROWSER_ARM`; the Rust transport then sets `browser_ready` without a commit digest, session ID, or liveness proof. This is a direct bypass of the claimed "committed acoustic session plus heartbeat" projection. Loopback binding narrows the threat model but does not make a local process or injected browser script a reliable session authority.

**Fix:** Bind readiness to a bridge-owned, one-use epoch/session proof generated when the real session reaches the commit-plus-heartbeat state, and invalidate it on reset/reconnect/deadline. At minimum, keep this authority in the browser composition code and reject bare public readiness frames from arbitrary WebSocket clients.

## Info

### IN-01: The test suite masks the readiness failure and omits stale-ACK/active-setting negative paths

**File:** `apps/modem-ui/src/acoustic-session.test.ts:171-184, 231-278`; `apps/modem-ui/e2e/acoustic-session.spec.ts:20-35`

**Issue:** Every session transfer test manually injects B's first heartbeat, while the production startup path does not. The E2E test runs an in-page fixture rather than two production session instances and therefore cannot detect startup deadlock, settings-vs-frame-size mismatch, or a delayed ACK falsely completing a subsequent packet.

**Fix:** Add a production-composition test with two linked modem stubs, no test-only heartbeat call, scheduled silence, candidate-dependent payload sizing, and a held/reordered ACK. Assert that FIPS arms only after the actual handshake and disarms on timeout.

---

_Reviewed: 2026-07-24T06:58:25Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: standard_
