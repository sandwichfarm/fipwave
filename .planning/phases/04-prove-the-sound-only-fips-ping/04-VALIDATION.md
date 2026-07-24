---
phase: 4
slug: prove-the-sound-only-fips-ping
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-24
---

# Phase 4 — Validation Strategy

Phase 4 validates normal authenticated FIPS peering over the existing
current-epoch acoustic admission gate, live Role B Sound-only isolation, one
bounded system `ping -6` in Role A's FIPS namespace, observed proof counters,
the approved diagnostic UI, and one disarm-first normal reconnect. Automated
Fixture tests validate contracts and orchestration only. Real speakers,
microphones, two named laptops, Open-air classification, and the final kernel
reply remain manual gates when hardware is unavailable.

## Test Infrastructure

| Property | Value |
|---|---|
| Frameworks | Vitest, Node test runner, Playwright, vendored Cargo tests, Docker Compose |
| Config files | `vitest.config.ts`, `playwright.config.ts`, `playwright.production.config.ts`, `vendor/fips/rust-toolchain.toml`, `compose.fips.yml` |
| Quick proof command | `npx vitest run packages/bridge/test/sound-proof.test.ts packages/bridge/test/proof-controller.test.ts packages/bridge/test/isolation-attestation.test.ts apps/modem-ui/src/proof-state.test.ts && node --test tests/fips-compose.test.mjs` |
| Focused UI command | `npm run build && npx playwright test apps/modem-ui/e2e/sound-proof.spec.ts` |
| Focused readiness command | `npx vitest run packages/bridge/test/fips-packet-bridge.test.ts apps/modem-ui/src/acoustic-session-adapter.test.ts && (cd vendor/fips && cargo test sound_transport --locked)` |
| Runtime command | `npm run test:fips-compose:runtime` |
| Full software gate | `npm run typecheck && npm run test:unit && npm run test:compose && npm run build && npx playwright test apps/modem-ui/e2e/sound-proof.spec.ts` |

## Architecture and Dependency Contract

| Wave | Ownership | Required connection |
|---|---|---|
| 1 / 04-01 | `proof.ts`, `proof-controller.ts`, final FIPS/bridge image tools | Pure current-state controller and fixed argument-array ping exist before transport attestation/server wiring. |
| 2 / 04-02 | `demo-config.ts`, `isolation-attestation.ts`, `compose.fips.yml`, live smoke | One config authority fixes B target/proof port and all UDP bounds. Role B responder binds only deterministic B `fips0` inside the existing bridge/FIPS shared network namespace; Compose has no host publication for the proof port. |
| 3 / 04-03 | `runner.ts`, `server.ts`, controller expansion | Runner instantiates/owns controller and Role B responder, injects the controller into `createBridgeServer`, and closes both through `ResourceOwner`. Existing listener serves exact same-origin `GET /proof-status` and Role A-only `POST /proof-ping`; no second HTTP listener exists. |
| 4 / 04-04 | `proof-state.ts`, `main.ts`, existing diagnostic UI | Browser calls only the two exact same-origin routes and renders their bounded projection. |
| 5 / 04-05 | exact physical A/B setup | Human validates the UDP attestation and ping traverse the authenticated encrypted FIPS/Sound link. |

The in-band UDP contract uses a 32-byte cryptographically random one-use
challenge, fixed B `fips0` port, 1024-byte response cap, 45-second timeout per
attempt, two sends maximum, six requests/minute, 32-entry/120-second replay
cache, and 60-second snapshot freshness. The response binds challenge, expected
B public identity/target, run/build, current epoch/bounded settings identifier,
timestamp, exactly-one-usable-Sound state/worker/readiness, expected peer/link
association, and canonical SHA-256 snapshot digest. Wrong source/port,
timeout, mismatch, replay, rate excess, unavailable field, or extra/failed
transport blocks ping.

## Sampling Rate

- **After every task:** run the task's focused automated command.
- **After every wave:** run the quick proof command plus typecheck.
- **Before physical acceptance:** run the full software gate, build the role
  images, verify `/usr/bin/ping` in the bridge image plus bounded Node access to
  `/run/fips/control.sock`, and run role-specific live Compose inspection.
- **Physical gate:** run exactly one acceptance ping and one interruption/
  reconnect sequence; Phase 5 owns ten pings, cold starts, 60-second scoring,
  launcher, presenter, and rehearsal work.

