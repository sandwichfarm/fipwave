---
phase: 3
slug: negotiate-and-deliver-reliable-acoustic-packets
status: verified
threats_open: 0
threats_total: 37
register_authored_at_plan_time: true
asvs_level: 1
block_on: high
created: 2026-07-24
---

# Phase 3 — Security

> Per-phase security contract for the negotiated acoustic session, the
> loopback browser bridge, and the vendored FIPS Sound transport boundary.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|---|---|---|
| FIPS semantic caller → aggregate transport | Trusted packet purpose becomes bounded scheduling metadata without parsing opaque packet bytes. | Complete FIPS packet bytes and `TrafficClass` |
| Rust Sound transport → local Node bridge | Binary FWAV frames cross an exact-schema loopback WebSocket boundary. | Packet, class, epoch, readiness, and admission frames |
| Node bridge → browser scheduler | The current browser owner receives complete packets and returns exact admission results. | Complete packets, bounded status, epoch/sequence-bound admission |
| Decoded Quiet bytes → FAS1 parser | Ambient or corrupt acoustic input reaches an allocation-sensitive parser. | Untrusted acoustic frame bytes |
| Acoustic peer → active session | Unauthenticated room traffic can attempt handshake, calibration, replay, and liveness transitions. | FAS1 units, identities, nonces, settings, heartbeats |
| Browser session → bridge/Rust readiness gate | Browser state determines whether FIPS packet flow may arm. | Current epoch, role, one-use capability, heartbeat fact |
| Fixture/evidence → operator | Deterministic evidence could otherwise be mistaken for physical open-air success. | Evidence class, bounded metrics, reason codes |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation / Evidence | Status |
|---|---|---|---|---|---|---|
| T-03-01-01 | Tampering | FWAV class metadata | high | mitigate | Exact enum validation on both Rust and bridge paths; opaque-byte/class preservation and unknown-class rejection tests. | closed |
| T-03-01-02 | Elevation of Privilege | ordinary data caller | high | mitigate | Unannotated traffic defaults to `Ordinary`; only narrow FIPS liveness producers assign elevated classes. | closed |
| T-03-01-03 | Information Disclosure | traffic classifier | high | mitigate | Classification carries source metadata only and never inspects or projects payload-derived fields. | closed |
| T-03-01-SC | Tampering | dependency surface | low | accept | No package was added; the change is confined to the provenance-locked vendored fork and audited workspace. | closed |
| T-03-02-01 | Tampering | FWAV class field | high | mitigate | Exact class parsing precedes queue mutation; malformed values are adversarially rejected. | closed |
| T-03-02-02 | Elevation of Privilege | browser scheduling metadata | high | mitigate | Only validated source-authored classes cross the bridge; no payload-derived promotion exists. | closed |
| T-03-02-03 | Spoofing | alternate laptop path | high | mitigate | Inter-process endpoints remain loopback-only; Compose and integration tests reject widened binds/listeners. | closed |
| T-03-02-04 | Denial of Service | bridge queues | high | mitigate | Item, byte, age, admission-attempt, and single-pending-owner bounds are enforced before retention. | closed |
| T-03-02-SC | Tampering | dependency surface | low | accept | No new package, service, or external API was introduced. | closed |
| T-03-03-01 | Tampering | FAS1 decoder | high | mitigate | Exact magic/version/type/flags/geometry/range/CRC validation occurs before allocation or state mutation. | closed |
| T-03-03-02 | Spoofing | profile identity | high | mitigate | Only exact mutually advertised, versioned, executable profile identifiers are accepted. | closed |
| T-03-03-03 | Denial of Service | fragment declarations | high | mitigate | Packet bytes, body bytes, fragment count, offsets, and safe-integer arithmetic are capped before allocation. | closed |
| T-03-03-04 | Repudiation | settings commit | medium | mitigate | Canonical directional settings and a full SHA-256 digest expose disagreement without claiming authentication. | closed |
| T-03-03-SC | Tampering | dependency surface | low | accept | CRC is local and SHA-256 uses Web Crypto; no dependency was installed. | closed |
| T-03-04-01 | Spoofing | bootstrap handshake | high | mitigate | Expected identities, complementary roles, both nonces, session ID, epoch, and legal state are bound and tested. | closed |
| T-03-04-02 | Tampering | calibration reports | high | mitigate | Only strict current-session numbered reports enter the complete observation ledger and deterministic selector. | closed |
| T-03-04-03 | Replay | COMMIT_ACK/heartbeat | high | mitigate | Current session, digest, sequence, acknowledgement, and subsequent heartbeat are required before readiness. | closed |
| T-03-04-04 | Denial of Service | calibration | high | mitigate | Candidate/probe/observation/timer/deadline bounds exhaust to an explicit safe error. | closed |
| T-03-04-05 | Repudiation | settings agreement | medium | mitigate | Both roles expose matching canonical settings digest plus explicit ACK and heartbeat facts. | closed |
| T-03-04-SC | Tampering | dependency surface | low | accept | The implementation uses TypeScript and existing browser primitives only. | closed |
| T-03-05-01 | Replay | delivered packet path | high | mitigate | Session-scoped packet IDs, bounded delivered history, packet-bound ACKs, and exact-once adapter tests reject replay. | closed |
| T-03-05-02 | Denial of Service | queues/reassembly/retries | high | mitigate | Item, byte, fragment, history, age, retry, and browser-admission attempt caps are enforced before retention. | closed |
| T-03-05-03 | Tampering | fragment assembly | high | mitigate | Packet ID/count/declared length/canonical geometry must agree before complete CRC-valid delivery. | closed |
| T-03-05-04 | Elevation of Privilege | priority scheduler | high | mitigate | The scheduler consumes only exact validated `TrafficClass` and fixed control/heartbeat/ordinary precedence. | closed |
| T-03-05-05 | Spoofing | recovery heartbeat | high | mitigate | Recovery requires current epoch/session/sequence and recommit before readiness can return. | closed |
| T-03-05-SC | Tampering | dependency surface | low | accept | No package or service was added. | closed |
| T-03-06-01 | Elevation of Privilege | readiness projection | high | mitigate | Audio settings alone cannot arm; exact one-use capability plus current heartbeat reaches the Rust gate. | closed |
| T-03-06-02 | Replay | stale arm/control | high | mitigate | Epoch, endpoint role, frame geometry, generation, browser ownership, and admission sequence are validated before mutation. | closed |
| T-03-06-03 | Denial of Service | reset/degraded queues | high | mitigate | Disarm is synchronous; pending admission and queues are bounded and invalidated on reset/disconnect/degrade. | closed |
| T-03-06-04 | Information Disclosure | readiness snapshot | medium | mitigate | Public status exposes allowlisted bounded scalars and reason codes only. | closed |
| T-03-06-SC | Tampering | dependency surface | low | accept | No dependency or external service changed. | closed |
| T-03-07-01 | Elevation of Privilege | main readiness wiring | high | mitigate | Ready emits only after matching commit and current heartbeat; every invalidation disarms first. | closed |
| T-03-07-02 | Replay | Quiet callbacks | high | mitigate | Epoch/generation guards surround asynchronous playback/receive completion; stale completion tests are green. | closed |
| T-03-07-03 | Repudiation | evidence class | high | mitigate | Deterministic seams are hard-labeled `Fixture`; only exact two-machine evidence may become `Open air`. | closed |
| T-03-07-04 | Information Disclosure | public acoustic status | medium | mitigate | Exact-schema status omits nsecs, nonces, raw units, packet bytes, and full digests. | closed |
| T-03-07-05 | Denial of Service | browser lifecycle | high | mitigate | One-unit codec serialization, owned cancellation, RESET-before-flush, session bounds, and visible terminal errors are tested. | closed |
| T-03-07-SC | Tampering | dependency surface | low | accept | Existing pinned Quiet and the audited toolchain are reused without dependency changes. | closed |

