---
phase: 04
slug: prove-the-sound-only-fips-ping
status: approved
shadcn_initialized: false
preset: none
created: 2026-07-24
---

# Phase 04 — UI Design Contract

> Visual and interaction contract for the Phase 4 proof surface. It extends the existing native TypeScript modem diagnostics with authoritative FIPS proof facts; it does not create Phase 5's presenter view, no-scroll composition, launcher, or rehearsal experience.

---

## Scope and Truth Boundary

This phase adds a compact **Sound-only FIPS proof** section to the existing runtime/diagnostic page. Keep the existing audio, bridge, acoustic-session, applied-audio, qualification, corpus, and Docker/TUN diagnostic cards intact. Do not replace them with a wizard, dashboard redesign, animated packet visualization, or a new Debug mode.

The browser is a renderer of bounded structured facts. It must never infer authenticated-peer state, B isolation, active Sound link, kernel-ping success, or an Open-air result from audio readiness, bridge state, packet counters, a browser event, a fixture, or a same-machine loopback.

| UI fact | Required source | Display rule |
|---|---|---|
| Authenticated peer, expected identity, connectivity, Sound transport, link ID/state | Current bounded control-socket `show_peers`, `show_links`, and `show_transports` snapshot joined by expected peer/link/transport identifiers | Render **Verified**, **Waiting**, **Stale**, or **Failed**; do not derive it from bridge status or logs. |
| Role B Sound-only isolation | Current Role B live transport snapshot plus Compose/runtime inspection; paired local acceptance record until a safe in-band attestation exists | Render **Verified only** when exactly one usable transport is Sound. Never obtain it over a LAN browser/bridge endpoint. |
| Acoustic readiness and acoustic counters | Current-epoch, scalar-only acoustic public status and bridge counters | Label these **Local acoustic evidence**. They support correlation but cannot alone enable or pass ping. |
| ICMPv6 outcome | Literal bounded `docker exec` invocation of `ping -6` inside Role A's live FIPS namespace | Only exit status plus parsed sequence/latency/loss summary is a ping outcome. Browser echo, host ping, fixtures, and raw logs are not outcomes. |
| Evidence class | Structured proof record | Always show exactly one of `Fixture`, `Loopback`, `Open air`, or `human_needed`. `Fixture` and `Loopback` never receive a proof-success treatment. |

## Design System

| Property | Value |
|----------|-------|
| Tool | none |
| Preset | not applicable — no `components.json`; project is native Vite/TypeScript, not shadcn/React |
| Component library | none; use existing semantic DOM helpers and CSS classes |
| Icon library | none; use text labels and the existing leading status dot only |
| Font | system UI for interface text; existing UI monospace stack for measurements, IDs, counters, addresses, and command/result details |

**shadcn gate:** no design-system configuration exists. The autonomous Phase 4 scope preserves the established native diagnostic pattern; initialization is not authorized or needed. Registry safety is therefore not applicable.

## Information Architecture and Component Inventory

1. Change the page heading to **`Sound-only FIPS proof`**. Retain the existing one-line machine/role/evidence/Chromium/epoch metadata below it.
2. Keep the existing global local-runtime status line. Its copy continues to describe local bridge/audio state only.
3. Insert a **`FIPS proof status`** card immediately after **`Bridge and FIPS transport`** and before **`Acoustic session`**. Use a semantic `dl` for the proof facts and a short state message below it.
4. In the existing operator card, add the proof actions after existing recovery actions. On Role A show **`Refresh proof status`** (secondary) and **`Run sound-only ping`** (primary). On Role B show **`Refresh proof status`** only plus the static explanation **`Role B is the acoustically isolated node. The proof ping is issued from Role A.`**
5. Add a **`Ping outcome`** subsection inside the proof card only after a proof request has produced a result. It presents a bounded summary, not a terminal transcript. Existing diagnostics remain below it and may scroll normally.

Do not add a launch button, role picker, presenter explanation, no-scroll mode, ten-ping tally, cold-start scorer, evidence-directory browser, or rehearsal controls; those are Phase 5 work.