## Requirement Verification Map

| Requirement(s) | Planned behavioral proof | Test type | Automated command | Wave 0 file | Status |
|---|---|---|---|---|---|
| FIPS-04 | Expected npub is connected/authenticated through Sound and joins the active link/transport before in-band challenge; no auth bypass exists. | strict controller + live snapshot | `npx vitest run packages/bridge/test/sound-proof.test.ts packages/bridge/test/proof-controller.test.ts` | two new tests | Wave 0 |
| FIPS-05 | Disarm clears readiness/outcome/challenge before ordinary peer loss; fresh acoustic readiness, FIPS auth, and attestation are required. | fixture integration + Rust | `npx vitest run packages/bridge/test/proof-controller.test.ts packages/bridge/test/fips-packet-bridge.test.ts && (cd vendor/fips && cargo test sound_transport --locked)` | new/extend | Wave 0 |
| DEPLOY-03 | B config/live snapshots have exactly one usable Sound instance with current state/worker/readiness and expected peer/link association; attestation binds it. | config/runtime/datagram mutation | `npx vitest run packages/bridge/test/isolation-attestation.test.ts packages/bridge/test/demo-config.test.ts && node --test tests/fips-compose.test.mjs` | new/extend | Wave 0 |
| DEPLOY-04 | A renders Sound plus existing outbound-only UDP participant posture while B's peer address remains Sound-only. | config unit + live snapshot | `npx vitest run packages/bridge/test/demo-config.test.ts tests/production-runner.test.ts` | extend existing | Wave 0 |
| DEPLOY-05 | Browser publication is loopback-only, FIPS is un-published, service namespace/TUN/capabilities remain exact. | Compose mutation/runtime | `node --test tests/fips-compose.test.mjs && node scripts/check-compose.mjs --fips-source` | extend existing | Wave 0 |
| DEMO-01 | Controller invokes one argument-array system `ping -6 -n -c 1 -W 15 <B>` only after current in-band attestation. | controller fixture | `npx vitest run packages/bridge/test/proof-controller.test.ts` | new | Wave 0 |
| DEMO-02 | Attestation, exit/result, and before/after counters correlate the real reply path; fixture result is never physical acceptance. | controller + human Open air | `npx vitest run packages/bridge/test/proof-controller.test.ts packages/bridge/test/isolation-attestation.test.ts` | new | Wave 0 + manual |
| DEMO-03 | UI shows current authenticated peer, Sound link, and live B isolation before ping. | reducer + production UI | `npx vitest run apps/modem-ui/src/proof-state.test.ts && npx playwright test apps/modem-ui/e2e/sound-proof.spec.ts` | two new UI test files | Wave 0 |
| DEMO-04 | UI shows observed complete-packet/acoustic/fragment/integrity/retry and ICMPv6 counter correlation with unavailable values honest. | reducer + production UI | `npx vitest run apps/modem-ui/src/proof-state.test.ts && npx playwright test apps/modem-ui/e2e/sound-proof.spec.ts` | two new UI test files | Wave 0 |
| CONFIG-04 | Literal role A/B selects the exact participant or isolated transport policy without another required parameter. | config unit | `npx vitest run packages/bridge/test/demo-config.test.ts tests/production-runner.test.ts` | extend existing | Wave 0 |

## UI-SPEC Verification Map

| Approved criterion | Automated proof |
|---|---|
| Proof card labels and all evidence classes | `sound-proof.spec.ts` production-page fixtures |
| Local bridge/audio cannot imply peer readiness | `proof-state.test.ts` blocked-state fixture |
| Role A-only ping after current complete join | reducer plus Role A/Role B browser fixtures |
| Fixture/Loopback success remains neutral/nonphysical | reducer copy/color assertions |
| Open air requires matching two-machine records | reducer evidence-disposition tests |
| Disarm/epoch/peer/link/Sound/heartbeat/isolation change clears result | reducer transition table |
| Nonzero/timeout result requires fresh refresh | command fixture plus reducer tests |
| Semantic live region/native controls/320px overflow | Playwright accessibility and screenshot assertions |
| Existing diagnostics scroll; no presenter/no-scroll test | production-page card-presence/scroll assertion |

