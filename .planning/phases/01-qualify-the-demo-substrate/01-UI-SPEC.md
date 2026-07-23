---
phase: 1
slug: qualify-the-demo-substrate
status: approved
shadcn_initialized: false
preset: none
created: 2026-07-23
---

# Phase 1 — UI Design Contract

> Visual and interaction contract for the two-laptop modem qualification console. This is an operator tool for tomorrow's demo, not a marketing surface.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — manual CSS, because the new Vite/TypeScript surface has no established component system and the autonomous run declined shadcn initialization |
| Preset | not applicable |
| Component library | none; use semantic HTML controls, tables, `dialog`, and CSS |
| Icon library | none; pair every status dot with visible text |
| Font | system UI stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` for measurements; `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` otherwise |

The console must be visibly utilitarian: flat surfaces, strong section labels, data-forward cards, no gradients, illustration, waveform, spectrum, animation, or decorative audio motif. `prefers-reduced-motion` disables the remaining state-transition animation.

---

## Spacing Scale

Declared values (must be multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Status-dot/label gap, inline metadata |
| sm | 8px | Compact rows and button/icon padding |
| md | 16px | Default card padding and control spacing |
| lg | 24px | Card-to-card and section spacing |
| xl | 32px | Main two-column layout gap |
| 2xl | 48px | Major console section break |
| 3xl | 64px | Page top/bottom padding on wide screens |

Exceptions: every actionable control has a minimum 44px height and 44px pointer target; compact table controls may be 36px high only when they are not the sole way to perform an action.

---

## Typography

Use exactly these four sizes and two weights. Numeric evidence uses tabular figures.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body / table data | 14px | 400 | 1.5 |
| Label / control | 14px | 600 | 1.2 |
| Section heading | 20px | 600 | 1.2 |
| Page title / gate timer | 28px | 600 | 1.2 |

Never convey pass, fail, or pending through color or a dot alone: status text is required and the timer includes words as well as a number.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#0F172A` | Page background, primary surface, body text context |
| Secondary (30%) | `#1E293B` | Cards, table headers, inactive status strip, navigation-free shell |
| Accent (10%) | `#38BDF8` | Primary `Arm modem` button, keyboard focus ring, active filter, current gate step only |
| Destructive / failure | `#F87171` | Failed state border and text, failed gate result, `Reset / re-arm` only when recovering from failure |

Additional semantic state colors are fixed: pass `#4ADE80`, warning/elapsed `#FBBF24`, muted text `#CBD5E1`, and divider `#475569`. All foreground/background pairings must meet WCAG AA contrast (4.5:1 for normal text, 3:1 for controls and large text).

Accent reserved for: the primary `Arm modem` action, visible focus indicator, selected corpus filter, and the currently running qualification step. It is not a generic success color and is not used for pass badges.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | `Arm modem` |
| Ready follow-up CTA | `Start Cyrinx qualification` |
| Recovery CTA | `Reset / re-arm` |
| Idle state heading | `Modem is not armed` |
| Idle state body | `Arm this laptop to request microphone access, start audio, and verify the applied capture settings.` |
| Requesting state | `Requesting microphone and starting audio…` |
| Ready state | `Audio preflight passed on this laptop.` |
| Disconnected state | `Local bridge disconnected. Qualification is paused; no result is being inferred.` |
| Error state | `Audio preflight failed: {exact failing setting}. Check the device or browser permission, then Reset / re-arm.` |
| Corpus empty state heading | `No qualification cases yet` |
| Corpus empty state body | `Arm both laptops, then start the Cyrinx gate. Fixture results do not qualify the physical sound path.` |
| Docker empty state | `Docker/TUN preflight has not run on this laptop.` |
| Hard-deadline state | `Cyrinx window expired — start the Quiet fallback now. The Cyrinx spike cannot be extended.` |
| Unqualified state | `No codec qualified. Fixture or plumbing results do not prove an acoustic path.` |
| Destructive confirmation | none. `Reset / re-arm` clears only local browser/bridge queues and increments the epoch; it does not delete reports. Before executing, show inline text: `This starts a new local epoch and ignores stale results.` |

All dynamically inserted values are plain text, never HTML. `{exact failing setting}` names the observed field and actual value, for example `echo cancellation is enabled` or `capture channel count is 2, not 1`.

---

## Console Layout and Component Inventory

### Shell

Render the same single-page `Modem qualification` console on each laptop. Header shows: page title; machine identifier; Chromium version; current local epoch; and a text status badge (`Idle`, `Requesting`, `Ready`, `Failed`, or `Disconnected`). Do not add global navigation.

At 1024px and above, use a two-column grid: the left 40% is the sticky operator/control column and the right 60% is evidence and corpus results. At 1023px and below, use one column in this order: status/control, applied audio settings, gate, corpus table, Docker/TUN, report/selection. Do not require a side-by-side view of two laptops; each operator opens the same console locally and coordinates the explicitly labelled `A → B` and `B → A` cases.

