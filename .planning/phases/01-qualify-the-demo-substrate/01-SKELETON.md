# Walking Skeleton — FIPS over Sound

**Phase:** 1
**Generated:** 2026-07-23

## Capability Proven End-to-End

> A demo operator can arm the local browser, send one codec-neutral binary qualification case through the loopback-only bridge, and read the resulting canonical JSON evidence while the same repository exposes a reproducible Docker/TUN preflight.

The exact two-laptop open-air codec result and the exact-host TUN result remain
explicit hardware evidence. Fixture, loopback, and static Compose checks prove
the substrate and its decision logic; they do not prove the physical link.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Vite 8 + TypeScript 6 on pinned Node 22 | Produces one Chromium-ready operator surface with a fast local build and no component-system overhead. |
| Browser audio | Web Audio + `getUserMedia` + `AudioWorklet` | Keeps microphone permissions, actual applied settings, capture, and scheduled playback in the browser per D-01 through D-04. |
| Local bridge | `ws` binary WebSocket bound to loopback | Carries codec-neutral control and PCM without creating an alternate inter-laptop path per D-09 through D-11. |
| Data layer | Canonical, schema-validated JSON reports under `.artifacts/qualification/` | Qualification evidence is append-on-run, portable, human-auditable, and consumed as files by later phases. A database is intentionally absent because there is no shared mutable application state, query workload, user identity, or long-lived service to justify one. |
| Auth | None; localhost-only operator tool | No external user or remote service is in scope. Loopback binding and origin validation are the trust-boundary controls. |
| Deployment target | Local production browser build plus Docker Compose preflight | The demo must run on the exact laptops; the meaningful deployment is a pinned, reproducible local command rather than a remote environment. |
| Directory layout | `apps/modem-ui`, `packages/bridge`, `fixtures`, `scripts`, `docker` | Separates browser I/O, codec-neutral bridge/report contracts, deterministic evidence, operator commands, and container preflight. |

## Stack Touched in Phase 1

- [ ] Plan 01-01 — pinned Node and autonomous machine-readable dependency audit.
- [ ] Plan 01-02 — audited Wave 0, local route, binary loopback tracer, and
      canonical JSON write/read.
- [ ] Plan 01-03 — one-action applied browser-audio preflight.
- [ ] Plan 01-04 — deterministic FWAV/report/corpus contracts.
- [ ] Plan 01-05 — codec-neutral gate, adapters, console, and verifier.
- [ ] Plan 01-06 — deterministic least-privilege Docker/TUN preflight.
- [ ] Plan 01-07 — sole exact-laptop open-air and exact-host evidence checkpoint.

## Out of Scope (Deferred to Later Slices)

- The FIPS transport implementation and fork integration belong to Phase 2.
- Acoustic fragmentation, reliability, retransmission, and half-duplex link
  control belong to Phase 3.
- The real sound-only FIPS peer, heartbeat, isolation proof, and kernel
  `ping -6` belong to Phase 4.
- Cold-start and recovery rehearsal targets belong to Phase 5.
- Near-ultrasonic operation, polished visualization, peer multiplexing, and
  deliberate-interference resistance remain deferred beyond the demo proof.

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without
replacing the browser-owned audio, codec-neutral local boundary, canonical JSON
evidence, or least-privilege Docker/TUN decisions:

- Phase 2: FIPS exchanges complete opaque packets with the armed browser modem.
- Phase 3: complete FIPS packets receive bounded reliable acoustic delivery.
- Phase 4: an isolated FIPS peer returns a real kernel IPv6 echo reply over sound.
- Phase 5: the exact two-laptop proof is frozen, checked, recovered, and rehearsed.
