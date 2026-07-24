# Phase 2 — Multi-Source Coverage Audit

| Source | ID | Feature / constraint | Plan | Status | Notes |
|---|---|---|---|---|---|
| GOAL | — | Each role resolves from one configuration authority and FIPS exchanges complete opaque packets with an armed local browser through a bounded codec-neutral bridge. | 02-01–02-07 | COVERED | Tracer proves the bridge packet path; expansions complete provenance, transport, browser-modem integration, config, recovery, isolation and operator truth. |
| REQ | FIPS-01 | Pinned fork with configurable first-class sound transport. | 02-02, 02-07, 02-05 | COVERED | Mechanically isolated vendor provenance, normal construction and Docker runtime. |
| REQ | FIPS-02 | Normal start/stop/inspect/send/receive lifecycle for complete opaque packets. | 02-07, 02-06 | COVERED | All enum/`PacketTx` seams plus the armed browser boundary are executable. |
| REQ | FIPS-03 | Link MTU at least 1357 and effective IPv6 MTU at least 1280. | 02-01, 02-07, 02-05 | COVERED | Exact-boundary, node fallback and live container-state tests. |
| REQ | CODEC-01 | Complete-packet modem boundary is independent of codec implementation. | 02-01, 02-07, 02-04, 02-06 | COVERED | Rust and armed-browser adapters exchange opaque packets without codec/PCM/fragment fields. |
| REQ | WEB-04 | Binary WebSocket packet/PCM exchange without bulk JSON/base64. | 02-01, 02-04, 02-06 | COVERED | FWAV `FIPS_PACKET` relay reaches the armed production browser adapter in both directions. |
| REQ | WEB-05 | Validate type/size, bound queues and expose ready/disconnected/overflow/error. | 02-01, 02-04, 02-05, 02-06 | COVERED | Boundary, state, topology and rendering tests. |
| REQ | WEB-06 | One action resets and reconnects browser, modem, queues and epoch. | 02-04, 02-06 | COVERED | Backend acknowledgement plus browser recovery state. |
| REQ | CONFIG-02 | One validated authority for roles, identities, peers, ports, capabilities and defaults. | 02-01, 02-03 | COVERED | Typed resolver and safe public projection. |
| RESEARCH | R-01 | Vendor FIPS commit `fc8ebd5…` with provenance and exact Rust toolchain. | 02-02 | COVERED | Normal source snapshot plus `UPSTREAM.md`. |
| RESEARCH | R-02 | Use audited `tokio-tungstenite = "=0.30.0"` rather than hand-writing RFC 6455. | 02-02 | COVERED | Package Legitimacy Audit verdict is OK; lockfile remains committed. |
| RESEARCH | R-03 | Update config, construction and every `TransportHandle` delegation seam. | 02-07 | COVERED | `COVERAGE.md` is the 13/13 executor checklist. |
| RESEARCH | R-04 | Extend the existing FWAV/server epoch authority with packet endpoints and bounded queues. | 02-01, 02-04 | COVERED | Existing protocol/server are extended, not replaced. |
| RESEARCH | R-05 | Share the bridge network namespace and publish only the browser origin on host loopback. | 02-05 | COVERED | Source, rendered config and inspect assertions. |
| RESEARCH | R-06 | Treat worker-up, browser-ready and acoustic-peer state as different facts. | 02-07, 02-04, 02-06 | COVERED | Rust, bridge and real-browser tests preserve fail-closed readiness and the Phase 2 claim boundary. |
| RESEARCH | R-07 | Use Node 22.23.1 for authoritative Node validation. | 02-01, 02-03, 02-04, 02-06 | COVERED | Tasks activate/assert the pinned runtime before Node gates. |
| RESEARCH | R-08 | Create every Wave 0 test named by `02-VALIDATION.md`. | 02-01–02-07 | COVERED | Config, provenance, bridge, Rust, Compose, browser-adapter, reducer and UI tests are created before their owning implementation. |
| RESEARCH | R-09 | Prove the production browser runtime crosses the codec-neutral packet boundary only after successful arming. | 02-06 | COVERED | Unit plus real Playwright/WebSocket integration prove bidirectional byte identity and pre-arm/post-reset rejection. |
| RESEARCH | R-10 | Accept shared namespace provisionally, require automated engine smoke and fail closed on any mismatch. | 02-05 | COVERED | Resolved research decision is enforced by render, inspect and live reachability gates without a wider bind fallback. |
| RESEARCH | R-11 | Permit FIPS worker Up with separate browserReady false and reject traffic until armed. | 02-07, 02-04, 02-06 | COVERED | Resolved research decision is enforced at Rust, bridge and browser boundaries. |
| CONTEXT | C-01 | Resolver accepts only `a` or `b`; the public demo command with either role remains the later entry point. | 02-01, 02-03 | COVERED | Phase 2 exposes the typed resolver without claiming Phase 5 orchestration. |
| CONTEXT | C-02 | A/B nsecs, identities, peers, ports, capabilities, audio and timing defaults have one source. | 02-03 | COVERED | Private runtime object and deliberate public projection. |
| CONTEXT | C-03 | Disposable committed nsecs are labelled, replaceable once and never logged/rendered. | 02-03, 02-06 | COVERED | Negative disclosure tests cover JSON, DOM and errors. |
| CONTEXT | C-04 | Optional overrides layer over valid defaults; canonical demo requires none. | 02-03 | COVERED | Exact-schema override parser with fail-closed validation. |
| CONTEXT | C-05 | Pin exact FIPS commit and retain license/provenance. | 02-02 | COVERED | Immutable vendor snapshot and provenance checks. |
| CONTEXT | C-06 | Sound is first-class and does not bypass FIPS identity, encryption, routing, heartbeat or MTU. | 02-07 | COVERED | Normal `TransportHandle`/`PacketTx` paths only. |
| CONTEXT | C-07 | FIPS sends/receives complete opaque packets and reports MTU at least 1357. | 02-01, 02-07, 02-06 | COVERED | Rust, bridge and armed-browser byte-identity tests plus enforced MTU. |
| CONTEXT | C-08 | Codec, PCM, fragment and browser details do not leak into the FIPS interface. | 02-07, 02-06 | COVERED | Rust config/source and browser-adapter contract tests. |
| CONTEXT | C-09 | Preserve same-origin binary WebSocket and FWAV validation. | 02-01, 02-04, 02-06 | COVERED | Existing server/protocol paths reach the real browser adapter under production validation. |
| CONTEXT | C-10 | Bulk packet/PCM remains binary; JSON is bounded control/state only. | 02-01, 02-04, 02-06 | COVERED | Endpoint-role, payload-type and real browser byte-identity tests. |
| CONTEXT | C-11 | Every queue has byte/item/time limits and visible state. | 02-04, 02-06 | COVERED | Bidirectional bounds and safe projection. |
| CONTEXT | C-12 | Bridge host ports bind only to loopback. | 02-05 | COVERED | Static, rendered and runtime topology gates. |
| CONTEXT | C-13 | One reset advances epoch and clears browser, bridge, codec and transport work without stale completion. | 02-07, 02-04, 02-06 | COVERED | Rust, bridge and browser adapter generations share the reset authority and reject stale work. |
| CONTEXT | C-14 | Process ownership is explicit for later launch cleanup. | 02-03, 02-05 | COVERED | Runner/Compose handles own only the resources they create and expose bounded close/stop paths. |
| CONTEXT | C-15 | Configuration/state failures fail closed and remain actionable. | 02-03, 02-04, 02-06 | COVERED | Unsupported roles, secrets, ports, dependencies and unsafe state cannot arm. |
| CONTEXT | C-16 | Deterministic codec fixture tests do not weaken physical evidence classification. | 02-01, 02-04, 02-05 | COVERED | Tests retain Fixture/Loopback classification and never emit Open air. |

## Explicit exclusions (not gaps)

- Phase 3: bootstrap handshake, calibration, settings digest, ARQ, heartbeat degradation, profile negotiation and acoustic fragmentation.
- Phase 4: authenticated isolated-node peering, real kernel IPv6 ping and exact sound-only path proof.
- Phase 5: complete one-command orchestration, audience no-scroll dashboard, run artifacts and rehearsal.
- Exact two-laptop Open-air and exact-host TUN proof remain deferred verification and are not inferred from Phase 2 automation.