All 24/24 state considerations are explicitly covered across empty, loading,
error, populated, partial, overflow, zero-one-many, and long-text fixtures.

## Wave 0 Gaps

- [ ] `packages/bridge/src/proof.ts` and
  `packages/bridge/test/sound-proof.test.ts` — exact snapshot/proof schema,
  D-10 join, evidence disposition, lifecycle invalidation, and counter
  correlation.
- [ ] `packages/bridge/src/proof-controller.ts` and
  `packages/bridge/test/proof-controller.test.ts` — current controller,
  in-band challenge admission, bounded ping, reconnect, and injected process/
  control/status seams.
- [ ] `packages/bridge/src/isolation-attestation.ts` and
  `packages/bridge/test/isolation-attestation.test.ts` — exact UDP schema,
  Role B responder, random challenge, source/current-binding/digest checks,
  size/time/retry/rate/replay bounds, and hostile corpus.
- [ ] Extend `packages/bridge/src/server.ts`,
  `packages/bridge/src/runner.ts`, `packages/bridge/test/fips-packet-bridge.test.ts`,
  and `tests/production-runner.test.ts` — exact same-origin routes,
  Role A authorization, controller injection, responder startup, and
  ResourceOwner shutdown with no second listener.
- [ ] Extend `tests/fips-compose.test.mjs` — B alternate-transport and
  non-loopback/namespace/capability mutations.
- [ ] Extend `packages/bridge/test/demo-config.test.ts` and
  `tests/production-runner.test.ts` — exact A/B policy, secret-safe public
  projection, and rendered config cardinality.
- [ ] `apps/modem-ui/src/proof-state.test.ts` — every approved UI state,
  current-result invalidation, missing-counter, evidence, and role-control
  behavior.
- [ ] `apps/modem-ui/e2e/sound-proof.spec.ts` — exact card placement/copy,
  semantic/accessibility controls, all evidence outcomes, preserved
  diagnostics, and 320px overflow.
- [ ] Final-image check — `iputils-ping` exists in the bridge runtime stage,
  no `fipsctl` binary was added, and the bridge can query only the three
  allowlisted snapshots through the private shared Unix socket.

## Manual-Only Verifications

| Behavior | Requirement(s) | Why manual | Test instructions |
|---|---|---|---|
| Real selected-codec speaker/microphone session on each target laptop | FIPS-04, FIPS-05 | Fixtures cannot exercise actual audio hardware, processing, room timing, or current heartbeat. | Establish Phase 3 readiness on each named laptop and retain honest Loopback/Open-air evidence. |
| Exact two-laptop Open-air authenticated FIPS peer | FIPS-04, DEPLOY-05 | Only two physically separate machines prove the intended acoustic inter-laptop hop. | Run A/B independently with no LAN browser/bridge path; verify matching session and authenticated Sound peer/link facts. |
| Live Role B in-band Sound-only isolation attestation | DEPLOY-03, CONFIG-04, DEMO-03 | Only physical two-machine FIPS/Sound transport can prove the response crossed the intended hop. | Refresh A status after normal FIPS authentication; verify A sends the one-use UDP challenge to B `fips0`, B responds from the fixed port, and all identity/run/epoch/freshness/Sound/link/digest bindings pass without LAN/browser/file transfer. |
| Real final kernel ping request/reply | DEMO-01, DEMO-02, DEMO-04 | Fixture process results cannot prove the Linux kernel, TUN, FIPS routing, room acoustics, or remote kernel reply. | From Ready Role A, run one UI-triggered bounded system ping and inspect raw/structured result plus counter deltas on both named machines. |
| Physical interruption and normal reconnect | FIPS-05 | Fake timers prove ordering, not real loss, browser replacement, codec recovery, or room timing. | Interrupt until disarm/degraded, restore, and verify fresh acoustic heartbeat plus normal FIPS re-authentication without restart/failover. |

If hardware is absent or any record is missing/mismatched/nonphysical, the
result is `human_needed`. No automated result may substitute for these gates.

## Multi-Source Coverage Audit

