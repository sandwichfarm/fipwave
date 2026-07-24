# FIPS Upstream Provenance

## Immutable source

- **Upstream URL:** https://github.com/jmcorgan/fips
- **Immutable commit:** [`fc8ebd5a06d6f042c57f03107f403116365a16b4`](https://github.com/jmcorgan/fips/commit/fc8ebd5a06d6f042c57f03107f403116365a16b4)
- **Commit source date:** 2026-07-23T03:23:18Z
- **Upstream Git tree:** `b645c01f271b7d62412ae1546007c5da32e2b947`
- **Package version:** `0.5.0-dev`
- **License:** MIT (`LICENSE` retained verbatim)
- **Pinned toolchain:** Rust `1.94.1` from the retained `rust-toolchain.toml`

This directory is a normal source snapshot with no upstream Git history. It was
imported from the exact GitHub commit archive, not from a mutable branch. Normal
builds use the committed directory and Cargo lockfile only; they do not clone,
fetch, or otherwise follow upstream `master`.

## Reproducible import procedure

1. Fetch `https://github.com/jmcorgan/fips/archive/fc8ebd5a06d6f042c57f03107f403116365a16b4.tar.gz`.
2. Extract its single `fips-fc8ebd5a06d6f042c57f03107f403116365a16b4/` root as `vendor/fips/`.
3. Confirm the immutable commit and tree through the GitHub commit API, then
   verify the pre-patch identities below before applying the listed local patches.
4. Run `cargo metadata --locked --format-version 1` and `cargo test --no-run --locked` from this directory.

## Pre-patch identity

The following SHA-256 values were captured from the unmodified source snapshot
before the local dependency patch:

| File | SHA-256 |
| --- | --- |
| `Cargo.toml` | `dbfa65950e47137948ca765a25147a34fc5c252deed7a2cf2add85173738dc3c` |
| `Cargo.lock` | `f35b9d6d83999b35bcd62e9cba138b3de54ca090816cca0873218488b361b01c` |
| `LICENSE` | `574561d7bedffa84106ff132e16904f7768cd12d13fc10166ac89e276c6b72ef` |
| `rust-toolchain.toml` | `6a95738ee0eea5867a071922541a1ccaac80c63ccba5c947eb78b6130e1b22d3` |

The unpatched target passed `cargo metadata --locked --format-version 1` and
`cargo test --no-run --locked` with the pinned Rust `1.94.1` toolchain on
2026-07-24.

## Authorized local patch inventory

| File | Local change | Reason |
| --- | --- | --- |
| `Cargo.toml` | Add `tokio-tungstenite = "=0.30.0"` | Audited local WebSocket client for the later sound transport. |
| `Cargo.lock` | Locked resolution for the approved direct dependency and its transitive packages. | Reproducible dependency graph. |
| `src/config/transport.rs` | Validate the local Sound WebSocket endpoint structurally rather than by prefix. | Keep opaque packets inside the shared loopback namespace. |
| `src/transport/sound/mod.rs` | Add the current-epoch browser arm/disarm control, strict Origin-bearing client request, truthful readiness, and bounded outbound bytes. | Make the local FIPS transport usable and fail closed under the browser-owned audio boundary. |
| `UPSTREAM.md` | Add this provenance and patch inventory record. | Make the vendor base independently auditable. |

No source transport behavior is patched in this import plan.

## Dependency legitimacy and lock policy

`tokio-tungstenite = "=0.30.0"` is the only direct dependency added locally.
It is the Phase 2 Package Legitimacy Audit-approved crates.io package for the
loopback WebSocket client. `cargo metadata --locked --format-version 1` resolves
the direct dependency at exactly `0.30.0`; upstream Tokio and futures are reused,
so no second async runtime is introduced. The upstream graph retains an older
transitive `tokio-tungstenite` only where its upstream dependency requires it.

No package marked `[ASSUMED]`, `[SUS]`, or `[SLOP]` is installed by this patch.
All later builds and tests must use `--locked`.