## Proof Card Content

Use these labels and values in this order. Every unavailable fact displays `Waiting for a current snapshot` rather than a plausible default.

| Label | Value contract |
|---|---|
| Proof status | One state label from the truth table below. |
| Evidence class | `Fixture`, `Loopback`, `Open air`, or `human_needed`; never hide it. |
| Authenticated peer | `Verified — <expected public identity>` only when the expected peer is connected and authenticated through `sound`; otherwise `Waiting for authenticated Sound peer` or a safe failure reason. Do not render secret material. |
| Active Sound link | `Verified — link <link-id>` only when the peer and link snapshots join to the same Sound transport; otherwise `Waiting for active Sound link`. |
| Role B isolation | `Verified — Sound is the only usable Role B FIPS transport` only after the paired live proof passes. Otherwise `Waiting for paired Role B isolation proof` or `Failed — Role B has an additional usable FIPS transport`. |
| Acoustic session | `Ready — epoch <n>` only for the same current epoch with committed settings acknowledgement and current heartbeat; otherwise `Disarmed — current acoustic session is not ready`. |
| Bridge packet counters | `Complete packets TX/RX: <tx>/<rx>` with the current epoch; local diagnostic evidence only. |
| Acoustic counters | `Acoustic TX/RX: <tx>/<rx> · fragments: <tx>/<rx> · integrity failures: <n> · retries: <n>`; observed counters only. If a required counter is unavailable, show `Unavailable` for that field, never `0`. |
| Ping readiness | Either `Ready — all current proof gates agree` or the first blocking reason in the prescribed copy below. |

For identity, link ID, address, timestamps, counters, and command/result details, use the existing monospace measurement styling and `overflow-wrap: anywhere`. Do not display raw FIPS control JSON, nsecs, packet bytes, browser user-agent strings in the proof card, arbitrary errors, or daemon logs.

## State and Interaction Contract

| State | Truth condition | Visible status and copy | Controls |
|---|---|---|---|
| Loading | Initial proof snapshot is not yet available. | `Waiting for current proof facts…` | `Refresh proof status` enabled. `Run sound-only ping` disabled. |
| Prerequisites missing | Any required current gate is absent, including acoustic ready, authenticated expected peer, joined active Sound link, B isolation, or configured target. | `Ping is blocked — <specific blocking reason>. Refresh proof status after recovery.` | Refresh enabled; ping disabled. |
| Ready | All current gates agree: current acoustic epoch is armed/ready; expected authenticated peer is connected through Sound; link joins to that Sound transport; B isolation passes; target matches Role B config. | `Ready to run one kernel ICMPv6 ping from Role A.` | Refresh enabled. Role A enables the primary ping button. Role B has no ping button. |
| Running | A valid proof request has started; no result yet. | `Running kernel ping in Role A FIPS namespace…` | Ping disabled with `aria-busy="true"`; Refresh disabled until the bounded command settles; recovery stays enabled. |
| Passed, nonphysical | Kernel ping exit code is 0 but evidence is `Fixture` or `Loopback`. | `ICMPv6 reply observed. Physical Open-air proof is still required.` Use neutral/yellow treatment, never green “proof passed”. | Ping may be re-enabled only after a fresh snapshot. |
| Passed, Open air | Exit code is 0 and the record is valid matching two-machine `Open air` evidence. | `Open-air ICMPv6 reply observed across the authenticated Sound link.` | Ping may be re-enabled only after a fresh snapshot. |
| Human needed | Required physical records are absent, incomplete, mismatched, or nonphysical. | `Human needed — matching two-laptop Open-air evidence is not available.` | Refresh enabled; ping remains governed by current technical gates. This state is not an error and not a success. |
| Ping failed | Kernel ping exits nonzero, times out, or returns an invalid bounded result. | `Kernel ping did not receive an ICMPv6 reply. Check the Sound link, then refresh proof status.` Include bounded exit code/loss summary if available. | Refresh enabled after completion; ping stays disabled until a fresh ready snapshot. |
| Degraded / reconnecting | Acoustic disarm, heartbeat loss, browser replacement, disconnected Sound worker, or peer disconnect occurs. | `Sound link degraded — ping result cleared. Reconnecting through the normal FIPS lifecycle…` | Ping immediately disabled. Preserve observed counters with `Previous epoch` labeling. Show existing `Reset and reconnect`; do not restart FIPS or offer alternate transport failover. |
| Error | Snapshot validation, isolation assertion, or proof orchestration fails safely. | `Proof status unavailable — <safe reason>. Refresh proof status.` | Refresh enabled; ping disabled. Existing recovery control remains available where applicable. |

