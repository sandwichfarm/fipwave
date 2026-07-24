# Phase 2 — FIPS Transport Surface Coverage

**Upstream:** `jmcorgan/fips` at `fc8ebd5a06d6f042c57f03107f403116365a16b4`
**Policy:** Full transport-surface coverage. No upstream transport capability may be omitted merely because the sound link is connectionless or statically configured.

| capability | decision | reason |
|---|---|---|
| Configuration | INTEGRATE | Add strict `TransportsConfig.sound` fields for loopback URL, peer, MTU and queue bounds; 02-07 rejects MTU below 1357 and codec/PCM/fragment/browser fields. |
| Construction | INTEGRATE | `Node::create_transports` constructs `SoundTransport` through the same path as other configured transports and stores it in `TransportHandle::Sound`; construction and node-start tests live in 02-07. |
| Start | INTEGRATE | `TransportHandle::start` starts the sound lifecycle worker and bounded local reconnect loop; lifecycle tests in 02-07 keep worker `Up` separate from browser readiness. |
| Stop | INTEGRATE | `TransportHandle::stop` cancels owned work, closes the local socket and clears queues without affecting unrelated transports; 02-07 tests cancellation. |
| Send | INTEGRATE | Normal FIPS send dispatch passes one complete opaque packet to `SoundTransport`; 02-01/02-07 test exact 1357-byte success plus oversize, disconnected and unarmed fail-closed behavior. |
| Receive injection | INTEGRATE | Inject one validated binary frame as `ReceivedPacket` through bounded `PacketTx`; 02-07 proves byte identity and no TUN/peer/routing bypass. |
| Identity / name / type / state | INTEGRATE | Delegate stable ID, `sound` name/type, lifecycle and browser readiness in every match; 02-07 tests keep `Up` distinct from an acoustic peer. |
| MTU / link MTU | INTEGRATE | Report/enforce configured link MTU at or above 1357, include it in pre-operational node MTU selection, and prove effective IPv6 MTU 1280 after the 77-byte FIPS overhead in 02-07. |
| Discovery | INTEGRATE | Implement the upstream discovery surface explicitly as static/no-ambient-discovery behavior; 02-07 returns no invented endpoints while Phase 3 negotiation remains below this boundary. |
| Connection policy | INTEGRATE | Accept only the configured sound peer address and reject arbitrary addresses; 02-07 tests configured and wrong targets while disconnected send remains fail-closed. |
| Congestion | INTEGRATE | Map disconnected, unarmed, full and expired local queues to bounded congestion/backpressure signals; 02-07/02-04 test that no unbounded or silently accepted send is reported. |
| Statistics | INTEGRATE | Count accepted TX/RX complete packets, rejects, overflows, disconnects and last safe error for the current epoch; 02-07/02-04 prove reset never promotes old-epoch values. |
| Control visibility | INTEGRATE | Normal control output lists sound lifecycle, browser readiness, MTU, congestion and safe counters without URLs/packet bytes; 02-07 snapshots and 02-06 UI prove it. |

## Cross-boundary invariants

- The FIPS-facing contract is complete opaque packets only. Codec names, PCM geometry, acoustic fragments, calibration, ARQ and waveform settings remain below/outside it.
- Browser and FIPS bulk payloads use validated binary FWAV frames. JSON is limited to bounded control/state messages.
- A local lifecycle worker is not an acoustic-peer claim. Phase 2 may report `Local bridge ready`, `Started`, or `Waiting for transport`; it may not report peer discovery, authenticated link, ping readiness or sound-link proof.
- Fixture and loopback tests remain non-physical evidence. Exact two-laptop Open-air delivery and exact-host TUN proof remain deferred.