| Source | ID | Feature / constraint | Plan | Status |
|---|---|---|---|---|
| GOAL | — | Real authenticated Sound-only kernel IPv6 request/reply | 01, 03, 05 | COVERED |
| REQ | FIPS-04 | Normal authenticated encrypted Sound peer | 01, 03, 05 | COVERED |
| REQ | FIPS-05 | Heartbeat survival and bounded normal reconnect | 03, 05 | COVERED |
| REQ | DEPLOY-03 | B has only Sound | 02, 05 | COVERED |
| REQ | DEPLOY-04 | A participant/wider-mesh posture | 02, 05 | COVERED |
| REQ | DEPLOY-05 | Local-only browser bridge | 02, 05 | COVERED |
| REQ | DEMO-01 | Real in-namespace kernel ping | 01, 03, 05 | COVERED |
| REQ | DEMO-02 | Real return echo across Sound | 01, 03, 05 | COVERED |
| REQ | DEMO-03 | Visible peer/link/transport/isolation | 03, 04, 05 | COVERED |
| REQ | DEMO-04 | Visible counter correlation | 03, 04, 05 | COVERED |
| REQ | CONFIG-04 | A participant policy; B local + Sound only | 02, 05 | COVERED |
| RESEARCH | R-IMAGE | Install iputils-ping and use bounded Node Unix-socket control client | 01 | COVERED |
| RESEARCH | R-SNAPSHOT | Join peers/links/transports as runtime authority | 01, 03 | COVERED |
| RESEARCH | R-ISOLATION | Config plus live B cardinality/Compose proof | 02 | COVERED |
| RESEARCH | R-ATTEST | Nonce-bound B isolation response over authenticated FIPS/Sound UDP | 02, 03, 05 | COVERED |
| RESEARCH | R-PING | Argument-array one-ping runner | 01, 03 | COVERED |
| RESEARCH | R-UI | Structured status and approved diagnostic UI | 03, 04 | COVERED |
| RESEARCH | R-RECOVERY | Disarm-first normal FIPS reconnect | 03, 05 | COVERED |
| CONTEXT | D-01 | Reuse normal FIPS auth/encryption/lifecycle | 01, 02, 03, 05 | COVERED |
| CONTEXT | D-02 | Exact Phase 3 readiness gate | 01, 03, 05 | COVERED |
| CONTEXT | D-03 | Disarm before loss; fresh normal reconnect | 03, 05 | COVERED |
| CONTEXT | D-04 | B sole Sound transport, live proof | 02, 05 | COVERED |
| CONTEXT | D-05 | Local-only bridge endpoints | 02, 03, 05 | COVERED |
| CONTEXT | D-06 | A participant optional upstream, role-only selection | 02 | COVERED |
| CONTEXT | D-07 | Fixed identity/address; no public nsec | 02, 04 | COVERED |
| CONTEXT | D-08 | Real kernel ping in A FIPS namespace | 01, 03, 05 | COVERED |
| CONTEXT | D-09 | Fixtures never satisfy acceptance | 01, 03, 05 | COVERED |
| CONTEXT | D-10 | All gates must agree before ping | 01, 03, 04, 05 | COVERED |
| CONTEXT | D-11 | One bounded no-restart recovery path | 03, 05 | COVERED |
| CONTEXT | D-12 | Structured observed proof facts/counters | 01, 03, 04, 05 | COVERED |
| CONTEXT | D-13 | Strict evidence classes/human_needed | 01, 03, 04, 05 | COVERED |
| CONTEXT | D-14 | One success and one reconnect; Phase 5 rehearsal excluded | 03, 05 | COVERED |

Deferred Phase 5 launcher, no-scroll/presenter view, evidence-directory polish,
ten-ping tally, three cold starts, 60-second scoring, and rehearsal work are
excluded and are not audit gaps.

## Validation Sign-Off

- [x] Every Phase 4 requirement maps to a plan and executable behavior check.
- [x] Every implementation task has targeted automated feedback.
- [x] Physical claims remain explicit manual gates and cannot be fabricated.
- [x] UI-SPEC truths and tests are lifted into Plan 04-04.
- [x] No external API coverage artifact or schema migration is required.
- [x] Assumption delta records `transport kind` as `no-change`.
- [x] The research isolation open question is resolved with an in-band bounded UDP attestation; no paired file/LAN/browser path remains.
- [ ] Wave 0 test gaps are implemented and passing.
- [ ] Exact two-laptop Open-air ping/reconnect gate is approved.

**Planning approval:** 10 requirements covered, 0 missing; software Wave 0 and
physical acceptance remain pending execution.
