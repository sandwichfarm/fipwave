---
phase: 03-negotiate-and-deliver-reliable-acoustic-packets
plan: "02"
subsystem: bridge-browser-packet-boundary
tags: [typescript, fwav, fips, traffic-class, websocket]
requires:
  - phase: 03-01
    provides: Rust-authored `TrafficClass` discriminants in FWAV byte 6
provides:
  - Strict TypeScript `FipsTrafficClass` FWAV validation
  - Class-preserving bounded local bridge delivery
  - Browser `FipsPacketEnvelope` callback boundary with copied opaque bytes
affects: [acoustic-scheduler, acoustic-session, fips-readiness]
tech-stack:
  added: []
  patterns: [opaque-packet-envelope, fixed-header-metadata, fail-closed-lifecycle]
key-files:
  created: []
  modified:
    - packages/bridge/src/protocol.ts
    - packages/bridge/test/fips-packet-bridge.test.ts
    - apps/modem-ui/src/fips-packet-adapter.ts
    - apps/modem-ui/src/fips-packet-adapter.test.ts
    - apps/modem-ui/src/main.ts
decisions:
  - FWAV byte 6 carries only `Control=1`, `Heartbeat=2`, or `Ordinary=3` for FIPS_PACKET; byte 7 remains zero.
  - The browser adapter exposes copied complete bytes plus explicit source-authored metadata and defaults legacy byte-only sends to Ordinary.
metrics:
  duration: "~10 minutes"
  completed: 2026-07-24
  tasks_completed: 2
  files_modified: 5
status: complete
---

# Phase 3 Plan 2: Classified Opaque Bridge Delivery Summary

Validated FIPS priority metadata now survives the fixed FWAV frame, bounded loopback bridge, and real browser composition boundary beside byte-identical opaque packet bytes.

## Tasks Completed

1. **Preserve TrafficClass through FWAV and the bounded bridge**
   - Added exact Rust-compatible `FipsTrafficClass` discriminants and strict FIPS-only header validation.
   - Kept FIPS packets opaque and defaulted older unclassified frame creation to `Ordinary`.
   - Proved all three classes travel in both local bridge directions and invalid class input cannot advance packet counters or queues.
   - Commits: `f7e4262`, `4cebce4`.

2. **Deliver class and complete bytes through FipsPacketAdapter**
   - Replaced byte-only adapter callbacks with frozen `FipsPacketEnvelope` values containing copied bytes and validated class metadata.
   - Preserved fail-closed armed epoch/generation checks and legacy outbound `Ordinary` compatibility.
   - Updated browser FWAV composition to encode/decode byte 6 and reject noncanonical or unknown class metadata before adapter delivery.
   - Commits: `61f7759`, `5ab22e3`.

## Verification

- `vitest run apps/modem-ui/src/fips-packet-adapter.test.ts packages/bridge/test/fips-packet-bridge.test.ts` — passed, 13 tests.
- `npm run typecheck` — passed under Node 22.
- `npm run build` — passed; server TypeScript and Vite browser production build completed.
- `git diff --check` — passed.
- Source scan confirmed no packet payload parser, JSON/base64 packet path, new WebSocket listener, or alternate network endpoint was introduced.

## Decisions Made

- `FipsTrafficClass` is validated at every binary parser boundary and is never inferred from packet ciphertext or content.
- `FipsPacketAdapter` knows only complete bytes and one scalar class; it has no FAS1, codec, PCM, profile, or retry logic.
- Browser-originated byte-only sends remain valid and use the explicit `Ordinary` compatibility default.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 3 - Blocking composition omission] Updated the real browser FWAV composition boundary**
   - **Found during:** Task 2.
   - **Issue:** The plan declared only the adapter files, but `apps/modem-ui/src/main.ts` still serialized byte 6 as zero and passed byte-only packets to the adapter. Changing only the adapter would have left the browser path disconnected from the new metadata contract.
   - **Fix:** Added the minimal `main.ts` encode/decode and envelope wiring, with exact class validation, zero reserved byte validation, and no transport or UI expansion.
   - **Files modified:** `apps/modem-ui/src/main.ts`.
   - **Verification:** Focused bridge/adapter tests, strict typecheck, and production browser build pass.
   - **Commit:** `5ab22e3`.

**Total deviations:** 1 auto-fixed (Rule 3). **Impact:** Completes the planned LINK-08 source trace at the actual browser composition boundary without adding an alternate path.

## Known Stubs

None. This plan adds no placeholders, skipped tests, or mock transport route.

## Self-Check: PASSED

- All five modified production/test files exist.
- Task commits `f7e4262`, `4cebce4`, `61f7759`, and `5ab22e3` exist in git history.
- Focused tests, typecheck, and production browser build passed after the final implementation commit.
