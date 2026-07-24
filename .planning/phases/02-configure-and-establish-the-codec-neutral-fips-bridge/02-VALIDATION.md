---
phase: 2
slug: configure-and-establish-the-codec-neutral-fips-bridge
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-24
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10, Playwright 1.61.1, Rust `cargo test` |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`, `vendor/fips/rust-toolchain.toml` |
| **Quick run command** | `npm run typecheck && npm run test:unit` |
| **Full suite command** | `npm run check && (cd vendor/fips && cargo test --locked)` |
| **Estimated runtime** | ~180 seconds after the vendored Rust build cache is warm |

---

## Sampling Rate

- **After every task commit:** Run the targeted Vitest or `cargo test sound_* --locked` command named by the task.
- **After every plan wave:** Run `npm run typecheck && npm run test:unit && (cd vendor/fips && cargo test --locked)`.
- **Before `$gsd-verify-work`:** Full Node, browser, Rust, and Compose suites must be green.
- **Max feedback latency:** 300 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | CONFIG-02, CODEC-01, WEB-04, WEB-05, FIPS-03 | nsec disclosure / malformed binary frames | Production tracer proves validated role A config and byte-identical FIPS_PACKET relay in both directions | tracer integration | `./node_modules/.bin/vitest run packages/bridge/test/demo-config.test.ts packages/bridge/test/protocol.test.ts packages/bridge/test/fips-packet-bridge.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | FIPS-01 | supply-chain tampering | Exact upstream commit, license, toolchain and audited locked dependency are mechanically verified before patching | build/provenance | `cd vendor/fips && cargo metadata --locked --format-version 1 >/dev/null && cargo test --no-run --locked` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 2 | CONFIG-02 | nsec disclosure / invalid override | A/B defaults and overrides validate through one authority and public projection omits secrets | unit | `./node_modules/.bin/vitest run packages/bridge/test/demo-config.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 2 | CONFIG-02, WEB-05, WEB-06 | resource leak / stale generation | Resolved config feeds the runner and one owner releases/reconnects every local resource | integration | `./node_modules/.bin/vitest run packages/bridge/test/resource-owner.test.ts tests/production-runner.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 2 | WEB-04, WEB-05 | memory growth / false counters | Both directions enforce item/byte/age bounds and expose only safe current-epoch state | integration | `./node_modules/.bin/vitest run packages/bridge/test/fips-packet-bridge.test.ts tests/production-runner.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-02 | 04 | 2 | WEB-06 | stale replay | RESET advances epoch, clears queues and reconnects while prior-generation work stays rejected | integration | `./node_modules/.bin/vitest run packages/bridge/test/fips-packet-bridge.test.ts tests/production-runner.test.ts` | ❌ W0 | ⬜ pending |
| 02-07-01 | 07 | 2 | FIPS-01, FIPS-02, FIPS-03, CODEC-01 | lifecycle bypass / unarmed injection | Sound uses normal start/stop/send/ReceivedPacket paths and fails closed until browserReady | Rust integration | `cd vendor/fips && cargo test sound_transport --locked` | ❌ W0 | ⬜ pending |
| 02-07-02 | 07 | 2 | FIPS-01, FIPS-02, FIPS-03 | false MTU / omitted dispatch | All 13 capabilities dispatch through Sound; MTU 1357 yields effective 1280 before peer establishment | Rust unit/integration | `cd vendor/fips && cargo test sound_ --locked` | ❌ W0 | ⬜ pending |
| 02-05-01 | 05 | 3 | FIPS-01, WEB-05 | LAN exposure | Compose shares one local namespace, publishes browser origin on loopback and mutation tests reject widened binds | config smoke | `npm run test:compose && docker compose -f compose.fips.yml config --quiet` | partial | ⬜ pending |
| 02-05-02 | 05 | 3 | FIPS-01, FIPS-02, FIPS-03, WEB-05 | topology spoofing / unsafe readiness | Live engine inspect and reachability smoke fail closed unless the owned FIPS/bridge pair has exact namespace and loopback boundaries | runtime smoke | `npm run test:fips-compose:runtime -- --role a` | ❌ W0 | ⬜ pending |
| 02-06-01 | 06 | 3 | CODEC-01, WEB-04, WEB-05, WEB-06 | unarmed/stale browser injection | Actual armed browser runtime exchanges complete packets byte-for-byte through a codec-neutral adapter; unarmed and reset states reject | unit + browser integration | `./node_modules/.bin/vitest run apps/modem-ui/src/fips-packet-adapter.test.ts && npm run test:browser -- apps/modem-ui/e2e/fips-packet-bridge.spec.ts` | ❌ W0 | ⬜ pending |
| 02-06-02 | 06 | 3 | CONFIG-02, FIPS-02, FIPS-03, WEB-05, WEB-06 | unsafe state / stale recovery | Validated reducer keeps worker Up separate from browser readiness and RESET is epoch-safe/retryable | unit | `./node_modules/.bin/vitest run apps/modem-ui/src/bridge-state.test.ts apps/modem-ui/src/audio.test.ts` | ❌ W0 | ⬜ pending |
| 02-06-03 | 06 | 3 | WEB-05, WEB-06 | disclosure / false claim | Semantic UI renders only safe scalar local state and preserves the Phase 2 claim fence | browser | `npm run test:browser -- apps/modem-ui/e2e/bridge-status.spec.ts` | ❌ W0 | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `packages/bridge/test/demo-config.test.ts` — role/default/secret-redaction coverage.
- [ ] `packages/bridge/test/protocol.test.ts` — production FIPS_PACKET type/header/size/epoch validation.
- [ ] `packages/bridge/test/fips-packet-bridge.test.ts` — dual endpoint, binary relay, bounds, state, and epoch reset.
- [ ] `packages/bridge/test/resource-owner.test.ts` and `tests/production-runner.test.ts` — one config authority, bounded ownership and reset/reconnect integration.
- [ ] `vendor/fips/src/transport/sound/mod.rs` tests — lifecycle, browser readiness, MTU, oversize rejection, inbound `ReceivedPacket`, reconnect fixture and all 13 dispatch capabilities.
- [ ] `apps/modem-ui/src/fips-packet-adapter.test.ts` — byte identity, armed readiness, invalid frame and generation invalidation.
- [ ] `apps/modem-ui/e2e/fips-packet-bridge.spec.ts` — built-page `Arm modem` plus real WebSocket ingress/egress and pre-arm/post-reset rejection.
- [ ] `apps/modem-ui/src/bridge-state.test.ts` and `apps/modem-ui/e2e/bridge-status.spec.ts` — approved local state/recovery/UI backstops.
- [ ] Compose source/rendered/runtime verification for shared namespace, explicit `127.0.0.1` publication and fail-closed engine reachability.
- [ ] Activate the project-pinned Node 22.23.1 for authoritative Node validation.

Each owning task writes its listed missing test before production behavior, even though executable plan waves begin at Wave 1.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Target Docker engines honor the shared bridge namespace and local browser route | FIPS-01, WEB-05 | Docker Desktop macOS and native Linux networking must be checked on exact hosts | Run the Phase 2 Compose smoke on each target and retain rendered config plus inspect evidence. |

Physical acoustic delivery is not a Phase 2 claim and remains separate from
this local bridge verification.

---

## Validation Sign-Off

- [ ] All tasks have automated verification or explicit Wave 0 dependencies.
- [ ] Sampling continuity has no three consecutive tasks without automated verification.
- [ ] Wave 0 covers all missing references.
- [ ] No watch-mode flags are used.
- [ ] Feedback latency stays below 300 seconds.
- [ ] `nyquist_compliant: true` is set after execution evidence passes.

**Approval:** pending
