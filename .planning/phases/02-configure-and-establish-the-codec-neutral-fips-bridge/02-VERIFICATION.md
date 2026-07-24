---
phase: 02-configure-and-establish-the-codec-neutral-fips-bridge
verified: 2026-07-24T04:59:20Z
status: passed
score: 5/5 roadmap must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 5/5
  gaps_closed:
    - "MVP goal-format escalation"
  gaps_remaining: []
  regressions: []
---

# Phase 2: Configure and Establish the Codec-Neutral FIPS Bridge — Verification Report

**Phase Goal:** As a demo operator, I want to resolve each role from one configuration authority and connect FIPS to an armed local browser modem through a bounded codec-neutral sound bridge, so that complete opaque packets can safely cross the local modem boundary.
**Verified:** 2026-07-24T04:59:20Z
**Status:** passed
**Re-verification:** Yes — MVP metadata gate resolved; technical implementation unchanged

## User Flow Coverage

User story: _As a demo operator, I want to resolve each role from one configuration authority and connect FIPS to an armed local browser modem through a bounded codec-neutral sound bridge, so that complete opaque packets can safely cross the local modem boundary._

| Step | Expected | Evidence in codebase | Status |
| --- | --- | --- | --- |
| Resolve a role | The operator selects only `a` or `b`; the local run receives complementary identity, peer, ports, capabilities, audio/calibration defaults, retry, and heartbeat values without a browser-visible nsec. | `resolveDemoConfig` rejects every other selector, validates overrides, freezes the result; runner tests prove it consumes the safe projection. | ✓ VERIFIED |
| Start local FIPS/bridge | The configured FIPS sound worker is created through its normal lifecycle, with a local-only bridge endpoint and MTU 1357 or greater. | `Node::create_transports` constructs `TransportHandle::Sound`; strict `SoundConfig` allows only the configured loopback endpoint and enforces minimum MTU. | ✓ VERIFIED |
| Arm modem | The operator opens the local page and chooses **Arm modem**; a browser modem becomes ready only for the current epoch, without claiming a remote acoustic peer. | `main.ts` arms `FipsPacketAdapter` only after audio/bridge acknowledgement; current Playwright test drives the built page and asserts local-only transport copy. | ✓ VERIFIED |
| Cross local modem boundary | Armed browser and FIPS exchange complete opaque packet bytes through binary FWAV frames; invalid, stale, unarmed, or oversized inputs fail closed. | Current Playwright production-page test asserts byte identity both ways; bridge and Rust SoundTransport tests exercise malformed, stale, unarmed, bounded, and reconnect paths. | ✓ VERIFIED |
| Recover | **Reset and reconnect** creates a new epoch, clears volatile local state, and makes old frames/callbacks harmless. | Bridge RESET, browser reducer/generation gates, and Rust reconnect tests pass; browser test proves delayed old-epoch packet and retiring socket acknowledgement are ignored. | ✓ VERIFIED |
| Outcome | Complete opaque packets can safely cross the local modem boundary. | All flow steps above are wired to the live local WebSocket bridge; current `npm run check` and focused Rust SoundTransport tests pass. | ✓ VERIFIED |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | One validated configuration authority resolves both roles, identities, peers, ports, codec/audio/calibration defaults, retries, and heartbeat thresholds without exposing private nsecs publicly. | ✓ VERIFIED | `resolveDemoConfig` accepts only literal `a`/`b`, deep-freezes complementary configuration, validates exact overrides and bounds; `toPublicDemoConfig` is an allowlist without `nsec`. The current 207-test unit run includes resolver/runner redaction and ownership coverage. |
| 2 | Pinned FIPS has a configurable first-class sound transport that participates in the normal lifecycle and exchanges complete opaque packets with the local bridge. | ✓ VERIFIED | `TransportsConfig.sound` constructs `TransportHandle::Sound` in `Node::create_transports`; every lifecycle, send, ID, state, policy, congestion, and statistics dispatch arm is explicit. `cargo test --locked transport::sound::tests` passed 11/11, including opaque 1357-byte WebSocket round trip and reconnect/re-arm behavior. |
| 3 | Sound link MTU is at least 1357, yielding FIPS's required effective IPv6 MTU. | ✓ VERIFIED | `MIN_SOUND_MTU = 1357`; strict `SoundConfig::validate` rejects 1356; `SoundTransport::mtu/link_mtu` return the configured value; node pre-operational MTU selection consumes sound config. The focused Rust suite and current Compose source/rendered tests pass. The required runtime smoke was also run on current HEAD by the phase orchestrator; source changes since that run are documentation-only. |
| 4 | Browser, bridge, and FIPS exchange complete packet frames as binary FWAV data; invalid data is rejected before delivery/accounting and all queues/state are bounded and observable. | ✓ VERIFIED | FWAV `FIPS_PACKET` rejects noncanonical PCM metadata; bridge validates role/type/epoch/sequence before queue/counter mutation and has per-direction item/byte/age limits. Current `npm run check` passed bridge tests, 207 unit tests, and the real Playwright armed-browser/FIPS byte-identity test. |
| 5 | A single recovery path advances epoch, clears volatile modem/bridge/queue state, rejects stale callbacks/frames, reconnects safely, and stays codec-neutral. | ✓ VERIFIED | Backend RESET clears queues and counters; browser reset invalidates packet generation and only accepts the active socket's acknowledgement; Rust reconnect drops stale queue state and requires re-arm. Current browser and Rust suites exercised delayed old-epoch rejection, retiring-socket acknowledgement isolation, bounded reconnect, and queue-accounting interleaving. |

