---
phase: 2
slug: configure-and-establish-the-codec-neutral-fips-bridge
audited: 2026-07-24
baseline: 02-UI-SPEC.md
screenshots: not-captured-no-persistent-dev-server
overall_score: 14/24
blocking_ui_spec_violations: 0
---

# Phase 2 — UI Review

**Audited:** 2026-07-24  
**Baseline:** approved `02-UI-SPEC.md`  
**Screenshots:** not captured — no persistent server was listening on ports 3000, 5173, or 8080 before the audit. Code inspection and the existing Playwright suite were used instead. `npm run test:browser -- apps/modem-ui/e2e/bridge-status.spec.ts` passed (2/2) under Node 22.23.1.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 2/4 | Ready/empty copy is close, but disconnected, overflow/rejection, and reset-failure copy do not meet the exact state contract. |
| 2. Visuals | 3/4 | The semantic bridge card is adjacent to operator controls and clearly bounded, but recovery and state focus are not consistently visible. |
| 3. Color | 2/4 | The prescribed bridge border is correct, but the non-contract `#38bdf8` replaces the declared accent for focus and controls. |
| 4. Typography | 2/4 | The UI does not use the contract’s exact four sizes: the page heading, labels, controls, and card padding remain browser/default or off-scale. |
| 5. Spacing | 3/4 | Responsive grid and 4px gaps are sound, but 18px card padding and 10px/6px/12px values violate the declared 4px scale. |
| 6. Experience Design | 2/4 | Validation, packet safety, and current-epoch reducer are strong; reset hides rather than disables its control and long-content backstops do not inject the required data. |

**Overall: 14/24**

No score is 1/4 and no current defect prevents the operator from completing the local bridge task, so there are **no BLOCKER UI-SPEC violations**. The warnings below should be resolved before treating the interface as a polished operational console.

---

## Top 3 Priority Fixes

1. **Keep `Reset and reconnect` visible and disabled while reset is in flight, then render the documented failure/retry copy.** — The recovery focal point disappears exactly when the operator needs confirmation. — Render the same native button with `disabled`, retain its consequence text, attach `aria-busy="true"` to the live status region, and display `Reset and reconnect failed: {safe reason}` on failure.
2. **Implement and test the complete state-copy matrix.** — Disconnected and queue-failure states currently look like a generic “not connected”/queue label instead of telling the operator what happened and what to do. — Render the exact disconnected and overflow/rejected strings from the contract, including safe reason/timestamp and stale `Previous epoch` counter labels.
3. **Normalize CSS to the approved tokens.** — The visible system drifts from the specified color, typography, and spacing contract despite having a good structural foundation. — Use `#0ea5e9` for focus/control accent, 28/18/16/14px type roles, and 4px-scale spacing (including 16px or 24px card padding).

---

## Detailed Findings

### Pillar 1: Copywriting (2/4)

- **WARNING — incomplete state-copy contract.** The card does render the approved loading, ready, empty, reset consequence, and Phase-2 claim-fence text, but it collapses every non-ready bridge state to `Local bridge: not connected` ([main.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/main.ts:561)). It does not render the required disconnected sentence, overflow/rejection sentence, or reset-failure sentence with safe reason.
- **WARNING — recovery wording diverges.** The audio failure path says `Reset / re-arm` ([main.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/main.ts:529)) and the reset catch retains the same legacy phrase ([main.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/main.ts:803)), rather than the single exact recovery action and failure copy.
- **WARNING — stale counter wording is absent.** TX/RX is always rendered as live `TX complete packets`/`RX complete packets` ([main.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/main.ts:568)); the required `Previous epoch: {n}` label is never used when `BridgeState.stale` is true.

### Pillar 2: Visuals (3/4)

- **WARNING — recovery focal point is lost during reset.** The layout puts the operator card and correctly accented bridge card first in the desktop grid ([main.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/main.ts:523), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:8)), but requesting/resetting replaces the recovery action with a disabled `Arm modem` button ([main.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/main.ts:539)). This conflicts with the contract’s recovery focal point.
- **WARNING — missing status role.** The header’s concise state is only an ordinary paragraph ([main.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/main.ts:518)); it has neither `role="status"` nor a bridge-state phrase. The bridge announcement uses `aria-live`, which is helpful, but does not fully satisfy the specified header status contract.
- The bridge surface is otherwise structurally strong: it appears directly after the operator section in DOM order, uses a native semantic `<dl>`, text-plus-dot statuses, and preserves the diagnostic cards ([main.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/main.ts:555)).

