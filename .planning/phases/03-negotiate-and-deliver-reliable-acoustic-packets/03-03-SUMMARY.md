---
phase: 03-negotiate-and-deliver-reliable-acoustic-packets
plan: "03"
subsystem: acoustic-link
tags: [fas1, crc32c, quiet, calibration, configuration]
requires:
  - phase: 02-connect-fips-to-the-browser-bridge
    provides: complete opaque FWAV FIPS-packet boundary and centralized A/B configuration
provides:
  - strict FAS1 binary codec with bounded packet fragmentation geometry
  - executable versioned Quiet profile registry and canonical directional settings digest
  - validated demo bounds for calibration, ARQ, queueing, and delivery history
affects: [03-04, 03-05, 03-06, 03-07, 04-establish-fips-link]
tech_stack:
  added: []
  patterns: [validate-before-mutate, crc32c, canonical-binary-settings, exact-schema-config]
key_files:
  created:
    - apps/modem-ui/src/acoustic-protocol.ts
    - apps/modem-ui/src/acoustic-protocol.test.ts
  modified:
    - packages/bridge/src/demo-config.ts
    - packages/bridge/test/demo-config.test.ts
decisions:
  - FAS1 uses a fixed 36-byte little-endian header with CRC-32C and a 217-byte body cap.
  - The versioned quiet-audible-7k-v1 profile resolves to the same Quiet client path for transmit and receive.
  - Directional settings commit in a canonical A-to-B then B-to-A binary order and use SHA-256 only for disagreement detection.
metrics:
  duration: 8m
  completed: 2026-07-24
status: complete
---

# Phase 3 Plan 3: FAS1 Protocol and Settings Authority Summary

Strict FAS1 modem units now bound complete 1357-byte FIPS packets to a verified Quiet-safe frame geometry and a single validated directional settings model.

## Accomplishments

- Added a dependency-free FAS1 codec with exact 36-byte little-endian headers, CRC-32C, strict type-specific zero fields, and decode-before-return validation.
- Added pure 1357-byte fragmentation/reassembly helpers; maximum-body geometry produces exactly seven fragments.
- Added the executable `quiet-audible-7k-v1` profile registry, canonical binary A→B/B→A settings bytes, and a 32-byte Web Crypto SHA-256 digest.
- Centralized immutable protocol, calibration, ARQ, queue, and delivery-history limits in the A/B demo configuration; frequency/sample-rate/playback-speed input is rejected by exact-schema validation.

## Verification

- `vitest run apps/modem-ui/src/acoustic-protocol.test.ts packages/bridge/test/demo-config.test.ts` — 22 passed.
- `npm run typecheck` — passed under the required Node 22 prefix.
- Self-check confirmed all four plan files exist, all four 03-03 commits exist, and no implementation stubs were introduced.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Bug] Corrected the CRC protected-byte range**
   - **Found during:** Task 1
   - **Issue:** Initial encoder CRC construction accidentally included the CRC slot rather than joining header bytes 0–31 directly to the body.
   - **Fix:** Added a shared protected-byte helper used by both encode and decode.
   - **Files modified:** `apps/modem-ui/src/acoustic-protocol.ts`
   - **Verification:** Protocol round-trip and known CRC-32C vector pass.
   - **Commit:** `d4a9eb2`

2. **[Rule 2 - Critical validation] Re-signed hostile mutations before decoding**
   - **Found during:** Plan-level edge audit
   - **Issue:** Mutated headers initially failed only at CRC validation, leaving individual field validation unproven.
   - **Fix:** Tests now recompute CRC after each mutation so malformed magic, version, flags, session, packet, fragment, and length fields reach their specific decoder checks.
   - **Files modified:** `apps/modem-ui/src/acoustic-protocol.test.ts`
   - **Verification:** 22 focused tests pass.
   - **Commit:** `8ed022b`

**Total deviations:** 2 auto-fixed (1 bug, 1 critical validation gap). **Impact:** The wire decoder now proves both integrity and semantic validation independently.

## Decisions Made

- The modem profile is identified only by exact supported versioned IDs; no scalar frequency or Web Audio rate control can represent carrier negotiation.
- The calibrated playback gain candidate cannot exceed 2.0 and is encoded as integral thousandths in canonical settings bytes.
- Fixed caps are 217 body bytes, 1357 packet bytes, 16 fragments, 4-unit ARQ windows, 3 attempts, 4 queued packets, 32 delivered IDs, 3 candidates, 4 probes, and a 120-second calibration deadline.

## Self-Check: PASSED

