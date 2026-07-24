---
phase: 2
slug: configure-and-establish-the-codec-neutral-fips-bridge
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-24
validated: 2026-07-24
---

# Phase 2 — Final Validation

Phase 2 validates the **local, codec-neutral FIPS packet boundary**: configuration
authority, a binary browser/bridge/FIPS path, bounded recovery, a pinned FIPS
SoundTransport, and loopback-only Compose topology. It does not claim an acoustic
peer, an authenticated FIPS link, heartbeat survival, or ICMPv6.

## Test Infrastructure

| Property | Value |
|---|---|
| Frameworks | Vitest 4.1.10, Playwright 1.61.1, Rust `cargo test`, Node test |
| Required Node | `v22.23.1` |
| Fresh audit command | `PATH="/Users/sandwich/.npm/_npx/d295cebdb7c54afe/node_modules/node/bin:$PATH" npm run typecheck && npm test && (cd vendor/fips && cargo test sound_ --locked)` |
| Fresh audit result | Passed: TypeScript; 20 files / 195 Node tests; 8 focused Rust sound tests |
| Browser packet command | `PATH="/Users/sandwich/.npm/_npx/d295cebdb7c54afe/node_modules/node/bin:$PATH" npm run test:browser -- apps/modem-ui/e2e/fips-packet-bridge.spec.ts` |
| Browser packet result | Passed: production page exchanges opaque bytes and refuses a delayed prior-epoch packet after reset |
| Deployment evidence | `npm run test:compose`; `npm run test:fips-compose:runtime -- --role a`; `npm run test:fips-compose:runtime -- --role b` — all passed in final review evidence |
| Full pinned-fork evidence | `cargo test --lib --locked` — 1,594 passed / 4 ignored in final review evidence |

## Per-Task Verification Map

| Task ID | Requirement(s) | Behavioral proof | Automated command | Status |
|---|---|---|---|---|
| 02-01-01 | CONFIG-02, CODEC-01, WEB-04, WEB-05, FIPS-03 | Typed A/B config is frozen/secret-safe; dual real local WebSocket roles relay exact 1357-byte opaque frames; malformed, stale, text, wrong-role and bulk-control paths reject before counters change. | `vitest run packages/bridge/test/demo-config.test.ts packages/bridge/test/protocol.test.ts packages/bridge/test/fips-packet-bridge.test.ts` | green |
| 02-02-01 | FIPS-01 | Vendored upstream revision, lockfile, license and Rust target compile as an audited locked dependency graph. | `(cd vendor/fips && cargo metadata --locked --format-version 1 >/dev/null && cargo test --no-run --locked)` | green |
| 02-03-01 | CONFIG-02 | Canonical A/B identities/peers/defaults resolve from one authority; exact unsafe overrides fail without leaking nsecs. | `vitest run packages/bridge/test/demo-config.test.ts` | green |
| 02-03-02 | CONFIG-02, WEB-05, WEB-06 | Runner consumes resolved config only; resource ownership is reverse-order, idempotent and partial-startup-safe. | `vitest run packages/bridge/test/resource-owner.test.ts tests/production-runner.test.ts` | green |
| 02-04-01 | WEB-04, WEB-05 | Independent packet queues remain bounded; unavailable destinations and JSON/base64 bulk control reject with safe state and unchanged accepted counters. | `vitest run packages/bridge/test/fips-packet-bridge.test.ts tests/production-runner.test.ts` | green |
| 02-04-02 | WEB-06 | RESET is the epoch authority, clears volatile packet state, rejects stale acknowledgements, and permits new current-epoch relays. | `vitest run packages/bridge/test/fips-packet-bridge.test.ts tests/production-runner.test.ts` | green |
| 02-05-01 | FIPS-01, WEB-05 | Source and rendered topology mutation tests enforce shared namespace, exact loopback publication, TUN and only NET_ADMIN. | `npm run test:compose && docker compose -f compose.fips.yml config --quiet` | green |
| 02-05-02 | FIPS-01, FIPS-02, FIPS-03, WEB-05 | Role-A and role-B Compose smokes inspect first PID, effective NET_ADMIN, TUN/fips0 MTU 1280, configured peer, and live local Sound worker. | `npm run test:fips-compose:runtime -- --role a`; `npm run test:fips-compose:runtime -- --role b` | green |
| 02-06-01 | CODEC-01, WEB-04, WEB-05, WEB-06 | Built browser page arms then exchanges exact complete binary FIPS bytes with a real local WebSocket bridge; delayed prior-epoch post-reset packet cannot reach the adapter. | `vitest run apps/modem-ui/src/fips-packet-adapter.test.ts`; `npm run test:browser -- apps/modem-ui/e2e/fips-packet-bridge.spec.ts` | green |
| 02-06-02 | CONFIG-02, FIPS-02, FIPS-03, WEB-05, WEB-06 | Validated browser reducer separates worker state from browser readiness, requires MTU >=1357, and makes reset acknowledgement/failure retry-safe. | `vitest run apps/modem-ui/src/bridge-state.test.ts apps/modem-ui/src/audio.test.ts` | green |
| 02-06-03 | WEB-05, WEB-06 | Browser status card renders safe scalar facts and recovery controls without peer/ping claims or page-width overflow. | `npm run test:browser -- apps/modem-ui/e2e/bridge-status.spec.ts` | green |
| 02-07-01 | FIPS-01, FIPS-02, FIPS-03, CODEC-01 | Strict SoundConfig plus SoundTransport start/send/inbound `ReceivedPacket`/stop; 1357-byte loopback packet succeeds, unarmed/oversize/stale work fails closed. | `(cd vendor/fips && cargo test sound_transport --locked)` | green |
| 02-07-02 | FIPS-01, FIPS-02, FIPS-03 | Exhaustive Sound dispatch, static policy, pre-operational 1357→1280 MTU and safe control statistics are exercised. | `(cd vendor/fips && cargo test sound_ --locked)` | green |