**Score:** 5/5 roadmap truths verified (0 present-but-behavior-unverified).

### Required Artifacts

| Artifact group | Expected | Status | Details |
| --- | --- | --- |
| `packages/bridge/src/demo-config.ts`, `resource-owner.ts`, `runner.ts` | Validated single authority, secret-safe projection, owned lifecycle | ✓ VERIFIED | Substantive, imported by the runner, and exercised by resolver/resource/production-runner tests. |
| `packages/bridge/src/protocol.ts`, `server.ts` | Binary codec-neutral contract, role-separated bounded relay/reset state | ✓ VERIFIED | `decodeFrame` precedes dispatch; server owns queues, counters, endpoint state, reset, and safe status. |
| `apps/modem-ui/src/fips-packet-adapter.ts`, `bridge-state.ts`, `main.ts`, `style.css` | Armed packet boundary, validated UI state, recovery control | ✓ VERIFIED | `main.ts` imports both adapter and reducer, fetches `/bridge-status`, validates before rendering, and gates packet send/receive on arm epoch/generation. |
| `apps/modem-ui/e2e/fips-packet-bridge.spec.ts`, `bridge-status.spec.ts` | Production-browser packet/recovery and local-only UI proof | ✓ VERIFIED | Both are substantive Playwright tests; 11 current browser tests passed. |
| `vendor/fips/UPSTREAM.md`, `Cargo.toml`, `Cargo.lock` | Reproducible MIT-pinned FIPS source and locked dependency graph | ✓ VERIFIED | Provenance identifies `fc8ebd5…`, MIT license and Rust 1.94.1; recorded LICENSE/toolchain SHA-256 values match current files; direct `tokio-tungstenite = "=0.30.0"` is locked. |
| `vendor/fips/src/{config,transport,node,control}` Sound seams | First-class normal FIPS SoundTransport | ✓ VERIFIED | Sound config validation, node construction, exhaustive `TransportHandle::Sound` dispatch and control statistics are all wired to `SoundTransport`. |
| `compose.fips.yml`, `Dockerfile.bridge`, `vendor/fips/Dockerfile`, `scripts/{check-compose,fips-compose-smoke}.mjs`, `tests/fips-compose.test.mjs` | Loopback-only shared-namespace deployment boundary | ✓ VERIFIED | Compose/static checks passed on current HEAD: FIPS has no host port, joins `service:bridge`, and the only publication is `127.0.0.1:4310`; mutation tests reject privilege/network widening. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| Demo resolver | Production runner and generated FIPS config | resolved immutable config and allowlisted projection | ✓ WIRED | Graph/code trace shows `startProductionRunner` calls both resolver and public projection; runtime config is generated rather than committed per-role. |
| Browser UI | Bridge and packet adapter | binary `/bridge` and `/bridge/fips` frames after arm | ✓ WIRED | `main.ts` creates the adapter, sends/receives FIPS type 9 binary frames, and rejects unarmed/stale state. Playwright executes both directions. |
| Bridge | FWAV protocol | decode/validate before endpoint dispatch | ✓ WIRED | The plan-01 regex was too narrow (`decodeFrame.*FIPS_PACKET` is not adjacent text), but direct source inspection and the stronger plan-04 link prove `decodeFrame` result/type checks precede dispatch. This is not a missing connection. |
| FIPS config/node | `SoundTransport` | normal construction and `TransportHandle::Sound` | ✓ WIRED | `Node::create_transports` constructs Sound; all lifecycle and control dispatches call Sound implementation. |
| Compose smoke | Compose topology | owned config/build/up/inspect/down driver | ✓ WIRED | The source/rendered checks were run in `npm run check`; the bounded smoke program derives its role from `resolveDemoConfig`. |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
| --- | --- | --- | --- | --- |
| Browser transport card | `bridgeState` | `fetch('/bridge-status')` → `validateBridgeSnapshot` → `reduceBridgeState` | Bridge server serializes current scalar state; invalid/partial values are rejected | ✓ FLOWING |
| Browser packet adapter | packet bytes | current-epoch binary WebSocket FIPS_PACKET frames | Real production-page Playwright peer sends and receives byte-identical payloads | ✓ FLOWING |
| FIPS inbound | `ReceivedPacket` | validated binary Sound WebSocket frame | `inject_inbound` passes only a current-epoch armed packet to `PacketTx` | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Workspace TypeScript/browser/Compose behavior | `PATH=/Users/sandwich/.local/node-v22.23.1/bin:$PATH npm run check` | 207 unit tests, 11 browser tests, lint/typecheck/build/dependency/Compose checks passed | ✓ PASS |
| Rust Sound lifecycle, packet, reset, reconnect and queue accounting | `cd vendor/fips && cargo test --locked transport::sound::tests` | 11/11 passed | ✓ PASS |
| Physical acoustic peer, authenticated remote FIPS link/heartbeat, and ICMPv6 ping | Not Phase 2 scope | Explicitly excluded and deferred to Phases 3–4 | ? SKIP (not a gap) |