### Control details

| Control | Availability | Behavior | Exact helper / completion copy |
|---|---|---|---|
| Refresh proof status | Both roles except while a ping is running | Fetch fresh bounded proof facts and replace stale proof readiness. It does not start audio, authenticate a peer, or run ping. | Default helper: `Reads current FIPS, isolation, and acoustic proof facts.` On refresh: `Refreshing proof status…` |
| Run sound-only ping | Role A only, and only in Ready state | Request exactly one bounded authoritative in-namespace `ping -6`; clear any prior outcome when a disarm/epoch/peer/link change happens. | Enabled helper: `Runs one kernel ICMPv6 ping to the isolated Role B address.` Disabled helper: `Ping is blocked — <specific blocking reason>.` |
| Reset and reconnect | Existing recovery conditions | Preserve current behavior: invalidate current acoustic/packet admission, clear unsent local bridge data, begin a new epoch, then re-arm. It cannot preserve a peer/ping pass. | `Starts a new local epoch and clears unsent local bridge data.` No confirmation dialog: it does not delete persistent user data. |

`Run sound-only ping` must never be clickable based solely on a green local bridge, “FIPS sound transport Started,” browser audio readiness, nonzero counters, Fixture data, or Loopback data. A stale/previous-epoch pass is not displayed as a current outcome.

## Ping Outcome Contract

After an attempt, render these rows only from the proof runner's bounded structured result:

| Label | Copy / format |
|---|---|
| Command authority | `Role A FIPS namespace · system ping -6` |
| Target | Configured Role B `fips0` IPv6 address only |
| Result | `Reply received` for exit 0; `No reply received` for exit 1; `Ping command error` for exit 2/runner failure |
| ICMPv6 evidence | `Sequence <n> · <latency> ms · <loss>% packet loss` when parsed; otherwise `Bounded ping output did not include a complete summary.` |
| Correlation | `Before/after counters: complete packets <a>→<b> · acoustic TX/RX <a>/<b>→<a>/<b> · fragments <a>/<b>→<a>/<b> · integrity failures <a>→<b> · retries <a>→<b>` |
| Evidence disposition | Exact evidence-class message from the state table. |

Retain raw stdout/stderr in the structured proof artifact, not the browser DOM. The browser may show at most a safe 240-character reason and the parsed scalar summary. Never present raw output as proof if snapshot gates failed.

## Spacing Scale

Declared values (all multiples of 4):

| Token | Value | Usage |
|---|---:|---|
| xs | 4px | Heading/status adjacency and inline status-dot gaps |
| sm | 8px | `dl` row gaps, table cells, compact control gaps |
| md | 16px | Card padding, grid gaps, card separation, standard controls |
| lg | 24px | Page padding on desktop and proof-section spacing |
| xl | 32px | Reserved for a future major section break; do not introduce a new layout region in Phase 4 |
| 2xl | 48px | Reserved; not used in this narrow runtime extension |
| 3xl | 64px | Reserved; not used in this narrow runtime extension |

Exceptions: existing primary buttons remain at least 44px high; existing search input remains at least 40px high. No other exception.

## Typography

Use exactly these existing sizes and weights; do not add a display type scale for Phase 4.

