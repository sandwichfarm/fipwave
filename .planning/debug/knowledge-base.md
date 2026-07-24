# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## autonomous-self-loop-idle — autonomous physical self-loop stalled before qualification
- **Date:** 2026-07-24
- **Error patterns:** `pages-loaded` absent, exact header locator timeout, audio settings accepted, qualification control absent, bridge_status_unavailable, local bridge disconnected
- **Root cause(s):** Three serial code-contract defects: exact automation matching coupled to role-description UI copy; exact post-arm matching coupled to explanatory delivery copy; runner `/bridge-status` emitted obsolete `browserAudio` values and an obsolete `acousticSession` key that the strict UI schema rejected.
- **Fix:** Added stable `data-*` readiness contracts for runner identity and accepted audio settings; changed bridge status projection to `armed`/`not-armed` and removed the obsolete key.
- **Files changed:** apps/modem-ui/src/main.ts, scripts/self-loop-smoke.mjs, apps/modem-ui/e2e/bridge-status.spec.ts, apps/modem-ui/e2e/quiet-runtime.spec.ts, packages/bridge/src/server.ts, packages/bridge/test/fips-packet-bridge.test.ts
- **Why not caught:** The physical smoke test had no regression coverage for its UI-copy selectors, and the runner/UI bridge-status schema was not exercised together by the existing server unit assertion.
- **Recurrence guard:** Playwright contracts for semantic readiness and configured post-arm bridge state; server status test rejects `acousticSession`; scoped revert-and-reconfirm documented in the resolved session.
- **Prevention:** Treat browser-copy waits as semantic UI contracts, not exact prose. Keep the status response's allowlisted key/value schema synchronized with `validateBridgeSnapshot`; test it through a configured production runner before relying on it in smoke automation.
---
