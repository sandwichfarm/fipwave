---
quick_id: 260729-382
status: passed
verified_at: 2026-07-29
---

# Explicit Acoustic Peer Identity Verification

| Must-have | Evidence | Verdict |
|---|---|---|
| Browser receives a runner-selected expected peer | `RunnerQualificationConfig`, `fetchRunnerConfig`, and the production endpoint regression carry `laptop-a` / `laptop-b`. | Passed |
| FAS1 handshake uses the configured identity | `configureAcousticSession` passes `config.peerMachineId` to `AcousticSession.expectedPeer`; it no longer derives `fipwave-a/b`. | Passed |
| Physical instructions configure reciprocal identities | Both runner commands and the pre-arm configuration table in `docs/laptop-to-laptop-test.md` name reciprocal values. | Passed |
| Existing defaults remain compatible | `startProductionRunner` derives the legacy default after resolving `DemoConfig`; all 316 unit tests and 22 browser tests pass. | Passed |

The full physical two-laptop open-air qualification remains a separate human
hardware gate; this change removes the identity mismatch that would otherwise
prevent its FAS1 handshake.
