---
phase: 02-configure-and-establish-the-codec-neutral-fips-bridge
reviewed: 2026-07-24T02:37:30Z
depth: standard
files_reviewed: 32
files_reviewed_list:
  - .dockerignore
  - Dockerfile.bridge
  - apps/modem-ui/e2e/bridge-status.spec.ts
  - apps/modem-ui/e2e/fips-packet-bridge.spec.ts
  - apps/modem-ui/src/bridge-state.test.ts
  - apps/modem-ui/src/bridge-state.ts
  - apps/modem-ui/src/fips-packet-adapter.test.ts
  - apps/modem-ui/src/fips-packet-adapter.ts
  - apps/modem-ui/src/main.ts
  - apps/modem-ui/src/style.css
  - compose.fips.yml
  - package.json
  - packages/bridge/src/demo-config.ts
  - packages/bridge/src/protocol.ts
  - packages/bridge/src/resource-owner.ts
  - packages/bridge/src/runner.ts
  - packages/bridge/src/server.ts
  - packages/bridge/test/demo-config.test.ts
  - packages/bridge/test/fips-packet-bridge.test.ts
  - packages/bridge/test/resource-owner.test.ts
  - scripts/check-compose.mjs
  - scripts/fips-compose-smoke.mjs
  - tests/fips-compose.test.mjs
  - tests/production-runner.test.ts
  - vendor/fips/.dockerignore
  - vendor/fips/Cargo.toml
  - vendor/fips/Dockerfile
  - vendor/fips/src/config/mod.rs
  - vendor/fips/src/config/transport.rs
  - vendor/fips/src/node/mod.rs
  - vendor/fips/src/transport/mod.rs
  - vendor/fips/src/transport/sound/mod.rs
findings:
  critical: 6
  warning: 2
  info: 0
  total: 8
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-07-24T02:37:30Z
**Depth:** standard
**Files Reviewed:** 32
**Status:** issues_found

## Summary

The local packet-envelope unit and browser tests pass, as do the focused Rust sound tests, but they use direct in-process endpoints and do not exercise the submitted Docker topology. The actual Compose render leaves FIPS asleep; independently, its proxy and WebSocket-origin policies reject the browser and Rust client paths. As written, the system cannot create a real FIPS-over-sound link.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Compose never starts FIPS or supplies a role-specific sound configuration

**File:** `compose.fips.yml:33`

**Issue:** The `fips` service executes `sleep infinity`. It never invokes `/usr/local/bin/fips`, receives no config containing a `transports.sound` instance, peer identity, or TUN configuration, and therefore never connects to the bridge. The runtime smoke only confirms that the sleeping container and HTTP page exist, so it reports success for a topology with no FIPS transport.

**Fix:** Generate/choose the resolved A/B FIPS config at launch, mount or pass it to the FIPS service, and replace the sleep command with the FIPS daemon invocation. Make the runtime smoke assert the process is FIPS, its `sound` transport is Up, and its bridge endpoint is connected before passing.

### CR-02: The `socat` forwarding layout makes every browser WebSocket upgrade fail origin validation

**File:** `compose.fips.yml:13-14`

**Issue:** The page is exposed at port 4310 but the runner actually listens on 4311 behind `socat`. A browser therefore sends `Origin: http://127.0.0.1:4310` to `/bridge`; `server.ts` compares that origin port with its local listener port (4311) and returns 403. `socat` forwards HTTP headers unchanged, so an operator can load the page but cannot arm it or use the local bridge.

**Fix:** Serve the runner on the same container port that is published to the browser (4310), or give the bridge an explicit trusted external-origin setting and validate it strictly. Add a Compose runtime test that loads the published page and successfully completes the browser WebSocket/audio-settings handshake.

### CR-03: The Rust WebSocket client is rejected because it does not send the required Origin header

**Files:** `vendor/fips/src/transport/sound/mod.rs:120-122`, `packages/bridge/src/server.ts:1105-1108`

**Issue:** `tokio_tungstenite::connect_async(&self.config.bridge_url)` creates a non-browser WebSocket request without an `Origin` header. The bridge rejects every upgrade with a missing or non-matching origin. The Rust test uses a permissive `accept_async` fixture instead of the bridge server, so it cannot detect this production failure.