| Role | Size | Weight | Line Height |
|---|---:|---:|---:|
| Body | 16px | 400 | 1.5 |
| Label / table heading / control | 14px | 700 | 1.3 |
| Card heading | 18px | 700 | 1.2 |
| Page heading | 28px | 700 | 1.2 |

Weights are limited to regular 400 and bold 700. Measurements use the existing monospace family at the role's declared size; monospace is a data treatment, not an additional typography scale.

## Color

Preserve the current dark diagnostic palette and approximate 60/30/10 hierarchy.

| Role | Value | Usage |
|---|---|---|
| Dominant (60%) | `#0f172a` | Page background, input background, unselected field surface |
| Secondary (30%) | `#172554` | Cards, including the proof card; `#334155`/`#475569` remain borders only |
| Accent (10%) | `#0ea5e9` | Only the enabled primary **Run sound-only ping** button, proof-card border when current proof is Ready, keyboard focus outline, and existing single primary action styling |
| Success | `#22c55e` | Current authenticated/Open-air verified labels only; never evidence class or a nonphysical ping result |
| Warning | `#facc15` | Waiting, blocked, human-needed, running, degraded, and nonphysical reply states |
| Destructive / error | `#fb7185` | Terminal proof/bridge errors and ping failures only; no destructive Phase 4 action is introduced |

Accent reserved for: the primary Role A ping action, its Ready proof-card emphasis, and focus indication. Secondary refresh/reset controls remain transparent with the existing neutral border. Status uses text plus exact state wording, never color alone.

## Copywriting Contract

| Element | Copy |
|---|---|
| Primary CTA | `Run sound-only ping` |
| Secondary proof action | `Refresh proof status` |
| Role B action explanation | `Role B is the acoustically isolated node. The proof ping is issued from Role A.` |
| Empty state heading | `No ping has run in this epoch` |
| Empty state body | `Refresh proof status, then run the sound-only ping from Role A when every current proof gate is ready.` |
| Blocked state | `Ping is blocked — <specific blocking reason>. Refresh proof status after recovery.` |
| Running state | `Running kernel ping in Role A FIPS namespace…` |
| Degraded state | `Sound link degraded — ping result cleared. Reconnecting through the normal FIPS lifecycle…` |
| Error state | `Proof status unavailable — <safe reason>. Refresh proof status.` |
| Nonphysical result | `ICMPv6 reply observed. Physical Open-air proof is still required.` |
| Human-needed result | `Human needed — matching two-laptop Open-air evidence is not available.` |
| Open-air result | `Open-air ICMPv6 reply observed across the authenticated Sound link.` |
| Destructive confirmation | None. `Reset and reconnect` is a recoverable operational reset, not a destructive persistent-data action; its helper copy explicitly states the transient data it clears. |

Use singular/plural forms for counters (`1 packet`, `2 packets`). Safe reasons are allowlisted bounded scalar codes or fixed copy; do not surface stack traces, URLs, query strings, secrets, raw control documents, or packet contents.

## Accessibility

- Preserve semantic `header`, one `h1`, nested `h2`/`h3`, `section`, `dl`, `table`, `caption`, `th scope`, and native `button` usage.
- The global proof-state message is the only proof live region. Use `role="status" aria-live="polite"` for Loading, Ready, Running, and Human-needed; use `role="alert" aria-live="assertive"` for Ping failed and Error. Do not announce counter refreshes individually.
- Disabled ping includes visible blocking copy adjacent to the button. Use native `disabled`, not an inert click handler. Running ping uses `aria-busy="true"` on the button and proof card.
- Keep existing 44px minimum button target, 3px `:focus-visible` outline, keyboard order, visible text labels, contrast-safe light text, and no color-only state indication.
- Long identities, IPv6 addresses, link IDs, and reason codes wrap anywhere. Tables retain captions and horizontal scroll only inside their existing `.corpus-card`-style overflow container; headers remain visible.
- Honor existing `prefers-reduced-motion: reduce`; Phase 4 adds no animation, timer, or auto-scrolling behavior.

## Responsive and Viewport Behavior

