---
quick_id: 260728-l2x
status: incomplete
---

# Image over FIPS implementation summary

Implemented a fixed FIPS-banner transfer after authenticated proof readiness.
No image-related UI appears before that gate. Once ready, Node A renders the
complete bundled banner in the stage panel and sends a 96×34 RGBA raster as
bounded UDP/IPv6 bands to Node B's configured FIPS address. Node B creates its
canvas in the same location and progressively paints received bands.

The runner and FIPS daemon share a network namespace, so the exact peer ULA
destination routes application datagrams through `fips0`; the browser does not
have a peer-to-peer shortcut. The server bounds geometry, payload size, role,
origin, transfer state, remote peer address, and proof readiness. The fixed
raster is 12 IPv6-safe bands, below the 16-packet acoustic queue limit.

The live `peer proof pending` failure was traced to a duplicate browser
readiness projection closing the bridge, followed by the daemon's exponentially
delayed startup retry. Identical readiness projections are now idempotent and
Role A initiates a bounded configured sound-peer connect as soon as the acoustic
bridge is ready.

Automated evidence:

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run test:unit` passed: 32 files, 284 tests.
- `npm run build` passed.
- Dashboard browser regression passed: 5 tests.
- Production-runner regression passed: 45 tests.
- Demo launcher regression passed: 6 tests.

Remaining gate: establish the real two-laptop Sound link, send the image from
Node A, and observe Node B paint multiple bands before reaching 34/34 rows.
`demo:staggered` now rebuilds both role-specific bridge images before launching
either role so a previous immutable asset bundle cannot hide the fix.
