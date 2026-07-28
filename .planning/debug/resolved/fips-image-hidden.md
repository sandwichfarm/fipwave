---
status: resolved
trigger: "Node A reports Disconnected while acoustic RX/TX continues; neither node shows the image at Sound link established"
created: 2026-07-28
updated: 2026-07-28
---

# Debug Session: FIPS image hidden and bridge state race

## Symptoms

- Expected: Node A always displays the supplied image, Node B displays its
  progressive receive surface, and Send becomes available once FIPS is ready.
- Actual: both image surfaces are absent while the UI says Sound link
  established. After acoustic recovery, Node A can show Disconnected even
  though acoustic frame counters continue increasing.
- Errors: the audience view only reports that the local bridge stopped.
- Timeline: observed in the staggered two-node demo after acoustic negotiation.
- Reproduction: `npm run demo:staggered -- --first b --delay-ms 8000`.

## Current Focus

- hypothesis: confirmed — image rendering is incorrectly gated by final proof;
    recovery can reuse the consumed acoustic capability before the runner's
    replacement capability arrives, causing the runner to reject and close the
    browser bridge
- test: render both role-specific image surfaces before proof readiness and
    exercise disarm/re-arm capability ordering
- expecting: visible source/canvas throughout; no stale capability readiness
- next_action: rebuild and rehearse the staggered two-node transfer
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-07-28
  observation: `renderDemo()` creates the image card only when `proofReady` or a
    transfer ID already exists, making the requested source and receive canvas
    invisible at Sound link established.
- timestamp: 2026-07-28
  observation: `sendAcousticControl(13)` retains the consumed capability;
    `AcousticSessionAdapter.refresh()` can immediately send READY with that old
    capability before the asynchronous replacement capability message arrives.
- timestamp: 2026-07-28
  observation: the runner rejects a reused capability as
    `acoustic_readiness_proof_invalid` and closes the WebSocket; acoustic audio
    continues independently, producing the contradictory live frame counters.

## Eliminated

## Resolution

- root_cause: The image surface was conditional on final proof readiness, and
    DISARM left a consumed readiness capability available during the
    asynchronous recovery-capability exchange.
- fix: The role-specific image source/canvas now occupies the existing stage
    panel from initial render onward, while Send remains truthfully gated.
    Successful DISARM clears its capability so fast recovery waits for the
    replacement before projecting READY.
- verification: Dashboard regression tests pass for both roles and retain the
    1366x768 no-scroll contract. Typecheck, all 278 unit tests, production
    build, and all 18 browser tests pass.
- files_changed:
    - apps/modem-ui/src/main.ts
    - apps/modem-ui/src/style.css
    - apps/modem-ui/e2e/demo-dashboard.spec.ts
