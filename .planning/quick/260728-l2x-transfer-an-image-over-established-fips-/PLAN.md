---
quick_id: 260728-l2x
slug: transfer-an-image-over-established-fips-
status: in_progress
---

# Transfer an image over established FIPS links

## Goal

After the authenticated Sound link is ready, Node A displays the supplied FIPS
banner and can send it with one action while Node B displays that same image
progressively as bounded raster bands arrive over UDP/IPv6 through the FIPS
TUN. There is no image picker.

## Tasks

1. Add a bounded, validated UDP image-band protocol and transfer service in the
   bridge runner's shared FIPS network namespace.
2. Expose role-gated HTTP send/status endpoints and lifecycle ownership.
3. Add the fixed FIPS banner payload, Node A full preview, and Node B
   progressive canvas rendering to the audience UI.
4. Add focused protocol/server/UI tests and run typecheck, unit tests, and build.

## Verification

- Unit tests prove framing validation, ordered/out-of-order band reception,
  duplicate handling, and bounded transfer state.
- Server tests prove Role A send and Role B status endpoint gating.
- Browser tests prove Node A shows a full preview and Node B paints received
  bands incrementally.
- Typecheck and production build pass.