*All registered threats are closed. Accepted low-severity dependency-surface
risks are documented below; they do not count toward `threats_open`.*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---|---|---|---|---|
| AR-03-01 | T-03-01-SC | The pinned vendored FIPS fork remains part of the trusted demo supply chain; no new dependency was introduced. | Project plan | 2026-07-24 |
| AR-03-02 | T-03-02-SC | The bridge adds no external package, service, or network API. | Project plan | 2026-07-24 |
| AR-03-03 | T-03-03-SC | Local CRC and browser Web Crypto avoid a new codec/security dependency. | Project plan | 2026-07-24 |
| AR-03-04 | T-03-04-SC | Handshake/calibration logic uses existing TypeScript/browser primitives. | Project plan | 2026-07-24 |
| AR-03-05 | T-03-05-SC | ARQ and reassembly add no package or service. | Project plan | 2026-07-24 |
| AR-03-06 | T-03-06-SC | Readiness projection adds no dependency or external service. | Project plan | 2026-07-24 |
| AR-03-07 | T-03-07-SC | The existing pinned Quiet runtime remains the accepted physical codec dependency. | Project plan | 2026-07-24 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|---|---:|---:|---:|---|
| 2026-07-24 | 37 | 37 | 0 | GSD secure-phase, ASVS L1 |

Evidence used: the authored Phase 3 plan registers, all seven execution
summaries, the clean deep code review, the 16/16 Nyquist requirement map,
`npm run check` (247 unit tests and 12 browser tests), and 17 locked Rust Sound
tests. Physical acoustic evidence is not used to close software-boundary
threats and remains a separate manual gate.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-24.
