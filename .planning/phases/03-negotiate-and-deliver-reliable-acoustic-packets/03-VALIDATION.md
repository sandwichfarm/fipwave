---
phase: 3
slug: negotiate-and-deliver-reliable-acoustic-packets
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-24
---

# Phase 3 — Validation Strategy

Phase 3 validates the bounded acoustic session beneath the opaque FIPS packet
adapter: binary framing, literal bidirectional calibration, settings
commitment, deterministic half-duplex turns, complete-packet
fragmentation/reassembly, exactly-once delivery, heartbeat degradation, and
fail-closed readiness. It does not claim authenticated FIPS peering or a
two-laptop kernel ping; those are Phase 4 and exact physical evidence remains a
manual target-hardware gate.

## Test Infrastructure

| Property | Value |
|---|---|
| Frameworks | Vitest 4.1.10, Playwright 1.61.1, vendored FIPS Rust tests |
| Required Node | `v22.23.1` |
| Config files | `vitest.config.ts`, `playwright.config.ts`, `playwright.production.config.ts`, `vendor/fips/rust-toolchain.toml` |
| Quick run command | `PATH="/Users/sandwich/.npm/_npx/d295cebdb7c54afe/node_modules/node/bin:$PATH" ./node_modules/.bin/vitest run apps/modem-ui/src/acoustic-protocol.test.ts apps/modem-ui/src/acoustic-session.test.ts apps/modem-ui/src/acoustic-session-adapter.test.ts apps/modem-ui/src/quiet-client.test.ts packages/bridge/test/fips-packet-bridge.test.ts packages/bridge/test/demo-config.test.ts` |
| Full TypeScript/browser command | `PATH="/Users/sandwich/.npm/_npx/d295cebdb7c54afe/node_modules/node/bin:$PATH" npm run typecheck && npm run test:unit && npm run test:browser` |
| Focused browser command | `PATH="/Users/sandwich/.npm/_npx/d295cebdb7c54afe/node_modules/node/bin:$PWD/node_modules/.bin:$PATH" ./node_modules/.bin/playwright test acoustic-session.spec.ts fips-packet-bridge.spec.ts --config=playwright.config.ts` |
| Focused Rust command | `(cd vendor/fips && cargo test sound_ --locked && cargo fmt --check)` |
| Estimated quick latency | under 30 seconds after Wave 0 |
| Estimated full latency | under 180 seconds on the development host |

## Sampling Rate

- **After every task commit:** Run the targeted Vitest file named by the task;
  Rust/bridge readiness changes also run `cargo test sound_transport --locked`.
- **After every plan wave:** Run `npm run typecheck && npm run test:unit &&
  npm run test:browser` under Node 22.
- **Before phase verification:** Run all TypeScript, browser, and focused Rust
  suites plus deterministic two-role simulation and classified single-laptop
  speaker-to-microphone evidence.
- **Max feedback latency:** 30 seconds for a task-local check; no three
  consecutive implementation tasks may rely only on the full-suite gate.

## Requirement Verification Map

| Requirement(s) | Planned behavioral proof | Test type | Automated command | File exists | Status |
|---|---|---|---|---|---|
| LINK-01, LINK-02 | Reject bad magic/version/type/length/CRC/session/role/sequence before any session-state mutation. | unit/adversarial | `vitest run apps/modem-ui/src/acoustic-protocol.test.ts` | Yes | covered |
| LINK-03, LINK-04 | A 1357-byte opaque packet round-trips through bounded maximum-payload fragments; overflow, expiry, and incomplete assemblies never emit. | unit | `vitest run apps/modem-ui/src/acoustic-protocol.test.ts apps/modem-ui/src/acoustic-session.test.ts` | Yes | covered |
| LINK-05 | Duplicate data, ACK, and retry paths produce exactly one complete adapter delivery per active-session packet ID. | unit/integration | `vitest run apps/modem-ui/src/acoustic-session.test.ts apps/modem-ui/src/acoustic-session-adapter.test.ts` | Yes | covered |
| LINK-06, LINK-07 | A fake clock proves measured bounded timeout/backoff, playback completion, and collision-free deterministic four-unit turns under loss and delayed ACKs. | deterministic integration | `vitest run apps/modem-ui/src/acoustic-session.test.ts` | Yes | covered |
| LINK-08 | Control/ACK preempts all packet data and an explicit FIPS traffic-class seam prioritizes handshake/heartbeat without inspecting opaque bytes. | TS/Rust integration | `vitest run apps/modem-ui/src/acoustic-session.test.ts packages/bridge/test/fips-packet-bridge.test.ts && (cd vendor/fips && cargo test sound_ --locked)` | Yes | covered |
| LINK-09 | Packet/item/byte/age caps return bounded safe errors, preserve cross-process admission backpressure, disarm the bridge/FIPS boundary, and prevent stale replay. | unit/integration | `vitest run apps/modem-ui/src/acoustic-session.test.ts packages/bridge/test/fips-packet-bridge.test.ts && (cd vendor/fips && cargo test sound_ --locked)` | Yes | covered |
| NEG-01, NEG-02 | Only A initiates; identity, complementary role, nonce, profile, range, epoch, and state transition are all validated. | unit | `vitest run apps/modem-ui/src/acoustic-session.test.ts` | Yes | covered |
| NEG-03, NEG-04 | Literal A→B then B→A numbered probes create a complete ledger and select deterministic directional settings or bounded bootstrap fallback. | unit/fake modem | `vitest run apps/modem-ui/src/acoustic-session.test.ts packages/bridge/test/demo-config.test.ts` | Yes | covered |
| NEG-05 | A settings-digest mismatch cannot arm FIPS; matching commit acknowledgement plus a current heartbeat can, and reset clears both. | browser/bridge/Rust integration | `vitest run apps/modem-ui/src/acoustic-session-adapter.test.ts packages/bridge/test/fips-packet-bridge.test.ts && (cd vendor/fips && cargo test sound_ --locked)` | Yes | covered |
| NEG-06 | Missed heartbeat enters `Degraded`, then bounded recovery or one terminal safe error; no open-ended loop can remain armed. | fake-clock integration | `vitest run apps/modem-ui/src/acoustic-session.test.ts` | Yes | covered |
| NEG-07 | Only an exact supported fixed profile ID is accepted; synthetic frequency, sample-rate, and playback-speed controls reject. | unit | `vitest run apps/modem-ui/src/acoustic-protocol.test.ts packages/bridge/test/demo-config.test.ts` | Yes | covered |

