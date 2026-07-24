---
phase: 02-configure-and-establish-the-codec-neutral-fips-bridge
plan: "06"
subsystem: modem-ui
tags: [browser, websocket, fips, reducer, accessibility]
requires:
  - phase: 02-07
    provides: FIPS sound worker endpoint and packet lifecycle
  - phase: 02-04
    provides: bounded local bridge service
provides:
  - armed complete-packet browser adapter
  - epoch-safe validated bridge state reducer
  - local-only bridge/FIPS operational card
affects: [phase-03, phase-04, demo-ui]
tech-stack:
  added: []
  patterns: [complete-opaque-packets, strict-snapshot-validation, native-definition-list]
key-files:
  created: [apps/modem-ui/src/fips-packet-adapter.ts, apps/modem-ui/src/fips-packet-adapter.test.ts, apps/modem-ui/src/bridge-state.ts, apps/modem-ui/src/bridge-state.test.ts, apps/modem-ui/e2e/fips-packet-bridge.spec.ts, apps/modem-ui/e2e/bridge-status.spec.ts]
  modified: [apps/modem-ui/src/main.ts, apps/modem-ui/src/style.css]
key-decisions:
  - "The browser boundary accepts and emits only complete opaque FIPS_PACKET bytes for an armed epoch/generation."
  - "The UI reports local bridge/FIPS transport facts only and never infers acoustic-peer or ping readiness."
requirements-completed: [CODEC-01, WEB-04, WEB-05, WEB-06, CONFIG-02, FIPS-02, FIPS-03]
metrics:
  duration: 10min
  completed: 2026-07-24
status: complete
---

# Phase 02 Plan 06: Armed Browser Packet Boundary and Local Status Summary

**The built production browser now exchanges complete FIPS packets byte-for-byte with the real local WebSocket bridge only after arming, while an epoch-safe card presents local transport truth and recovery.**

## Accomplishments

- Added the codec-neutral `FipsPacketAdapter`, including arm/invalidate lifecycle gates and opaque byte copying.
- Wired FWAV FIPS_PACKET type 9 through the armed browser path; stale, unarmed, reset, and disconnected paths fail closed.
- Added strict bounded snapshot validation and reset acknowledgement reducer behavior.
- Added the semantic Bridge and FIPS transport card, exact recovery copy, responsive definition-list styling, and local-only claim fencing.
- Exercised the built production page against a real owned runner and `/bridge/fips` peer for bidirectional byte identity.

## Task Commits

1. **Task 1: Wire complete FIPS packets through the armed browser modem boundary**
   - `9aa3319` test: failing adapter coverage
   - `ddf9662` feat: complete FIPS packet adapter
   - `a8172dc` feat: armed FWAV browser boundary
   - `005acb8`, `9f8039b` test/fix: production runner and real FIPS WebSocket proof
2. **Task 2: Validate bridge snapshots and drive every recovery state**
   - `9a52646` test: failing bridge state coverage
   - `922a99c` feat: validated epoch-safe reducer
3. **Task 3: Render the approved compact operational card and all UI backstops**
   - `602cd47` test: failing bridge status coverage
   - `4d35ab3` feat: local bridge/FIPS status card

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used Docker/runner-equivalent Host WebSocket semantics in the browser proof**
- **Found during:** Task 1 browser verification
- **Issue:** A browser-only fake WebSocket would not prove the production runtime boundary.
- **Fix:** The Playwright test builds the UI, starts an owned local production runner, and connects a real `/bridge/fips` peer before asserting both byte directions.
- **Committed in:** `005acb8`, `9f8039b`

## Known Stubs

None.

## Verification

- `npm run typecheck`
- `vitest run apps/modem-ui/src/fips-packet-adapter.test.ts apps/modem-ui/src/bridge-state.test.ts apps/modem-ui/src/audio.test.ts` — 33 passing tests.
- `npm run test:browser -- apps/modem-ui/e2e/fips-packet-bridge.spec.ts apps/modem-ui/e2e/bridge-status.spec.ts` — 3 passing browser tests.
- `npm run build`

## Self-Check: PASSED

All eight plan files and every listed task commit exist in the repository.
