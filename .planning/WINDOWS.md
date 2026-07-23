---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 0
total_count: 2
last_updated: 2026-07-23T17:42:43.795Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | deviation | scripts/audit-dependencies.mjs |  | Temporary official Node 22.23.1 runtime was required because the host ran Node 25.2.1. | open |  | 2026-07-23T14:50:10.558Z |  |
| 2 | 01 | stub | packages/bridge/src/server.ts |  | Runner stamps qualification results in memory but does not persist a complete MachineReport from Quiet receiver evidence. | open |  | 2026-07-23T17:42:43.795Z |  |

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
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-23T17:42:43.795Z",
    "resolved_at": null
  }
]
````
