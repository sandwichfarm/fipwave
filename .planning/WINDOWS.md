---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-07-23T14:50:10.558Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | deviation | scripts/audit-dependencies.mjs |  | Temporary official Node 22.23.1 runtime was required because the host ran Node 25.2.1. | open |  | 2026-07-23T14:50:10.558Z |  |

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
  }
]
````
