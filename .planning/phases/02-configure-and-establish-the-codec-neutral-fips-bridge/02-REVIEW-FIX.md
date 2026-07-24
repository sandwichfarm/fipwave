---
phase: 02
fixed_at: 2026-07-24T03:25:24Z
review_path: .planning/phases/02-configure-and-establish-the-codec-neutral-fips-bridge/02-REVIEW.md
iteration: 2
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-07-24T03:25:24Z  
**Source review:** `.planning/phases/02-configure-and-establish-the-codec-neutral-fips-bridge/02-REVIEW.md`

## Iteration 2 Summary

- Findings in scope: 5
- Fixed: 5
- Skipped: 0

### CR-01: Effective TUN capability

**Commit:** `37b59e6`  
FIPS now runs as root with `cap_drop: ALL` and the sole effective `NET_ADMIN` capability. The runtime gate verifies UID 0, effective capability mask `0x1000`, `fips0`, MTU 1280, and the role-derived IPv6 address.

### CR-02: First-process bridge race

**Commit:** `0883ac1`  
The bridge binds before it atomically publishes the secret-bearing FIPS config. The clean-start test confirms the first FIPS process, not a manual restart, owns the sound connection.

### CR-03: Real demo peers

**Commit:** `1353e23`  
The fixed demo nsecs now use their real derived NIP-19 npubs. Each rendered config contains the opposite sound peer with `auto_connect` and auto-reconnect policy.

### WR-01: Private Docker listener contract

**Commit:** `c3b28b8`  
The unit suite now tests the intentional `0.0.0.0` listener inside Docker's private namespace while Compose remains loopback-published.

### WR-02: Honest runtime readiness

**Commit:** `c86f17c`  
The smoke test requires a first-process, non-degraded FIPS daemon, live Sound worker, usable TUN, and configured static peer. It explicitly does not claim open-air acoustic delivery or ICMPv6 ping, which still require browser/audio participation.

## Fixed Issues

| Finding | Commit | Applied fix |
| --- | --- | --- |
| CR-01 | `445cbcd`, `e553be3`, `9aacbba`, `73b504f`, `cc87db1` | Generate/mount role config, exec FIPS, build runtime codec inputs without cross-device cache moves, inspect the actual generated FIPS command, and allow the bridge to write the shared runtime config. |
| CR-02 | `b152868`, `ee43cef` | Remove the `socat` port split; serve the runner directly on the published origin while listening on `0.0.0.0` only inside Docker's private namespace. |
| CR-03 | `8fb1a70` | Send the strict loopback Origin from the Rust WebSocket request. |
| CR-04 | `ea1a844` | Relay current-epoch browser arm/disarm control to Rust and clear it on reset/disconnect. |
| CR-05 | `865022e` | Report a configured Sound peer as Connected only when worker + browser are ready. |
| CR-06 | `f1adc8d` | Parse and strictly validate exact loopback WS endpoint URLs. |
| WR-01 | `a045df7` | Enforce atomic outbound byte reservations alongside item capacity. |
| WR-02 | `a271f6c` | Render allowlisted `/bridge-status` facts instead of browser-local estimates. |

## Verification Evidence

- `npm run typecheck` and `npm run build` passed with Node 22.23.1.
- Focused bridge/config/topology tests passed.
- `cargo test --locked transport::sound::tests` passed: 7 tests.
- The Dockerfile now fetches/verifies codecs and builds Cyrinx entirely within its build filesystem, avoiding the prior cross-device cache rename without weakening integrity checks.
- Exact required runtime gate passed with Node 22.23.1: `npm run test:fips-compose:runtime -- --role a` returned `soundWorker: "connected"` after building the Compose stack. The smoke's own scope note remains: this proves local container topology, not physical open-air acoustic delivery or ping.
- Iteration 2 verification passed: Node 22 `npm test` (195/195), `npm run typecheck`, `npm run build`, targeted Rust Sound tests, and the full FIPS Rust library suite (1,598 tests).
- Clean exact role-A Compose smoke passed with first FIPS PID, effective `NET_ADMIN` only, `fips0` at MTU 1280 with `fd69:e08d:65cc:3a6b:9c2c:2ac4:bd40:5e4b`, a connected Sound worker, non-degraded daemon logs, and the configured role-B peer.

_Fixed: 2026-07-24T03:25:24Z_  
_Fixer: gsd-code-fixer · Iteration 2_
