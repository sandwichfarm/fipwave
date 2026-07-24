---
schema_version: 1
open_count: 3
waived_count: 0
fixed_count: 1
total_count: 4
last_updated: 2026-07-24T10:39:57.137Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | deviation | scripts/audit-dependencies.mjs |  | Temporary official Node 22.23.1 runtime was required because the host ran Node 25.2.1. | open |  | 2026-07-23T14:50:10.558Z |  |
| 2 | 01 | stub | packages/bridge/src/server.ts |  | Runner stamps qualification results in memory but does not persist a complete MachineReport from Quiet receiver evidence. | fixed |  | 2026-07-23T17:42:43.795Z | 2026-07-23T17:57:33.247Z |
| 3 | 04 | deviation | packages/bridge/src/proof-controller.ts |  | Controller now requires an explicit configured Role B IPv6 target; no fallback target is allowed. | open |  | 2026-07-24T10:28:35.904Z |  |
| 4 | 04 | deviation | compose.fips.yml |  | Pulled forward the private FIPS control-socket volume prerequisite so the bounded bridge probe can use only /run/fips/control.sock. | open |  | 2026-07-24T10:39:57.137Z |  |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "01",
    "file": "scripts/audit-dependencies.mjs",
    "line": null,
    "description": "Temporary official Node 22.23.1 runtime was required because the host ran Node 25.2.1.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-23T14:50:10.558Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "01",
    "file": "packages/bridge/src/server.ts",
    "line": null,
    "description": "Runner stamps qualification results in memory but does not persist a complete MachineReport from Quiet receiver evidence.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-07-23T17:42:43.795Z",
    "resolved_at": "2026-07-23T17:57:33.247Z"
  },
  {
    "id": 3,
    "kind": "deviation",
    "phase": "04",
    "file": "packages/bridge/src/proof-controller.ts",
    "line": null,
    "description": "Controller now requires an explicit configured Role B IPv6 target; no fallback target is allowed.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-24T10:28:35.904Z",
    "resolved_at": null
  },
  {
    "id": 4,
    "kind": "deviation",
    "phase": "04",
    "file": "compose.fips.yml",
    "line": null,
    "description": "Pulled forward the private FIPS control-socket volume prerequisite so the bounded bridge probe can use only /run/fips/control.sock.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-24T10:39:57.137Z",
    "resolved_at": null
  }
]
````
