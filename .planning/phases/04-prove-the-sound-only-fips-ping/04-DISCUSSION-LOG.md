# Phase 4: Prove the Sound-Only FIPS Ping - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution
> agents. Decisions are captured in `04-CONTEXT.md`; this log preserves the
> alternatives considered.

**Date:** 2026-07-24
**Phase:** 4-Prove the Sound-Only FIPS Ping
**Areas discussed:** Authenticated peer activation, isolated-node topology,
kernel ping authority, recovery and evidence

---

## Authenticated peer activation

| Option | Description | Selected |
|---|---|---|
| Gate the normal FIPS peer lifecycle on acoustic readiness | Reuse normal authentication/encryption only after committed current acoustic readiness. | ✓ |
| Start FIPS early and buffer below readiness | Allow authentication work before the acoustic session is committed. | |
| Use a demo-only handshake | Add a shortcut around normal FIPS authentication. | |

**User's choice:** Auto-selected the recommended fail-closed normal FIPS
lifecycle.
**Notes:** Worker-up and browser preflight remain insufficient; recovery uses
the same normal peer lifecycle.

---

## Isolated-node topology

| Option | Description | Selected |
|---|---|---|
| Exact role-specific config plus runtime inspection | Make Sound role B's only FIPS transport and prove the live state. | ✓ |
| Rely on documentation only | Describe isolation without inspecting the runtime. | |
| Disable alternate paths manually | Depend on an operator step during the demo. | |

**User's choice:** Auto-selected exact configuration plus runtime proof.
**Notes:** Role A may have an automatically selected upstream mesh transport;
the A↔B address remains Sound only. Browser ports remain laptop-local.

---

## Kernel ping authority

| Option | Description | Selected |
|---|---|---|
| Role A FIPS container kernel ping | Run the system `ping -6` inside the real `fips0` namespace. | ✓ |
| Synthetic ICMP packet fixture | Construct an ICMP-like test payload. | |
| Browser-generated ping indicator | Let UI state stand in for kernel traffic. | |

**User's choice:** Auto-selected the real role-A kernel ping.
**Notes:** The real exit status and reply output are authoritative. Fixture
tests validate orchestration only.

---

## Recovery and evidence

| Option | Description | Selected |
|---|---|---|
| Fail-closed bounded recovery with runtime-derived evidence | Disarm first, reconnect normally, and record correlated observed facts. | ✓ |
| Optimistic UI continuity | Keep the link looking ready through interruption. | |
| Manual restart and presenter narration | Depend on a hidden restart and verbal explanation. | |

**User's choice:** Auto-selected fail-closed bounded recovery.
**Notes:** One successful ping and one interruption proof belong here; final
rehearsal counts and presentation UX remain Phase 5.

## the agent's Discretion

- Exact existing FIPS control/snapshot seam for authenticated peer facts.
- Smallest authoritative kernel-ping orchestration mechanism.
- Existing role-A upstream FIPS transport compatible with the target host,
  without a new required operator parameter.

## Deferred Ideas

- Phase 5 owns one-command polish, no-scroll screens, final evidence
  directories, ten pings, three cold starts, 60-second recovery scoring, and
  presenter documentation.
- Multiplexing and near-ultrasonic profiles remain later work.