**Fix:** Construct a WebSocket client request with the exact, validated loopback Origin expected by the bridge (or authenticate/separate the internal FIPS endpoint from browser-origin checks). Add an integration test using the actual bridge server and the Rust SoundTransport.

### CR-04: Browser arming is never delivered to SoundTransport, so all FIPS sends remain fail-closed

**Files:** `packages/bridge/src/server.ts:1017-1022`, `vendor/fips/src/transport/sound/mod.rs:102-112`, `vendor/fips/src/transport/sound/mod.rs:213-218`

**Issue:** The browser reports `AUDIO_SETTINGS` to the TypeScript bridge and arms only its own adapter. There is no protocol message or call path from that accepted event to `SoundTransport::arm_browser`; repository-wide usage shows that method is called only by unit tests. Consequently `runtime.browser_ready` remains false in the real daemon and every `send_async` returns `sound browser is not armed`.

**Fix:** Define a bridge-to-FIPS local control frame for the validated current-epoch browser-ready transition, process it in SoundTransport, and clear it on RESET/disconnect. Cover browser arm → Rust `browser_ready` → successful outbound FIPS packet in an integration test.

### CR-05: Sound is declared connectionless but reports the configured peer as `None`, preventing normal FIPS traffic

**File:** `vendor/fips/src/transport/sound/mod.rs:389-396`

**Issue:** `TransportHandle` treats Sound as a static connectionless transport, but `connection_state(configured_peer)` returns `ConnectionState::None` rather than `Connected`. FIPS's encrypted send path only proceeds when the transport reports `Connected`; on `None` it calls the no-op `connect()` and returns a send failure. This blocks heartbeats and tunneled packets even after a handshake could otherwise complete.

**Fix:** Report `Connected` for the configured peer once the local worker is Up and its current browser epoch is armed (and a clear failed/unavailable state otherwise). Add a Node-level test that drives an established peer over Sound and verifies an encrypted outbound packet reaches the bridge.

### CR-06: SoundConfig accepts non-loopback WebSocket hosts through prefix matching

**File:** `vendor/fips/src/config/transport.rs:923-929`

**Issue:** The local-only policy is implemented with string prefixes. Values such as `ws://localhost.attacker.example/bridge/fips` and `ws://127.attacker.example/bridge/fips` pass both checks, then cause the FIPS container to connect to a remote host. That violates the bridge isolation boundary and can leak opaque FIPS traffic to an attacker-controlled endpoint.

**Fix:** Parse with `url::Url` (or an equivalent strict URL parser) and require `ws`, no credentials/query/fragment, exact host `127.0.0.1`, `localhost`, or `::1`, and exact path `/bridge/fips`; reject all other hostnames. Add negative tests for prefix-confusion hosts and encoded/path variants.

## Warnings

### WR-01: The configured byte bound is not enforced by SoundTransport's outbound queue

**Files:** `vendor/fips/src/config/transport.rs:895-898`, `vendor/fips/src/transport/sound/mod.rs:124`, `vendor/fips/src/transport/sound/mod.rs:233-238`

**Issue:** `queue_bytes` is validated and advertised as a SoundConfig bound, but the worker uses only `mpsc::channel(queue_items)`. With valid configuration, queued bytes can exceed `queue_bytes` substantially (for example, 256 maximum-MTU packets) and the byte limit is never consulted.

**Fix:** Track reserved outbound bytes atomically or use a byte-budget semaphore, releasing the budget only after a frame leaves/drops from the worker. Test both item and byte overflow paths.

### WR-02: The UI labels fabricated local estimates as bridge/transport status

**File:** `apps/modem-ui/src/main.ts:157-165`

**Issue:** `syncBridgeState()` synthesizes `queueHealth`, queue sizes, MTU, and `soundTransport: 'waiting'` from browser-local constants; it never reads the bridge/FIPS state. The displayed complete-packet counters are likewise browser event counters, not bridge acceptance or Rust transport counters. This is misleading during diagnosis because the UI cannot distinguish a live FIPS worker from the submitted `sleep infinity` container.

**Fix:** Expose a small, allowlisted bridge status endpoint/message populated from `BridgeServer.state()` and FIPS sound stats, then render only those authoritative values. Keep the existing client-only counters separately named if retained.

---

_Reviewed: 2026-07-24T02:37:30Z_
_Reviewer: gsd-code-reviewer_
_Depth: standard_
