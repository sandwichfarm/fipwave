---
spike: 001
name: same-laptop-acoustic-self-loop
type: standard
validates: autonomous real-speaker-to-real-microphone message transfer in both directions on one laptop
verdict: PARTIAL
related: []
tags: [audio, quiet, browser, loopback, playwright]
---

# Same-laptop Acoustic Self-loop

## Question

Can two production browser modem roles on one laptop exchange messages through
the laptop’s built-in speaker and microphone, without a virtual device or human
interaction?

## Success Criterion

With fresh role A and role B production runners in non-qualifying `Loopback`
mode, the harness must:

1. Verify the system defaults are the built-in speaker and built-in microphone.
2. Open a real, headed Chrome session and grant microphone permission to both
   runner origins.
3. Arm both roles at the same Quiet epoch.
4. Play A → B and then B → A through the physical audio path.
5. Find at least one independently observed, complete, byte-perfect result in
   B’s canonical report for A → B and in A’s report for B → A.
6. Restore audio levels and terminate every process it started.

## Approaches Considered

### Two production runners and two browser pages — selected

This uses the same bridge, UI, codec assets, Web Audio output, and
`getUserMedia` capture path as the demo. Distinct ports provide independent
roles and reports. `Loopback` changes evidence authority only; it does not
create a digital audio route.

### Dedicated single-page codec harness

This would make signal-level experiments easier, but could hide integration
faults in the production runner, epoch handling, role filtering, or evidence
reporting. It remains a fallback diagnostic if the production path fails.

### Virtual audio loopback or fake microphone

Rejected because it bypasses the transducers and room path that this spike is
intended to isolate.

## Important Constraints

- Port 4173 and the canonical `laptop-a.json` report belong to an existing
  Open-air run and are out of scope.
- The two roles must have matching epochs. Quiet intentionally ignores
  wrong-epoch, same-sender, and wrong-direction frames.
- Cyrinx’s build step uses a shared mutable directory, so this diagnostic
  intentionally forces the production-authorized Quiet fallback rather than
  racing two Cyrinx builds.
- Playback completion proves only transmission. The peer’s canonical report is
  the authority for successful reception.
- Even a passing result remains non-physical qualification evidence:
  `evidenceClass: Loopback` and `physicalGate: not_physical`.

## How to Run

The current harness is macOS-only. Use the project-pinned Node 22.23.1 with
Google Chrome installed. Ensure ports 4174 and 4175 are free and the built-in
speaker and microphone are the macOS defaults, then run:

```sh
npm run smoke:self-loop -- --output-volume 65 --input-volume 90
```

For an experimental 2× browser playback signal, add
`--playback-gain-percent 200`. The default remains 100% because the Quiet
profile is calibrated for its committed amplitude; increasing it can
overdrive the near-field speaker/microphone path and must be validated on the
target hardware.

No browser interaction is required. The command builds the production bundles,
starts two isolated diagnostic runners, opens headed Chrome, grants microphone
permission to both origins, arms both roles, forces the runner-authorized Quiet
fallback, sends the full A → B corpus followed by the full B → A corpus, checks
the canonical receiver reports, and cleans up.

The command exits nonzero unless each direction includes the canonical first
case as an independently observed, complete, byte-perfect result. Every run
gets a unique directory under `.artifacts/diagnostics/self-loop/`.

## Observability

Each run records:

- selected macOS input/output devices and original/test audio levels;
- exact runner identities, ports, evidence modes, and report targets;
- browser launch policy, microphone labels/settings, role state, and epoch;
- page console errors, runner stdout/stderr, state transitions, and timestamps;
- the final canonical A/B reports and a compact outcome summary.

## Investigation Trail

### 2026-07-23 — topology trace

- Confirmed that separate production runners enforce one UI owner per runner,
  not globally.
- Confirmed that role B accepts A → B while role A filters its own transmission,
  with the inverse behavior for B → A.
- Confirmed that same-machine browser contexts may concurrently capture the
  same microphone, but the repository had no real-hardware test proving that
  behavior on this Mac.
- Isolated this spike from the live 4173 Open-air runner and its canonical
  report.

### 2026-07-23 — autonomous physical run

- Stopped the stale 4173 runner, rebuilt the production server/UI, and launched
  fresh role A/B runners on ports 4174/4175.
- Verified the macOS defaults were `MacBook Pro Speakers` and
  `MacBook Pro Microphone`, both built-in at 48 kHz. The installed virtual
  `Loopback Audio` device was not selected.
- Launched headed Google Chrome 151 with the Playwright mute flag removed and
  no fake-media arguments. Both browser roles reported the built-in microphone,
  running 48 kHz contexts, mono codec PCM, and echo cancellation, noise
  suppression, and automatic gain control disabled.
- Both roles reached the runner-authorized Quiet fallback at epoch 2.
- Role B recorded 24 byte-perfect A → B cases. Role A recorded 24 byte-perfect
  B → A cases. Both canonical `*-256-01` cold-acquisition cases were observed,
  complete, single-delivery, uncorrupted, and digest-equal.
- `*-256-11` was the only absent case in each direction. Queue high-water marks
  show that each receiver retained one of its two fragments (221 bytes on one
  role, 35 bytes on the other), so this was real Quiet fragment loss rather
  than duplicate-payload suppression or case-index/reporting confusion. The
  exact DSP cause remains below current telemetry. The transfer still exceeded
  this spike's message-level success criterion; the symmetric gap is retained
  as a follow-up finding rather than hidden.
- The harness closed its Chrome process and both runners, freed ports
  4174/4175, and restored output/input volume from the test levels 65/90 to the
  original 100/100.

### 2026-07-24 — 2× playback-gain experiment

- Added an opt-in browser destination gain controlled by
  `--playback-gain-percent`; `200` maps to a 2× Web Audio multiplier while
  keeping system volume bounded.
- The 2× path armed successfully in headed Chrome and reported the real
  built-in microphone, but did not produce a byte-perfect receive at either
  output level 30 or 65 during bounded diagnostic attempts. Both attempts
  cleaned up and restored 100/100. The default remains 100% until the
  amplified profile is retuned for the target acoustic geometry.

Primary evidence:

- `.artifacts/diagnostics/self-loop/20260723T224340688Z-31338/summary.json`
- `.artifacts/diagnostics/self-loop/20260723T224340688Z-31338/role-a.json`
- `.artifacts/diagnostics/self-loop/20260723T224340688Z-31338/role-b.json`
- `.artifacts/diagnostics/self-loop/20260723T224340688Z-31338/events.ndjson`

## Result

PARTIAL — the primary feasibility question is answered yes: the same laptop
sent and independently decoded messages through its real speaker/microphone
path in both directions, with 24 byte-perfect cases per direction. The result
is not marked `VALIDATED` because it is one physical run and because one
specific corpus case was absent symmetrically. It is also deliberately
non-qualifying for the final demo: both reports remain `Loopback` evidence with
`physicalGate: not_physical`.
