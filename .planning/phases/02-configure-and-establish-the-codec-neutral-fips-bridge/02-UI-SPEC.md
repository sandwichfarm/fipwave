---
phase: 2
slug: configure-and-establish-the-codec-neutral-fips-bridge
status: approved
shadcn_initialized: false
preset: none
created: 2026-07-24
---

# Phase 2 — UI Design Contract

> Visual and interaction contract for the configuration, local bridge, and recovery surface. It extends the existing modem qualification console; it does not create the Phase 5 demo dashboard.

---

## Scope and Interaction Boundary

- Keep the existing vanilla TypeScript DOM renderer and `style.css` console. Do not introduce React, shadcn, Tailwind, a component registry, a chart library, or a new visual theme in this phase.
- Add one compact **Bridge and FIPS transport** card immediately after the existing operator-control card. Its purpose is operational truth while the local bridge is being armed, connected, reset, or rejected.
- The operator state and primary action are the focal point while idle or
  arming. During recovery, the Bridge and FIPS transport status plus
  `Reset and reconnect` become the focal point; diagnostic tables remain
  visually subordinate.
- The card shows only: validated role (`A` or `B`), configuration status, browser-audio status, local bridge status, FIPS sound-transport lifecycle status, current epoch, queue health, last accepted/error timestamp, TX/RX complete-packet counters, and advertised transport MTU.
- A successful Phase 2 state is **local bridge ready**, not acoustic peer discovery, calibration, negotiation, FIPS peer authentication, or ping success. Never label it “connected to peer,” “ready for ping,” or “sound link established.” Those are Phase 3–5 claims.
- Render the MTU as `Sound MTU: {n} bytes · effective IPv6 MTU: {n - 77} bytes`; show the effective value only when the source value is a validated integer. A value below 1357 is a failure, never a degraded success.
- Keep detailed qualification, audio evidence, and packet diagnostics in the existing diagnostic document flow. Phase 2 does **not** promise the no-scroll, audience-facing presentation required in Phase 5.
- Never render packet bytes, PCM samples, private nsecs, authorization material, full configuration documents, or raw WebSocket payloads. Render validated scalar summaries and a bounded, sanitized error code/message only.

### Required state model

| State | Visible status text | Controls and behavior |
|-------|---------------------|-----------------------|
| Configuration loading | `Loading local configuration…` | Disable the primary control. Do not show role, ports, or transport values until validation completes. |
| Configuration invalid | `Configuration unavailable` plus the safe validation reason | No arm/send controls. Offer `Reset and reconnect` only when a local bridge exists; it must not manufacture defaults. |
| Idle | `Modem is not armed` and `Local bridge: not connected` | Primary CTA is enabled after valid configuration is present. |
| Arming / connecting | `Requesting microphone and connecting local bridge…` | Disable all controls except browser-native permission handling. Show a textual in-progress label; do not use an indefinite spinner alone. |
| Bridge ready | `Local bridge ready · epoch {n}` | Show `Arm modem` success, queue health `Clear`, transport lifecycle `Started` or `Waiting for transport`, and actual MTU value when reported. |
| Disconnected | `Local bridge disconnected` plus last safe reason and timestamp | Keep the last known epoch marked `stale`. Primary recovery is available. Counters may remain visible but are labelled `previous epoch`; they are not live data. |
| Overflow / rejected frame | `Bridge queue limit reached; the frame was rejected` or `Bridge rejected an invalid frame` | Mark queue health `Overflow`/`Rejected`; do not increment accepted TX/RX counts. Make recovery prominent. |
| Resetting | `Resetting local session…` | Disable controls. Clear volatile browser, codec, bridge, and transport queue indicators only after reset acknowledgement. |
| Recovered | `Local bridge ready · epoch {n}` | Announce the new epoch, reset counters to zero, clear last error, and restore normal controls. Stale callbacks or completions must not change this state. |

### Recovery contract

