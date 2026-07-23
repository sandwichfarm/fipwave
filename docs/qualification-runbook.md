# Qualification Runbook

This runbook records deterministic preflight evidence for each demo laptop. It
does **not** prove the two-laptop acoustic hop or FIPS ping. Only two reports
with runner-stamped `Open air` identity and passed `exact_host` TUN records can
do that; all other paths remain explicitly `human_needed` or `unqualified`.

## Browser Quiet fallback (two independent local roles)

Populate the pinned cache once on each laptop, build, and start one runner per
laptop. The runner is the only authority for machine identity, literal role,
report target, TUN path, evidence class, clean Git build identity, fixed codec,
30,000 ms dead-link timeout, and immutable Cyrinx/fallback trace; the page only
displays them.

```sh
npm run fetch:codecs
npm run build
npm run start:runner -- --machine-id laptop-a --role A --port 4173 \
  --report .artifacts/qualification/laptop-a.json \
  --tun-evidence .artifacts/qualification/laptop-a-tun.json --physical-open-air
```

Open `http://127.0.0.1:4173/` in Chromium, grant the microphone, and choose
`Arm modem`. The fixed fallback is `audible-7k-channel-0` with frame clamping;
there is no profile or asset override. Quiet takes exclusive ownership of its
microphone and audio context after the normal audio lifecycle has been reset.
Physical mode refuses a dirty worktree, an unresolved/default build identity,
or any exact-host TUN field that is not passed.

Operate the pages independently. On laptop A locally schedule **A → B**. The
sender starts one corpus case at a time only after its own Quiet `onFinish` and
a fixed guard; it never waits for a receiver result, acknowledgement, retry,
or ARQ. After the operator sees A's local transmitter finish, locally schedule
**B → A** on laptop B. Each receiver independently records and deduplicates
fragments, reassembles complete cases, and validates the committed SHA-256.
The pages never exchange control messages. One browser tab owns an epoch; a
second tab cannot contribute evidence. Reconnection is accepted only after a
RESET has atomically replaced the prior report with a new-epoch incomplete
record.

Role names describe the local laptop, while reports describe independently
received sound: role A's report owns **B → A**, and role B's report owns
**A → B**. Each report always contains the exact 25 committed rows for its
receive direction. Unheard rows remain explicit Missing placeholders with
`receivedSha256: null`; received rows bind case ID, direction, size,
`expectedSha256`, and the observed `receivedSha256` to the committed manifest.
At least 19/20 distinct byte-perfect 256-byte rows and 5/5 1,536-byte rows must
pass in each direction. The optional missing 256-byte row is not itself a
failure once that threshold is met.

Copy the two completed canonical reports to one operator machine and reconcile
them only after both local runs have ended:

```sh
npm run qualify:verify -- \
  --machine-a .artifacts/qualification/laptop-a.json \
  --machine-b .artifacts/qualification/laptop-b.json \
  --host-a laptop-a --host-b laptop-b \
  --selection .artifacts/qualification/selection.json
```

The exact `--selection` path is atomically written. Its decision is one of
`cyrinx`, `quiet`, `unqualified`, or `human_needed`. `human_needed` is reserved
for absent/manual evidence or Fixture/Loopback evidence. Present physical
evidence with mismatched roles/ordered hosts/builds, missing thresholds,
duplicates, corruption, bad timing, unsupported codec identity, or failed TUN
checks is `unqualified` with precise reason codes.

A physical Quiet selection additionally requires an activated Cyrinx → Quiet
fallback with its immutable failure/expiry reason. A Cyrinx selection must not
claim that fallback was activated. Both reports retain the Cyrinx start,
deadline, and elapsed timing; until Plan 01-09 supplies that trace, the current
Quiet runner remains intentionally fail-closed for physical selection.

The canonical qualification timeout is runner-owned and fixed at 30,000 ms.
Complete-payload p95 airtime must be strictly less than one third of it
(10,000 ms). Queue duration high-water marks may be at most 10,000 ms: this
accommodates the measured ~5.49 s Quiet 1,536-byte emission while remaining
bounded. PCM byte caps and the zero-discontinuity requirement are unchanged.
Physical audio evidence retains the observed microphone label, a `running`
AudioContext state, the native `inputDeviceSampleRate`, actual mono 48 kHz
AudioContext/codec-consumed PCM rates, and all three processing flags off.
Native input may be 44.1 or 48 kHz; the former is accepted only as the explicit
WebAudio 44.1 → 48 kHz resampling boundary. Unknown or other native rates fail.

## Deterministic checks (any development machine)

Use Node 22.23.1, then run:

```sh
npm run test:compose
npm run test:unit -- tests/tun-preflight.test.ts
```

The first command emits one `TunEvidence` JSON object with `source: "static"`.
The second uses a fake `ip` binary and `/dev/null`, never Docker or a real TUN
device. Both are diagnostic evidence only.

For deterministic browser/bridge plumbing, start the runner without
`--physical-open-air` (it defaults to `Loopback`). This is intentionally useful
for the production Chromium test and reports, but its output is not eligible
for selection and must never be relabelled Open air.

## Exact-host Docker/TUN evidence

On **each** demo laptop, run from the same checked-out commit. Docker Desktop
must be running on macOS; Linux requires Docker Engine plus Compose v2. Do not
replace the Compose configuration with `privileged`, `SYS_ADMIN`, host
networking, or a non-loopback published port if the host initially fails.

```sh
mkdir -p .artifacts/qualification
docker compose -f compose.preflight.yml build
docker compose -f compose.preflight.yml config --format json > .artifacts/qualification/tun-compose.json
node scripts/check-compose.mjs | tee .artifacts/qualification/tun-static.json
node scripts/check-compose.mjs --compose-json .artifacts/qualification/tun-compose.json \
  | tee .artifacts/qualification/tun-rendered.json
docker compose -f compose.preflight.yml create tun-preflight
docker inspect "$(docker compose -f compose.preflight.yml ps -aq tun-preflight)" > .artifacts/qualification/tun-inspect.json
node scripts/check-compose.mjs --inspect-json .artifacts/qualification/tun-inspect.json \
  | tee .artifacts/qualification/tun-authority.ndjson
docker compose -f compose.preflight.yml run --rm tun-preflight \
  | tee .artifacts/qualification/tun-lifecycle.log
tail -n 1 .artifacts/qualification/tun-lifecycle.log \
  > .artifacts/qualification/tun-lifecycle.json
docker compose -f compose.preflight.yml down --remove-orphans
```

Save the three JSON/NDJSON outputs with the matching machine report for Plan
01-07. The static/inspect records must report `NET_ADMIN` and
`no-new-privileges:true`, exactly `/dev/net/tun`, `Privileged: false`, no
`SYS_ADMIN`, `networkMode: "none"`, and no published ports. The lifecycle
record must report that it created `fips-preflight0`, assigned
`fd42:6677:6677::1/64`, captured detailed link/address output, and cleaned up
the owned interface.

If Docker Desktop or Linux Engine cannot expose `/dev/net/tun`, retain the
failing `TunEvidence` and stop. That is a hardware qualification failure, not
permission to widen the container authority or infer success from the fake
lifecycle test.