### Operator/control card

The first card is the only place that arms the modem. It contains the primary button `Arm modem`, disabled only while the state is `requesting`; a one-line current-state message in an `aria-live="polite"` region; and the current local bridge status. On `ready`, replace the primary button with `Start Cyrinx qualification`; retain `Reset / re-arm` as a secondary outlined button. On `failed` or `disconnected`, `Reset / re-arm` is the only enabled recovery control.

Do not show an audio level meter, waveform, spectrum, codec profile picker, or arbitrary device selector. The profile is fixed by the current gate; browser device selection remains the browser's permission/device mechanism. This prevents the UI from suggesting unsupported tuning is part of qualification.

### Applied audio evidence card

Use a two-column key/value table with actual—not requested—values: microphone label (or `Unavailable`), permission, audio-context state, context sample rate, track sample rate, channel count, echo cancellation, noise suppression, automatic gain control, AudioWorklet status, and bridge endpoint (`localhost` only). Each value has `Pass`, `Fail`, or `Unknown` text.

`Unknown` is not pass. If any required value is unknown, incompatible, or processing is enabled, show the failure panel and do not reveal `Start Cyrinx qualification`. Include a concise requirement line: `Required: mono · 48 kHz-compatible · echo cancellation off · noise suppression off · auto gain control off.`

### Qualification gate card

Show a fixed, ordered six-step checklist:

1. `Cyrinx build and golden vectors`
2. `256 B and 1536 B fixture round trips`
3. `Browser PCM bridge loopback`
4. `Cold acquisition: A → B`
5. `Cold acquisition: B → A`
6. `Gate decision`

Before the first Cyrinx build, show `Cyrinx qualification has not started.` When started, begin an irreversible visible 90:00 countdown and an elapsed timer. The card always shows `Elapsed`, `Remaining`, current step, and gate-specific failures. At 00:00, stop Cyrinx case scheduling, label the card `Expired`, announce the hard-deadline copy, automatically set the decision to `Cyrinx rejected`, and expose one accent action `Start Quiet fallback qualification`. There is no extend, retry-Cyrinx, or manual pass control.

If Cyrinx misses any gate before expiry, stop its run immediately and present the same fallback action. Quiet runs the same six-step evidence sequence without a new Cyrinx countdown. Its fixed audible profile, browser version, volume, laptop spacing, fragment payload ceiling, and measured airtime appear as read-only report fields once known. `ggwave` may appear only as `Audio plumbing diagnostic`; it can never enable a selected-codec pass badge.

### Corpus results card

Render a compact summary above the table:

| Metric | Required Cyrinx/Quiet gate |
|--------|-----------------------------|
| 256-byte cases | at least 19 of 20 unique, byte-perfect, delivered exactly once in each direction |
| 1536-byte cases | 5 of 5 unique, byte-perfect, delivered exactly once in each direction |
| Acquisition | cold acquisition succeeds in both directions |
| Airtime | p95 complete-payload airtime is below one-third of the intended FIPS dead-link timeout |
| Audio and queues | applied audio preflight passes and queues remain inside bounds |

The table has one row per `(epoch, direction, case ID)` and columns: Result, case ID, direction, size, pattern, expected SHA-256 (shortened visually but full digest available in an accessible label), received SHA-256, acquisition, airtime, deliveries, evidence path, and reason. Direction labels are literal `A → B` and `B → A`; never use ambiguous `TX`/`RX` alone. Evidence path is one of `Fixture`, `Loopback`, or `Open air` and each row carries `Pending`, `Passed`, `Failed`, `Missing`, or `Duplicate` text.

Provide filters for all / 256 B / 1536 B / A → B / B → A / failed only. The default sort is active failures first, then pending, then case ID. Keep the full table horizontally scrollable inside its own region on narrow screens; do not truncate failure reasons or digests. A sticky first status column and descriptive table caption preserve orientation. A result only contributes to selection when its evidence path is `Open air` on the exact named laptop pair; fixture and loopback passes remain visibly labelled `not physical qualification`.

### Docker/TUN preflight card

Show a short state badge (`Not run`, `Checking`, `Passed`, `Failed`) and a read-only checklist for: pinned image, `/dev/net/tun` present, `NET_ADMIN` present, `Privileged: false`, `SYS_ADMIN: absent`, `no-new-privileges: true`, `fips-preflight0` created, IPv6 assigned, and cleanup complete. On failure, place the exact failed check and captured command exit/error in an expandable `<details>` panel. No green overall preflight badge until every item passes; it is independent from codec selection.

### Decision and report card

Show exactly one selection state: `Cyrinx selected`, `Quiet selected`, or `Unqualified`. It is `Unqualified` until both directions' open-air corpus requirements, cold acquisition, airtime, audio evidence, bounded queues, and Docker/TUN preflight pass for the selected fixed audible profile. Do not use `ready`, a green summary, or audience-facing language to imply physical qualification from fixtures.

