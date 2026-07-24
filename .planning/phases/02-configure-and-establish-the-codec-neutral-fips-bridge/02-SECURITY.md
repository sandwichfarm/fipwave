---
phase: 2
slug: configure-and-establish-the-codec-neutral-fips-bridge
status: verified
threats_open: 0
asvs_level: 1
block_on: high
created: 2026-07-24
verified: 2026-07-24
---

# Phase 2 — Security

Phase 2's planned STRIDE register was verified against the implemented
browser, bridge, vendored FIPS transport, configuration, and Compose
boundaries. All planned threats are closed. No risk was accepted or
transferred.

## Trust Boundaries

| Boundary | Description | Data crossing |
|---|---|---|
| Browser → local bridge | Untrusted browser frames, audio state, recovery commands, and status data enter the local service. | Binary FWAV frames and bounded scalar control state |
| Local bridge → FIPS SoundTransport | Local WebSocket traffic enters the trusted FIPS packet lifecycle. | Complete opaque FIPS packets and lifecycle control |
| Private config → public browser state | Disposable demo keys and internal settings must not cross into ordinary UI, logs, or errors. | Secret-bearing runtime config to allowlisted public scalars |
| Recovered epoch → stale work | Delayed frames, callbacks, and status responses may outlive reset. | Epoch, generation, sequence, queues, and counters |
| Host/LAN → Compose services | Published ports must not create an alternate packet path. | Browser HTTP/WebSocket only on host loopback |
| FIPS container → host kernel | FIPS needs TUN administration without broader container privilege. | `/dev/net/tun` and effective `NET_ADMIN` only |
| Vendored/registry inputs → executable build | Imported source and dependencies become trusted code. | Pinned source, npm/Cargo locks, container bases |

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Verified mitigation | Status |
|---|---|---|---|---|---|---|
| T-02-01 | Spoofing | Browser/endpoint ownership | high | mitigate | Loopback same-origin checks, approved paths, and one owner per endpoint role | closed |
| T-02-02 | Tampering / DoS | FWAV ingress | high | mitigate | Header geometry, type, size, epoch, sequence, and role validation before mutation | closed |
| T-02-03 | Information Disclosure | Public configuration | high | mitigate | Explicit allowlist excludes both disposable nsecs | closed |
| T-02-04 | Repudiation | Evidence classification | medium | mitigate | Local bridge evidence remains `Loopback` and non-physical | closed |
| T-02-05 | Tampering | Sound receive worker | high | mitigate | Canonical envelope, current epoch/arm, and strict monotonic sequence precede the sole `PacketTx` injection | closed |
| T-02-06 | Elevation of Privilege | FIPS transport integration | high | mitigate | Sound is constructed and dispatched only through normal `TransportHandle` and `PacketTx` paths | closed |
| T-02-07 | Denial of Service | Sound queues/reconnect | high | mitigate | Item, byte, and age bounds plus reset/disconnect draining and budget release | closed |
| T-02-08 | Spoofing | Sound peer policy | high | mitigate | Exact loopback URL and configured static peer; no ambient discovery | closed |
| T-02-09 | Information Disclosure | Sound control state | medium | mitigate | Scalar counters and safe error codes only; no URL or packet bytes | closed |
| T-02-10 | Spoofing | Role resolver | high | mitigate | Literal `a`/`b`, complementary derived identities, immutable result | closed |
| T-02-11 | Tampering | Optional overrides | high | mitigate | One authoritative bridge port; diverging browser/FIPS ports reject | closed |
| T-02-12 | Information Disclosure | Browser/log projection | high | mitigate | Safe public projection is the only runner/browser configuration surface | closed |
| T-02-13 | Denial of Service | Resource cleanup | medium | mitigate | Reverse-order, bounded, idempotent cleanup | closed |
| T-02-14 | Elevation of Privilege | Process ownership | high | mitigate | Only registered returned handles can be closed | closed |
| T-02-15 | Denial of Service | Packet bridge queues | high | mitigate | Failed/unavailable delivery is dropped explicitly and never replayed on reconnect | closed |
| T-02-16 | Tampering | Endpoint/frame validation | high | mitigate | Binary FIPS-only current-epoch frames are required before queue/counter mutation | closed |
| T-02-17 | Spoofing / Replay | Reset epoch | high | mitigate | One reset authority advances epoch and clears state before acknowledgement | closed |
| T-02-18 | Information Disclosure | Safe state/errors | high | mitigate | Bounded canonical errors and scalar state only | closed |
| T-02-19 | Repudiation | Accepted counters | medium | mitigate | Counters advance only after current-generation delivery succeeds | closed |
| T-02-20 | Spoofing / Elevation | Host publications | high | mitigate | One browser port bound to host `127.0.0.1`; FIPS publishes none | closed |
| T-02-21 | Elevation of Privilege | FIPS container | high | mitigate | `cap_drop: ALL`, effective `NET_ADMIN` only, TUN device, no privileged mode | closed |
| T-02-22 | Tampering | Generated role config | high | mitigate | Typed-authority config is written atomically with mode `0600` | closed |
| T-02-23 | Denial of Service | Compose smoke ownership | medium | mitigate | Unique project, bounded polling, argument arrays, and owned cleanup | closed |
| T-02-24 | Repudiation | Runtime evidence | medium | mitigate | Smoke output explicitly disclaims open-air delivery and ping | closed |
| T-02-25 | Tampering | Browser state reducer | high | mitigate | Partial/invalid state fails to explicit Unknown values | closed |
| T-02-26 | Information Disclosure | DOM/error rendering | high | mitigate | Only bounded canonical error strings pass; DOM uses text content | closed |
| T-02-27 | Spoofing | Readiness/MTU UI | high | mitigate | Invalid state has null MTU and unknown configuration; no derived defaults | closed |
| T-02-28 | Replay | Recovery callbacks/status | high | mitigate | All snapshots are ignored while resetting until exact next-epoch acknowledgement | closed |
| T-02-29 | Denial of Service | Long text/telemetry | medium | mitigate | Error bounds plus wrapping/scroll containment; no event feed | closed |
| T-02-30 | Tampering / Replay | Browser packet adapter | high | mitigate | Armed epoch/generation and packet-size gates; failure invalidates the adapter | closed |
| T-02-SC/01 | Tampering | Node dependency graph (02-01) | high | mitigate | Committed lockfile and dependency audit gate | closed |
| T-02-SC/02 | Tampering | Vendored FIPS import (02-02) | high | mitigate | Immutable upstream provenance and locked audited dependency | closed |
| T-02-SC/03 | Tampering | Node dependency graph (02-03) | high | mitigate | Committed lockfile and dependency audit gate | closed |
| T-02-SC/04 | Tampering | Node dependency graph (02-04) | high | mitigate | Committed lockfile and dependency audit gate | closed |
| T-02-SC/05 | Tampering | Container build inputs (02-05) | high | mitigate | Version-pinned images, `npm ci`, Cargo `--locked`, no mutable clone | closed |
| T-02-SC/06 | Tampering | Browser/container inputs (02-06) | high | mitigate | Version-pinned, lock-backed Docker and npm inputs | closed |
| T-02-SC/07 | Tampering | Sound dependency graph (02-07) | high | mitigate | Exact locked Cargo graph and documented local patch inventory | closed |

## Verification Evidence

- `npm run verify:dependencies` passed.
- Node 22.23.1 `npm test` passed: 199/199.
- `npm run typecheck` and `npm run build` passed.
- Browser status and production packet suites passed.
- `cargo test sound_ --locked` passed: 9/9.
- Full Rust regression passed after hardening: 1,599 tests.
- Role-A Compose runtime smoke passed with first-process FIPS, `fips0`,
  MTU 1280, effective `NET_ADMIN` only, a real configured peer, and local
  Sound worker readiness.

## Accepted Risks Log

No accepted risks.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run by |
|---|---:|---:|---:|---|
| 2026-07-24 | 33 | 25 | 8 | gsd-security-auditor, initial audit |
| 2026-07-24 | 37 | 37 | 0 | gsd-security-auditor, post-hardening re-audit |

The final count separates the seven per-plan supply-chain entries and the
four early Phase 2 transport/bridge threats, which were normalized from the
plan-local identifiers during re-audit.

## Sign-Off

- [x] All planned threats have a disposition.
- [x] No risks were accepted or transferred.
- [x] `threats_open: 0` confirmed at the configured `high` threshold.
- [x] `status: verified` set in frontmatter.

**Approval:** verified 2026-07-24.