- Preserve the existing 1160px max-width desktop diagnostic layout: operator and proof/bridge content use the two-column grid with 16px gap; the operator card may remain sticky.
- At 1023px and below, use the existing single-column layout, static operator card, full-width controls, and one-column definition lists.
- Support a 320px minimum viewport. Proof rows, safe reasons, identities, and addresses wrap rather than overflow the page. Counter groups may wrap onto separate lines.
- Phase 4 intentionally permits normal document scrolling. It has no 1366×768/1440×900 no-scroll requirement; that visual contract belongs exclusively to Phase 5.

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|---|---|---|
| shadcn official | none | not applicable — shadcn is not initialized |
| third-party | none | not applicable |

## UI Considerations

The compiled UI consideration probe resolved 24/24 applicable
element/category checks explicitly, covering all 8 unique taxonomy categories
with 0 backstop and 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|---|---|---|---|
| empty | Ping outcome / proof facts | ✅ covered | Before an attempt, show `No ping has run in this epoch` and the documented next step; unavailable proof facts show `Waiting for a current snapshot`, never fabricated zero values. |
| loading | Refresh and ping controls / proof status | ✅ covered | Refresh announces `Refreshing proof status…`; an active ping announces its namespace authority, sets busy state, and disables duplicate requests. |
| error | Proof card / recovery control | ✅ covered | Safe snapshot or command failures use the documented error copy with Refresh; degradation clears current outcome and retains existing Reset and reconnect. |
| populated | Proof facts, counters, and outcome | ✅ covered | Current structured facts render in the fixed label order with source/provenance treatment and evidence class always visible. |
| partial | Correlation counter rows | ✅ covered | A missing counter renders `Unavailable`, and partial/stale facts cannot make the proof ready or successful. |
| overflow | `dl`, proof controls, counter rows, table result details | ✅ covered | Long values wrap anywhere; narrow controls become full-width; tables use their existing contained horizontal overflow rather than clipping data or widening the viewport. |
| zero-one-many | Ping attempts / counters | ✅ covered | Empty copy handles zero attempts; packet counters use singular/plural grammar; this phase shows one latest bounded outcome rather than a growing attempt list. |
| long-text | IDs, IPv6 addresses, safe reasons, result details, controls | ✅ covered | Monospace measurements wrap; controls retain exact labels and helper text; raw unbounded output never enters the DOM. |

## Testable Acceptance Criteria

1. A production-page test renders **`FIPS proof status`** with every prescribed label and shows the evidence class for Fixture, Loopback, Open air, and human-needed records.
2. A bridge-ready/browser-audio-ready fixture with no authoritative FIPS snapshot renders `Waiting for authenticated Sound peer` and keeps **`Run sound-only ping`** disabled.
3. The ping button is enabled only for Role A after a current-epoch joined snapshot proves the expected authenticated `sound` peer, active Sound link, B Sound-only isolation, and matching configured target. Role B never renders the ping button.
4. A Fixture or Loopback exit-0 ping result renders `ICMPv6 reply observed. Physical Open-air proof is still required.` and does not render green proof-success copy or an Open-air label.
5. An Open-air result is presented as successful only when matching two-machine evidence is supplied; absent/mismatched records render the exact human-needed copy.
6. Any acoustic disarm, epoch change, peer disconnect, non-Sound transport, heartbeat loss, or stale snapshot clears the prior outcome, disables ping immediately, and renders the degraded/blocked state until a fresh proof join succeeds.
7. A nonzero/timeout ping result preserves only the bounded exit/loss summary, shows the documented failure recovery copy, and requires a fresh proof snapshot before another ping can run.
8. Proof facts use semantic `dl`/`table` markup, one appropriate live region, native disabled/busy controls, existing keyboard focus treatment, and no color-only status; a 320px screenshot has no page-level horizontal overflow.
9. At desktop widths the existing diagnostic cards remain present and the page can scroll; no no-scroll/presenter test is added in this phase.

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** verified 2026-07-24