## Requirement Coverage

| Requirement | Status | Evidence |
|---|---|---|
| FIPS-01 | COVERED | Provenance-lock, complete first-class Sound dispatch tests, Compose source mutation tests, and both role runtime smokes. |
| FIPS-02 | COVERED | Rust lifecycle/inbound `ReceivedPacket` tests plus local browser↔bridge↔FIPS packet integration. |
| FIPS-03 | COVERED | Config minimum, exact 1357-byte packet tests, Rust link MTU tests, and runtime `fips0` effective MTU 1280 inspection. |
| CODEC-01 | COVERED | FWAV FIPS_PACKET is opaque/binary and rejects PCM metadata; browser adapter and Rust SoundTransport preserve codec-neutral complete packets. |
| WEB-04 | COVERED | Dual-endpoint bridge and production browser WebSocket tests prove byte identity without JSON/base64 bulk framing. |
| WEB-05 | COVERED | Queue item/byte/age guards, safe snapshots/errors, origin/topology boundaries, and Compose runtime inspection. |
| WEB-06 | COVERED | Bridge epoch reset tests, browser reducer tests, and production-browser delayed prior-epoch rejection after reset. |
| CONFIG-02 | COVERED | One frozen resolver/public allowlist feeds runner and rendered FIPS config; tests cover complementary roles, overrides, and nsec redaction. |

## Adversarial Nyquist Audit Trail

| Gap | Action | Result |
|---|---|---|
| Production browser recovery had only an armed happy-path packet assertion. | Added a built-page behavioral assertion to `apps/modem-ui/e2e/fips-packet-bridge.spec.ts`: arm, exchange bytes, reset/re-arm, inject a delayed old-epoch packet, and assert no second adapter delivery. | FILLED — test passed. |
| New test initially failed TypeScript due to an overly narrow `Window` type cast. | Declared the test-only optional `Window.__fipsPacketDeliveries` property; no implementation code changed. | Test fix iteration 1; typecheck and all suites passed. |

## Manual-Only Boundary

| Behavior | Requirement(s) | Status | Why it remains manual/later-phase |
|---|---|---|---|
| Exact target Docker Desktop/native-Linux behavior | FIPS-01, WEB-05 | Rehearse on each demo laptop | Automated Compose smokes validate this engine; an operator still repeats the documented host smoke on the exact demo laptops. |
| Physical audible/open-air delivery | FIPS-04, FIPS-05, LINK-01..09, NEG-01..07 | Not a Phase 2 claim | Phase 2 deliberately has no acoustic codec/reassembly/negotiation proof. |
| Authenticated remote FIPS handshake and normal heartbeat | FIPS-04, FIPS-05 | Later phase | A local Sound worker/browser arm is not peer establishment. |
| Kernel ICMPv6 ping/reply across two laptops | DEMO-01, DEMO-02 | Later phase/manual demo verification | No Phase 2 test promotes loopback/browser bridge evidence to a sound link or ping. |

## Sign-Off

- [x] Every Phase 2 plan task has an executable behavioral or provenance check.
- [x] All Phase 2-owned requirements map to passing automated evidence.
- [x] Fresh audit ran under Node 22.23.1; all 195 Node tests, focused browser test, and focused Rust Sound tests passed.
- [x] Implementation files were not modified during this Nyquist audit.
- [x] Physical acoustic/FIPS-peer/ICMP claims remain explicitly excluded.

**Approval:** validated for the Phase 2 local bridge/FIPS transport scope.