- The single recovery control is labelled **`Reset and reconnect`**. It advances the epoch and resets browser audio/modem state, bridge queues, and the local transport session.
- Reset is immediate and needs no confirmation because it never deletes persisted configuration, identities, or evidence. Its consequence text is always visible: `Starts a new local epoch and clears unsent local bridge data.`
- While reset is in flight, the button is disabled, exposes `aria-busy="true"` on the status region, and the status region announces `Resetting local session…`.
- If reset fails or times out, retain the prior error as `Last error`, render `Reset and reconnect failed: {safe reason}`, and leave the same recovery control enabled for a retry.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — existing hand-authored CSS |
| Preset | not applicable; no `components.json` exists and this Vite application is not React |
| Component library | none; native semantic HTML elements built by the existing DOM renderer |
| Icon library | none; status uses text plus a small colored dot, never a color-only indicator |
| Font | system UI for prose; `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` for counters, epochs, MTU, ports, and error codes |

Source: existing `apps/modem-ui/src/main.ts` and `apps/modem-ui/src/style.css`; confirmed by the Phase 2 context's instruction to preserve the production route and Debug qualification behavior.

---

## Spacing Scale

Declared values (must be multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Status-dot-to-label gap and inline metadata separation |
| sm | 8px | Table cell padding, label/value rows, compact control gaps |
| md | 16px | Card gap, default card-to-card separation, normal control group spacing |
| lg | 24px | Page padding on desktop and card internal padding where the current console needs more room |
| xl | 32px | Major group separation within diagnostic sections |
| 2xl | 48px | Major document-section separation only |
| 3xl | 64px | Reserved for a future page-level break; do not add in the compact Phase 2 card |

Exceptions: native action controls have a minimum 44px block size for pointer and keyboard usability. At widths below 1023px, preserve the existing single-column layout, 16px page padding, and full-width controls.

---

## Typography

Use exactly these four sizes and two weights. Do not add a third weight or a new display font.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body / status explanation | 16px | 400 | 1.5 |
| Label / table heading / control text | 14px | 700 | 1.3 |
| Card heading | 18px | 700 | 1.2 |
| Page heading | 28px | 700 | 1.2 |

Use tabular/monospace figures for epoch, MTU, byte counts, timestamps, and port numbers. Long identity labels and error reasons wrap at word boundaries; they never enlarge the page width.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#0f172a` | Page background, input background, and the visual field behind operational data |
| Secondary (30%) | `#172554` | Cards, including the new Bridge and FIPS transport card |
| Accent (10%) | `#0ea5e9` | Primary `Arm modem` action, keyboard focus outline, bridge-card border, and selected diagnostic control only |
| Destructive / failure semantic | `#fb7185` | Failure text, invalid configuration, disconnected state, overflow/rejection, and reset failure; no destructive action exists in this phase |

Status-only semantic colors retained from the existing console: `#22c55e` means ready/accepted and `#facc15` means waiting/resetting. Every status also has a text label and dot/symbol; color is never the only signal.

Accent reserved for: primary arm action, focus outline, the Bridge and FIPS transport card border, and selected diagnostic control. It is not used for successful status, destructive/recovery action, ordinary body links, or raw telemetry.

---

## Component and Content Contract

| Surface | Structure and content | Interaction |
|---------|-----------------------|-------------|
| Header status | Existing page title followed by role, evidence class, and local epoch metadata. Add the bridge state in plain text. | The concise state line has `role="status"` and `aria-live="polite"`; failure changes use `role="alert"` / assertive announcement. |
| Operator control card | Retain the existing `Arm modem` primary action and show the one-line state explanation. Place `Reset and reconnect` as the secondary action whenever recovery is meaningful. | Buttons are native `<button>` elements, have 44px minimum height, visible focus, and are disabled during in-flight actions. |
| Bridge and FIPS transport card | A semantic `<dl>` with: Configuration, Browser audio, Local bridge, FIPS sound transport, Epoch, Queue health, Last accepted/error, Complete packets TX/RX, and Sound MTU. Use `Unknown` only before data is received; never infer a state from missing data. | Read-only. Values update in place; errors use the failure state text and recovery affordance in the operator card. |
| Queue health | Show `Clear`, `Overflow`, `Rejected`, or `Unknown`, followed by `items` and `bytes` only when backend values were validated. Never display an unbounded frame list. | Overflow/rejection does not auto-retry. It makes `Reset and reconnect` the next obvious action. |
| Counter row | Show `TX complete packets: {n}` and `RX complete packets: {n}` with an epoch label. Before the first accepted packet, render `0`; while stale, render `Previous epoch: {n}`. | Counters are informational; no packet inspection, replay, or send control is introduced. |
| Error detail | Show a short safe reason, ISO-like local timestamp, and the affected subsystem (`configuration`, `browser audio`, `bridge`, or `sound transport`). | One visible recovery action. Do not show stack traces, endpoint query strings, secret-bearing configuration, or raw protocol data. |
| Existing detailed diagnostics | Preserve the audio-evidence table, qualification evidence, Docker/TUN projection, and decision/report sections. | Keep table captions, search label, wrapping, and horizontal table scroll behavior already implemented. Do not collapse this into the Phase 5 presentation UI. |

### Data acceptance and rendering rules

- Render role only after the resolver accepts exactly `a` or `b`; display it as uppercase `A`/`B` with its non-secret role description. An invalid or absent role renders `Unknown` and blocks arming.
- Treat browser, bridge, and FIPS transport messages as untrusted until their type, size, epoch, and allowed state transition have been validated. The UI reflects the validated snapshot, not an incoming payload verbatim.
- Escape all dynamic text via `textContent`; never assign server/config/error content with `innerHTML`.
- Bound visible error reasons to 240 characters and replace line breaks with spaces. Preserve the canonical safe error code if one is available.
- Do not expose private nsecs in any DOM node, `data-*` attribute, console line, accessibility label, or error. Public identity/fingerprint, when later shown, is truncated to `prefix…suffix` and is never required for Phase 2 readiness.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | `Arm modem` |
| Recovery CTA | `Reset and reconnect` |
| Empty state heading | `No local bridge activity yet` |
| Empty state body | `Arm the modem to request microphone access and establish this laptop’s local binary bridge.` |
| Configuration loading | `Loading local configuration…` |
| Ready state | `Local bridge ready · epoch {n}` |
| Disconnected state | `Local bridge disconnected. Reset and reconnect to start a new local session.` |
| Overflow state | `Bridge queue limit reached; the frame was rejected. Reset and reconnect before continuing.` |
| Error state | `The {subsystem} could not complete: {safe reason}. Check the local service or browser permission, then reset and reconnect.` |
| Reset consequence | `Starts a new local epoch and clears unsent local bridge data.` |
| Destructive confirmation | None. `Reset and reconnect` clears only volatile in-memory state and requires no confirmation. |

Use sentence case, concrete subsystem names, and the words **local**, **bridge**, **epoch**, and **reconnect** where applicable. Do not use “peer connected,” “link established,” “ready for ping,” “success,” or “sound transport proven” for Phase 2 bridge-only readiness.

---

## UI Considerations

Applicable state considerations resolved: 13 covered, 2 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| loading | Configuration and bridge status | ✅ covered | Before validation/connection, the UI renders the documented loading copy, disables arming, and does not invent role or transport values. |
| error | Configuration, local bridge, sound transport, recovery | ✅ covered | Each failure identifies the affected subsystem, shows a bounded safe reason and timestamp, and offers the documented recovery action. |
| empty | Complete-packet counters / bridge activity | ✅ covered | Zero accepted packets render as `0` under `No local bridge activity yet`; it is not styled as a successful acoustic link. |
| populated | Bridge and FIPS transport card | ✅ covered | Validated scalar state is rendered in a labelled definition list: configuration, audio, bridge, transport, epoch, queues, counters, last event, and MTU. |
| partial | Transport state and telemetry | ✅ covered | Missing validated fields render `Unknown`; the UI may not derive readiness or effective MTU from partial data. |
| overflow | Queue state and diagnostic tables | ✅ covered | Queue overflow/rejection renders a failure state and recovery. Existing wide tables retain horizontal scrolling; page width never expands. |
| zero-one-many | Error/event summaries and packet counters | ✅ covered | Zero is explicit; one uses singular `packet`; two or more use plural `packets`; no unbounded event feed is added. |
| long-text | Error detail, identity label, status metadata, controls | 🧪 backstop | A browser UI test verifies a 240-character safe error and an unusually long public label wrap inside their card without horizontal page overflow or overlap. |
| long-text | Existing corpus search and diagnostics | 🧪 backstop | A browser UI test verifies long corpus IDs and table values wrap or scroll in the existing table container while headers and controls remain usable. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — shadcn is not initialized and the project is a vanilla TypeScript DOM application |
| third-party | none | not applicable — no third-party UI registry or block is permitted in this phase |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS after explicit focal-point clarification
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-07-24
