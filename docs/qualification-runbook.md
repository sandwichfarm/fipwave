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
  --tun-evidence .artifacts/qualification/tun-exact-host.json --physical-open-air
```

Open `http://127.0.0.1:4173/` in Chromium, grant the microphone, and choose
`Arm modem`. The fixed fallback is `audible-7k-channel-0` with frame clamping;
there is no profile or asset override. Quiet takes exclusive ownership of its
microphone and audio context after the normal audio lifecycle has been reset.
Physical mode refuses a dirty worktree, an unresolved/default build identity,
or any exact-host TUN field that is not passed.

After a Cyrinx rejection, both pages automatically arm Quiet for listening but
neither transmits automatically. On laptop A choose **Send Quiet A → B
corpus**. The
sender starts one corpus case at a time only after its own Quiet `onFinish` and
a fixed guard; it never waits for a receiver result, acknowledgement, retry,
or ARQ. After the operator sees A's local transmitter finish, locally schedule
**B → A** with **Send Quiet B → A corpus** on laptop B. Each receiver
independently records and deduplicates
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
claim that fallback was activated. Both reports retain the runner-owned Cyrinx
start, deadline, elapsed timing, cold-frame authority, and terminal stage.

The canonical qualification timeout is runner-owned and fixed at 30,000 ms.
Complete-payload p95 airtime must be strictly less than one third of it
(10,000 ms). Queue duration high-water marks may be at most 10,000 ms: this
accommodates the measured ~5.49 s Quiet 1,536-byte emission while remaining
bounded. PCM byte caps and the zero-discontinuity requirement are unchanged.
Physical audio evidence retains the observed microphone label, a `running`
AudioContext state, native `inputDeviceSampleRate` and
`inputDeviceChannels`, actual mono 48 kHz AudioContext/codec-consumed PCM
rates, and all three processing flags off.
Native input may be 44.1 or 48 kHz; the former is accepted only as the explicit
WebAudio 44.1 → 48 kHz resampling boundary. Unknown or other native rates fail.
Native input may be one or two channels; a two-channel device is accepted only
as the explicit WebAudio downmix to the codec's required mono graph. Other
native layouts fail.

## Deterministic checks (any development machine)

Use Node 22.23.1, then run:

```sh
npm run test:compose
npm run test:unit -- tests/tun-preflight.test.ts
```

## Cyrinx early-abandonment gate

Cyrinx is a bounded batch experiment, not an acoustic qualification claim.
The commands below are deterministic preflight only; they do not create or
replace physical evidence. After both pages are armed, start Cyrinx on both
laptops within one second. Each runner stamps its own immutable 90-minute
deadline **before** it repeats the verified build and digital gate, then executes
only this order: locked archive/hash/licenses and portable C build; digital
256- and 1,536-byte round trips; one cold A → B frame; one cold B → A frame;
then the corpus. The first miss records one immutable reason and activates the
already runnable Quiet path; do not restart or extend Cyrinx after RESET,
reload, or re-arm.

```sh
npm run fetch:codecs
npm run fetch:codecs:check
npm run cyrinx:build
npm run cyrinx:test
npm run qualification:serve -- --machine-id laptop-a --role A --port 4173 \
  --report .artifacts/qualification/laptop-a.json \
  --tun-evidence .artifacts/qualification/tun-exact-host.json --physical-open-air
```

The pinned profile is `bulk-qpsk-r1-2-48k-v1`: 48 kHz mono, QPSK rate 1/2,
2048 FFT, 768 CP, 18 symbols, 8-bin pilots, and 0.18 peak. It encodes one
62,464-sample modem frame. The 1,792-byte PHY payload contains mandatory
256-byte metadata, so its honest application MTU is **1,536 bytes**. Browser
wire playback contains only that modem frame; Web Audio locally appends a
300 ms zero guard on the left channel and renders the right channel all-zero.
Capture is bounded to one mono 2–3-second batch window.

Excluded work: Swift integration, WASM, arbitrary-chunk streaming decode,
stereo/MRC capture, adaptive profiles, Cyrinx sessions, retransmission, and
ARQ. A digital or Loopback result is never proof of speakers, microphones, or
the final FIPS ping; preserve failed evidence and complete the exact-laptop
manual checkpoint before making any physical claim.

The browser is not the Cyrinx scheduler. It requests only `start_cyrinx` and
then follows runner snapshots. The runner assigns each cold/corpus case as
either `transmit` or `listen` based on role and literal direction: a sender
plays one frame and sends no microphone evidence; only the opposite laptop
captures and reports the result. During a listen instruction the browser sends
at most one 2.731-second capture window: 64 contiguous 2,048-sample mono
batches, with a per-case sample offset beginning at zero. FWAV header sequence
remains globally monotonic for anti-replay and is not a sample offset.
Because the corpus contains consecutive cases in each direction, the runner
also holds every transmitter for a fixed 4.5-second case interval before it
issues the next instruction. This keeps a faster playback completion from
overtaking the opposite laptop's bounded capture and native decode window.

RESET stops local capture and audio before the runner changes epoch. It clears
the active native case but does not restart Cyrinx or alter its original
deadline/reason. After a runner-authorized fallback, re-arm may restore audio
for Quiet only; it cannot create a second Cyrinx attempt.

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
node scripts/check-compose.mjs --exact-host \
  --inspect-json .artifacts/qualification/tun-inspect.json \
  --lifecycle-json .artifacts/qualification/tun-lifecycle.json \
  > .artifacts/qualification/tun-exact-host.json
docker compose -f compose.preflight.yml down --remove-orphans
```

Pass `tun-exact-host.json` to that laptop's physical qualification runner and
save every JSON/NDJSON input with the matching machine report. The
static/inspect records must report `NET_ADMIN` and
`no-new-privileges:true`, exactly `/dev/net/tun`, `Privileged: false`, no
`SYS_ADMIN`, `networkMode: "none"`, and no published ports. The lifecycle
record must report that it created `fips-preflight0`, assigned
`fd42:6677:6677::1/64`, captured detailed link/address output, and cleaned up
the owned interface.

If Docker Desktop or Linux Engine cannot expose `/dev/net/tun`, retain the
failing `TunEvidence` and stop. That is a hardware qualification failure, not
permission to widen the container authority or infer success from the fake
lifecycle test.