### Pillar 3: Color (2/4)

- **WARNING — accent-token drift.** The declared `#0ea5e9` bridge border and primary action exist, but `#38bdf8` is used for the qualification border, button border, input border, and both focus outlines ([style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:11), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:13), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:15), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:17)). The UI-SPEC reserves `#0ea5e9` for primary action, focus outline, bridge border, and selected diagnostic control.
- **WARNING — 60/30/10 is not demonstrably enforced.** The dominant/secondary backgrounds are correct (`#0f172a` and `#172554`), but additional blues are visually prominent and no token layer protects the accent reservation. This makes future accidental color overuse likely.

### Pillar 4: Typography (2/4)

- **WARNING — exact type scale is not implemented.** The page heading has browser-default `h1` sizing rather than 28px; `h2` is 1.1rem (17.6px rather than 18px); labels (`dt`) and button text inherit 16px rather than the required 14px ([style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:5), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:13), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:18)).
- **WARNING — extra ad-hoc scale.** The countdown uses 1.3rem and bridge empty heading uses 1rem ([style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:10), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:11)), exceeding the contract’s four-size system.
- Monospace is correctly assigned to telemetry/table content and bridge values, preserving scanability for epochs, counters, and MTU ([style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:6)).

### Pillar 5: Spacing (3/4)

- **WARNING — non-token spacing.** The card’s 18px padding, 10px button padding, 6px radii, 12px sticky offset, and mobile 5px button margin are not multiples of 4 ([style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:9), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:12), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:13), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:20)).
- The primary responsive rules meet the contract: desktop page padding is 24px, card/grid gap is 16px, mobile moves to one column with 16px page padding and full-width buttons ([style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:4), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:8), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:20)).

### Pillar 6: Experience Design (2/4)

- **WARNING — reset in-flight control is removed, not disabled.** The contract calls for the recovery button to remain visible, disabled, and associated with an `aria-busy` status region. During `requesting`, only disabled `Arm modem` is rendered; `Reset and reconnect` is absent ([main.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/main.ts:539)). The live bridge announcement does set `aria-busy`, but the recovery affordance is not retained ([main.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/main.ts:577)).
- **WARNING — long-text browser backstop is incomplete.** The claimed long-content test never supplies a 240-character safe error, an unusually long public label, corpus IDs, or wide table values; it only checks an initially empty 320px page ([bridge-status.spec.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/e2e/bridge-status.spec.ts:17)). The code has wrapping and corpus horizontal scrolling, but the required adversarial proof is missing.
- **WARNING — configuration failure is rendered from an unbounded fetch error.** `configFailure` is assigned from a raw exception and inserted into visible UI ([main.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/main.ts:535), [main.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/main.ts:811)), bypassing the bridge reducer’s 240-character single-line safe-error policy.
- Strong counter-evidence: snapshots are exact-schema validated, unknown/secret-bearing fields fail closed, MTU below 1357 is rejected, and reset acknowledgement prevents stale snapshots from restoring state ([bridge-state.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/bridge-state.ts:33), [bridge-state.ts](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/bridge-state.ts:43)). Native controls have visible focus and 44px button height ([style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:13), [style.css](/Users/sandwich/Develop/fipwave/apps/modem-ui/src/style.css:15)).

---

## Registry Safety

Skipped: `components.json` is absent, the approved UI-SPEC permits no registry blocks, and this is a vanilla TypeScript DOM application.

---

## Files Audited

- `02-CONTEXT.md`, `02-UI-SPEC.md`, `02-REVIEW.md`, `02-SECURITY.md`
- `02-01` through `02-07` plans and summaries
- `apps/modem-ui/src/main.ts`, `style.css`, `bridge-state.ts`, `bridge-state.test.ts`, `fips-packet-adapter.ts`
- `apps/modem-ui/e2e/bridge-status.spec.ts`, `fips-packet-bridge.spec.ts`
- `package.json`, `playwright.config.ts`