Display the local report path and merged selection path as plain text: `.artifacts/qualification/{machine-id}.json` and `.artifacts/qualification/selection.json`. The JSON is canonical; the console is its readable projection. Show report completeness per laptop as `Missing`, `Recorded`, or `Included in selection`.

---

## State and Interaction Contract

| State | Visible status and data | Enabled controls | Transitions |
|-------|-------------------------|------------------|-------------|
| `idle` | `Modem is not armed`; settings values are `Not checked`; corpus is empty or prior epochs are labelled historical | `Arm modem` | `Arm modem` → `requesting` |
| `requesting` | `Requesting microphone and starting audio…`; show determinate checklist: permission, audio context, applied settings, worklet, local bridge | none | all checks pass → `ready`; permission/device/format/worklet error → `failed`; bridge loss → `disconnected` |
| `ready` | `Audio preflight passed on this laptop`; show applied values and local epoch | `Start Cyrinx qualification`, `Reset / re-arm` | start gate → gate running while remaining `ready`; bridge loss → `disconnected`; reset → `requesting` |
| `failed` | Exact failure panel, failing observed value, last successful step, and local epoch | `Reset / re-arm` only | reset → `requesting` |
| `disconnected` | `Local bridge disconnected. Qualification is paused; no result is being inferred.` Preserve evidence as stale/read-only | `Reset / re-arm` only | reset → `requesting`; never auto-resume or auto-count late results |

Reset closes media tracks, suspends/closes the audio context, clears bounded browser/bridge queues, increments the epoch, cancels active qualification scheduling, and preserves prior result rows as `Historical epoch {n}`. New results with an old epoch are ignored and logged as stale; they never update counters, selection, or gate progress.

Gate transitions are deterministic: a failed digest, duplicate delivery, missed required case, failed cold acquisition, queue-bound breach, incompatible audio, or missed airtime threshold rejects the current codec immediately. Timer expiry rejects Cyrinx only and routes to Quiet fallback. A Quiet failure or expired/missing required evidence routes to `Unqualified`; the console cannot override that decision.

---

## Accessibility and Responsive Behavior

- Use semantic `button`, `table`, `caption`, `thead`, `th scope`, `dl`, `details`, and `dialog`; no clickable non-button elements.
- Keep all keyboard focus visible with a 3px `#38BDF8` outline and 2px offset. Tab order follows the narrow-layout reading order.
- Announce arm state, permission failure, bridge disconnect, timer expiry, codec rejection, and final selection in a polite live region; use `aria-live="assertive"` only for timer expiry and hard qualification failure.
- Status badges include the text state and a non-color symbol. Failed check rows also name the expected and observed values.
- Tables retain headers while scrolling. Long device labels, error reasons, paths, and full hashes wrap at safe boundaries; numbers never clip. The card itself scrolls horizontally only for the corpus table.
- Minimum content width is 320px. At 320–1023px, controls occupy full width and table filtering remains above the scroll region. At 1024px+, operator controls remain visible while results scroll. The two laptops are operated independently; no UI interaction relies on a network connection between their browser pages.
- Respect `prefers-reduced-motion`; do not use flashing alerts or motion to signal audio activity. Do not autoplay audio: speaker playback is only scheduled after the explicit arm gesture and active qualification case.

---

## UI Considerations

Applicable state considerations resolved: 6 covered, 2 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | Corpus table, audio evidence, Docker/TUN checklist | ✅ covered | Empty corpus and Docker copy is specified; audio evidence renders `Not checked`, not fabricated settings. |
| loading | Arm flow, gate, Docker/TUN preflight | ✅ covered | `requesting`, `Checking`, and current gate step show progress and disable conflicting controls. |
| error | Audio settings, bridge, corpus, Docker/TUN | ✅ covered | Exact observed failure and a single recovery path are displayed; no error is silently collapsed into a pass. |
| populated | Applied settings, corpus table, readiness checklist | ✅ covered | Actual evidence values, case-level results, and complete preflight checklist form the normal state. |
| partial | Corpus and per-laptop reports | ✅ covered | Missing direction/case/evidence remains explicitly `Missing` or `Pending`; only `Open air` contributes to selection. |
| overflow | Corpus table, long evidence values | 🧪 backstop | At 320px, table has its own horizontal scroll with sticky result column; long text wraps rather than clips. Verify in a visual state test. |
| zero-one-many | Corpus table | ✅ covered | Zero uses documented empty copy; one and many retain one row per epoch/direction/case with stable counts. |
| long-text | Device labels, errors, paths, hashes, buttons | 🧪 backstop | Strings wrap at safe boundaries; full hash is exposed through accessible text. Verify with an unusually long device name and error. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| none | none | not applicable — no shadcn initialization and no third-party registry declared |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-07-23