### Probe Execution

Step 7c: SKIPPED — no Phase 2 probe scripts were declared or found under `scripts/*/tests/probe-*.sh`.

### Requirements Coverage

| Requirement | Source plans | Status | Evidence |
| --- | --- | --- | --- |
| FIPS-01 | 02-02, 02-03, 02-05, 02-07 | ✓ SATISFIED | Pinned provenance, normal Sound configuration/construction/dispatch, and current Compose topology checks. |
| FIPS-02 | 02-05, 02-06, 02-07 | ✓ SATISFIED | Focused Rust suite proves send/inject/reconnect; real browser/FIPS WebSocket test proves armed boundary traffic. |
| FIPS-03 | 02-01, 02-05, 02-06, 02-07 | ✓ SATISFIED | 1357 minimum validation, exact packet test, node MTU path, and current Compose checks. |
| CODEC-01 | 02-01, 02-04, 02-06, 02-07 | ✓ SATISFIED | Packet contract accepts opaque bytes only and rejects PCM metadata; no codec fields appear in the FIPS-facing SoundConfig. |
| WEB-04 | 02-01, 02-04, 02-06 | ✓ SATISFIED | Binary FWAV frames plus real browser byte-identity test; JSON control parser rejects bulk/base64 keys. |
| WEB-05 | 02-01, 02-03, 02-04, 02-05, 02-06 | ✓ SATISFIED | Type/size/role/epoch validation, bounded queues, safe status/error projection, and source/rendered Compose isolation checks. |
| WEB-06 | 02-04, 02-06 | ✓ SATISFIED | RESET is epoch authority across bridge, browser adapter/reducer, and Sound worker; current tests exercise stale callback/frame suppression. |
| CONFIG-02 | 02-01, 02-03, 02-05, 02-06 | ✓ SATISFIED | One immutable A/B resolver supplies runtime values and public projection; tests cover invalid overrides and nsec redaction. |

No Phase 2 requirement is orphaned: every owned ID is declared in at least one Phase 2 plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `packages/bridge/src/demo-config.ts` | 60 | `placeholder` appears only in a comment stating identities are *not* display-only placeholders | ℹ️ Info | Not a stub or debt marker. |
| `apps/modem-ui/src/main.ts` | 680 | HTML `placeholder` attribute for corpus filter | ℹ️ Info | Standard UI label; no missing implementation. |

No unresolved `TBD`, `FIXME`, or `XXX` marker was found in the Phase 2 implementation surfaces inspected. Empty/default values found are queue initialization, reset cleanup, or validated control defaults, not user-visible stubs.

### Disconfirmation Pass

- Partial-requirement check: the physical acoustic peer and ping are absent, but the ROADMAP assigns those specifically to later Phases 3 and 4; they are not Phase 2 gaps.
- Misleading-test check: the browser packet proof is not a fake adapter-only unit; it builds the page, starts the production runner, opens a real FIPS WebSocket peer, and asserts byte identity in both directions.
- Error-path check: reconnect, stale epoch, retiring socket acknowledgement, reset timeout/retry, queue overflow, and concurrent disconnect/accounting paths all have named passing tests. No uncovered Phase 2 blocker was found.

## Gaps Summary

No implementation gaps found. The prior MVP metadata escalation is closed: the revised Phase 2 goal passes the canonical User Story validator, and the implementation/evidence regression check remains clean.

---

_Verified: 2026-07-24T04:59:20Z_
_Verifier: the agent (gsd-verifier)_
