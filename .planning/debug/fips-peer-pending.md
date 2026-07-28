---
status: resolved
trigger: "Sound link established remains at peer proof pending and the gated image never appears"
created: 2026-07-28
updated: 2026-07-28
---

# Debug Session: FIPS peer remains pending after acoustic commit

## Symptoms

- Expected: image UI stays absent until an authenticated FIPS sound peer exists;
  then Node A shows the complete source and Node B progressively receives it.
- Actual: both dashboards say Sound link established indefinitely, proof status
  reports `peer_missing`, and the image remains correctly gated off.
- Reproduction: `npm run demo:staggered -- --first b --delay-ms 8000`.

## Current Focus

- hypothesis: confirmed — Role B's image receiver was given
  `demoConfig.fips.targetIpv6`, which is Role B's address for both roles,
  instead of the already-resolved address of Role A
- test: capture the image-transfer options created by the Role B production
  runner and require its trusted peer address to equal Role A's IPv6 address
- expecting: all six kernel-accepted UDP datagrams decode at Role B and
  reconstruct the exact supplied 96x34 raster
- next_action: complete — live transfer and exact raster hash verified

## Evidence

- timestamp: 2026-07-28
  observation: both live `/proof-status` responses report `peer_missing`.
- timestamp: 2026-07-28
  observation: both FIPS sound transports report `browser_ready:false`,
    `acoustic_ready:false`, while the dashboard still renders Sound link
    established.
- timestamp: 2026-07-28
  observation: Role A `/bridge-status` reports
    `acoustic_readiness_proof_invalid`; the server consumes a readiness
    capability before checking whether an identical READY proof was already
    accepted.
- timestamp: 2026-07-28
  observation: the capability message handler can send READY directly while
    `AcousticSessionAdapter.refresh()` independently sends the same proof.
- timestamp: 2026-07-28
  observation: the daemon's initial static peer attempt precedes browser arm;
    retry logs grow from 10 to 21 to 41 to 82 seconds.
- timestamp: 2026-07-28
  observation: live A entered acoustic_recovery_exhausted while B remained
    Ready; FIPS control showed no authenticated peers despite 50/48 transmitted
    sound-transport packets.
- timestamp: 2026-07-28
  observation: onHeartbeat sends B's bootstrap/recovery reply directly from the
    receive callback with no negotiated acoustic guard.
- timestamp: 2026-07-28
  observation: FAS1 Reset is encoded and validated but AcousticSession.receive
    never dispatches it; recovery exhaustion calls fail() permanently.
- timestamp: 2026-07-28
  observation: after peer authentication, Role B's kernel reported six
    `Udp6InDatagrams` with zero checksum, port, receive-buffer, or other UDP
    errors while `/image-transfer` remained empty.
- timestamp: 2026-07-28
  observation: the new production-runner regression failed with Role B's own
    `fd46:...:9c30` address where Role A's `fd69:...:5e4b` address was expected.
- timestamp: 2026-07-28
  observation: the corrected staggered live run progressively accepted bands
    at rows 0, 6, 12, 18, 24, and 30, completing all 34 rows at Role B.

## Eliminated

- Image rendering itself: it is intentionally gated on authenticated FIPS proof.
- Stale bridge container image: current runners expose `/image-transfer`.

## Resolution

- root_cause: Peer establishment had two independent blockers: duplicate READY
    handling could close the browser endpoint, and the sound transport rejected
    inbound connections at Role B. Once the peer was established, the image
    receiver still compared every datagram's real Role A source against Role
    B's own address because the runner passed `targetIpv6` instead of the
    resolved peer address.
- fix: Readiness replay for the accepted session/settings/capability is
    idempotent, the browser has one adapter-owned transition, the sound
    transport accepts the configured inbound peer, and Role A reconciles the
    fixed peer after bridge readiness. The image remains authentication-gated,
    is split into six MTU-safe bands, and Role B now trusts the resolved Role A
    IPv6 address.
- verification: typecheck, production build, 9 image-transfer tests, and all
    46 production-runner tests pass. The exact staggered command completed a
    live six-band transfer with both peers still authenticated and no bridge
    errors. Role B reconstructed 13,056 RGBA bytes with SHA-256
    `696ab5fa45b3cfcd7c4374d406b53c4101575ae92088eb7141742edc59216064`,
    exactly matching the supplied banner.
- files_changed:
    - apps/modem-ui/src/main.ts
    - packages/bridge/src/server.ts
    - packages/bridge/src/fips-control-client.ts
    - packages/bridge/src/fips-peer-reconciler.ts
    - packages/bridge/src/runner.ts
    - packages/bridge/src/image-transfer.ts
