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
| 02-01-01 | 01 | 0 | CONFIG-02 | nsec disclosure | Public projection excludes private demo keys | unit | `npx vitest run packages/bridge/test/demo-config.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | WEB-04, WEB-05 | malformed/oversized binary frames | Endpoint-role and size validation rejects before queueing | integration | `npx vitest run packages/bridge/test/fips-packet-bridge.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 0 | FIPS-01, FIPS-03 | false MTU / bypass | First-class sound handle accepts 1357 and yields effective 1280 | Rust unit | `cd vendor/fips && cargo test sound_mtu --locked` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | FIPS-01, FIPS-02 | lifecycle bypass | Sound uses normal start/stop/send/`ReceivedPacket` paths | Rust integration | `cd vendor/fips && cargo test sound_transport --locked` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 1 | WEB-04, WEB-05 | alternate path / memory growth | Loopback-only endpoints relay byte-identical complete packets within bounds | integration | `npx vitest run packages/bridge/test/fips-packet-bridge.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 1 | WEB-06 | stale replay | Reset advances epoch, clears queues, and rejects prior generation | integration | `npx vitest run packages/bridge/test/fips-packet-bridge.test.ts tests/production-runner.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 2 | FIPS-01, WEB-05 | LAN exposure | Compose shares only local namespace and publishes browser origin on loopback | config smoke | `npm run test:compose` | partial | ⬜ pending |
| 02-04-02 | 04 | 2 | WEB-05, WEB-06 | unsafe UI projection | Bridge states and safe errors render without nsecs or raw frames | browser | `npm run test:browser` | partial | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `packages/bridge/test/demo-config.test.ts` — role/default/secret-redaction coverage.
- [ ] `packages/bridge/test/fips-packet-bridge.test.ts` — dual endpoint, binary relay, bounds, state, and epoch reset.
- [ ] `vendor/fips/src/transport/sound/mod.rs` tests — lifecycle, MTU, oversize rejection, inbound `ReceivedPacket`, reconnect fixture.
- [ ] Extend Compose verification for shared namespace and explicit `127.0.0.1` publication.
- [ ] Activate the project-pinned Node 22.23.1 for authoritative Node validation.

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