## Wave 0 Requirements

- [x] `apps/modem-ui/src/acoustic-protocol.test.ts` — hostile FAS1 decoder
  corpus, CRC, canonical settings digest, fixed profile identity, and maximum
  wire geometry.
- [x] `apps/modem-ui/src/acoustic-session.test.ts` — fake modem/clock two-role
  handshake, directional calibration, turns, loss, retry, duplicate,
  reassembly expiry, heartbeat, and backpressure coverage.
- [x] `apps/modem-ui/src/acoustic-session-adapter.test.ts` — complete FIPS
  packets cannot enter or leave before matching settings commitment plus a
  current heartbeat or after reset/degradation.
- [x] Extend `packages/bridge/test/fips-packet-bridge.test.ts` — local
  `AUDIO_SETTINGS` no longer arms FIPS; current-epoch acoustic-ready does;
  reset/degraded/error disarm it.
- [x] Extend `vendor/fips/src/transport/sound/mod.rs` tests — projected
  current-epoch acoustic readiness is the only packet gate and reset
  invalidates it.
- [x] `apps/modem-ui/e2e/acoustic-session.spec.ts` — the built browser with a
  deterministic modem seam exposes truthful session/readiness state without
  an alternate inter-laptop transport.
- [x] Resolve and test the explicit FIPS traffic-class seam before implementing
  LINK-08; never infer priority from opaque payload bytes.

## Manual-Only Verifications

| Behavior | Requirement(s) | Why manual | Test instructions |
|---|---|---|---|
| Single-laptop speaker→microphone session including one 1357-byte packet | LINK-01..09, NEG-01..07 | The real Web Audio/Quiet/hardware path cannot be represented by a fake modem. It is evidence for `Loopback`, never `Open air`. | Use the physical qualification runner with speakers and microphone enabled; retain the raw report, selected settings, packet digest, loss/retry counters, and evidence class. |
| Exact MacBook/Linux target behavior | LINK-06, LINK-07, NEG-03, NEG-04, NEG-06 | Audio routing, automatic gain control, echo cancellation, device geometry, and room acoustics are host-specific. | Repeat the role-scoped preflight and bidirectional calibration on each exact demo laptop before rehearsal. |
| Exact two-laptop open-air packet delivery | LINK-01..09, NEG-01..07 | Only two physically separate machines can prove the intended acoustic hop. | Launch role A and role B independently, retain both evidence directories, verify matching session/settings digests and bidirectional complete-packet hashes, and classify only this result as `Open air`. |
| Authenticated FIPS peer and `ping -6` | Later Phase 4 requirements | Phase 3 deliberately stops below authenticated FIPS link establishment. | Follow the Phase 4 acceptance procedure after the acoustic session passes. |

## Validation Sign-Off

- [x] Planner assigns each requirement to at least one task with an executable
  behavior check.
- [x] Every implementation task has task-local automated feedback.
- [x] Wave 0 creates every missing test seam before dependent production work.
- [x] No watch-mode flags occur in validation commands.
- [x] Deterministic simulation, physical loopback, and exact open-air evidence
  remain visibly distinct.
- [x] Full suite is green and feedback latency remains bounded.
- [x] `wave_0_complete: true` and `nyquist_compliant: true` are set only after
  the implementation and adversarial audit prove them.

**Approval:** validated 2026-07-24 — 16 covered, 0 partial, 0 missing.

## Validation Audit 2026-07-24

| Metric | Count |
|---|---:|
| Gaps found | 0 |
| Resolved | 16 |
| Escalated | 0 |

Focused evidence passed: 63 Vitest assertions across six files, 2 Playwright
session/readiness checks, and 17 locked Rust Sound tests. The full project gate
passed with 247 unit tests and 12 browser tests. Physical evidence remains
manual-only and is not represented by Fixture results.
