---
quick_id: 260729-3d7
status: passed
verified_at: 2026-07-29
---

# FAS1-Ready Physical Harness Gate Verification

| Must-have | Evidence | Verdict |
|---|---|---|
| Corpus waits for FAS1 readiness | `waitForAcousticReady` runs after Quiet arms and before either `sendDirection` call. | Passed |
| Timeout provides diagnostic state | The harness records `acoustic-readiness-progress` states and includes the last A/B session copies in a bounded timeout error. | Passed |
| Option is bounded and tested | Parser tests cover a valid 90-second value and reject a value below one second. | Passed |
| Real audio path exercises the gate | Run `20260729T012646992Z-29282` reached FAS1 ready on both roles, then decoded A→B and B→A byte-perfectly. | Passed |

This is real single-laptop Loopback evidence only. It does not replace the
two-laptop exact-host Open-air qualification required for the final demo claim.

