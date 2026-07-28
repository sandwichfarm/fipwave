---
quick_id: 260728-l2x
status: incomplete
---

# Image over FIPS implementation summary

Implemented a fixed FIPS-banner transfer after proof readiness. Node A renders
the complete bundled banner in the stage panel from the initial screen and
sends a 96×34 RGBA raster as bounded UDP/IPv6 bands to Node B's configured FIPS
address. Node B shows its canvas in the same stage-panel location and
progressively paints received bands.

The runner and FIPS daemon share a network namespace, so the exact peer ULA
destination routes application datagrams through `fips0`; the browser does not
have a peer-to-peer shortcut. The server bounds geometry, payload size, role,
origin, transfer state, and remote peer address.

Automated evidence:

- `npm run typecheck` passed.
- `npm run test:unit` passed: 31 files, 278 tests.
- `npm run build` passed.
- `npm run test:browser` passed: 18 tests.

Remaining gate: establish the real two-laptop Sound link, send the image from
Node A, and observe Node B paint multiple bands before reaching 34/34 rows.
`demo:staggered` now builds the current UI before launching either role so a
previous immutable asset bundle cannot hide the image placement.
