---
quick_id: 260729-2ly
status: human_needed
verified_at: 2026-07-29
---

# Quick Task 260729-2ly Verification

## Automated verdict

All software must-haves pass. Physical performance remains deliberately
`human_needed` because fixture and browser tests cannot prove open-air behavior
on the exact demo laptops.

| Requirement | Evidence | Verdict |
|-------------|----------|---------|
| Faster turns | Session uses an eight-DATA-fragment window; the maximum conservative-payload test proves 15 DATA fragments cross with two bitmap ACKs and four parity units. | Passed |
| New connection-speed approaches | Same-epoch fast resume, larger bursts, captured fast candidate guards, and the ggwave/Quiet comparison are implemented or documented. | Passed |
| Fresh handshake but calibration skip after failure | The exhausted-heartbeat recovery test proves a new session ID, both peers return to Ready, both ledgers remain empty, and both warm-resume counters advance. New-epoch test proves calibration runs again. | Passed |
| Error correction/fault tolerance | Pure protocol tests cover one-erasure recovery, short final fragments, malformed parity, and multiple erasures. Session tests prove one loss needs no retry and two losses use bounded bitmap retransmission. | Passed |
| Real-time bps/kbps/mbps stats | Delivered payload byte counters feed a 500 ms rolling UI sampler. Formatter tests cover bps, kbps, Mbps, decay, and counter reset. Production build and Chromium suite pass. | Passed |
| Robust connection ceremony | Session tests prove only identity/capability/commit/reset units request ceremony mode; Quiet tests prove redundant settings are immutable per queued job. | Passed |

## Quality gates

`npm run check` passed end to end:

- dependency lock audit;
- ESLint;
- strict TypeScript;
- 316 unit tests;
- 21 Chromium tests;
- production build;
- corpus check;
- fixture qualification and verification;
- Compose topology and source checks.

## Human hardware checks

Run on the exact two-laptop open-air pair before claiming measured physical
improvement:

1. Record cold calibration-to-Ready time, force a dead-link recovery, and record
   reconnect-to-Ready time. Confirm the second path shows a new session ID,
   `warmResumes` increments, and no calibration UI appears.
2. Induce one dropped/corrupt DATA modem frame in a four-fragment parity group.
   Confirm `recoveredFragments` increments and the retry counter does not.
3. Induce two losses in one group. Confirm bounded retransmission succeeds and
   the complete FIPS packet is delivered exactly once.
4. Transfer sustained payload and observe TX/RX rate update at 500 ms cadence
   with bps/kbps/Mbps unit changes.
5. Compare audible acquisition in the real room before considering a separate
   ggwave or alternative-frequency ceremony experiment.
