# Laptop-to-Laptop Acoustic Test

This guide tests the real speaker-to-microphone path between two laptops and
produces the two reports required to select Cyrinx or Quiet.

It does **not** yet establish a FIPS peer or carry an IPv6 ping. A passing
result is the current POC's qualification signal for the acoustic substrate;
read the evidence limitations below before making a stronger claim.

## Test map

| Laptop | Machine ID | Role | Sends first | Report contains independently received |
|---|---|---|---|---|
| Laptop A | `laptop-a` | `A` | A → B | B → A |
| Laptop B | `laptop-b` | `B` | B → A, after A finishes | A → B |

Use the same names consistently in the runner commands and final verifier.
Substitute different names only if you use those exact names everywhere.

## Before you start

You need:

- Two laptops running macOS/macOS or macOS/Linux.
- Chromium or Google Chrome on both.
- Built-in or directly connected speakers and microphones. Avoid Bluetooth,
  headphones, virtual audio devices, and conferencing software.
- Node `22.23.1`, as pinned by `.node-version` and `package.json`.
- Docker Desktop on macOS, or Docker Engine with Compose v2 on Linux.
- The same clean Git commit on both laptops.

Use a quiet room. As a starting arrangement, place the laptops 0.5–1 metre
apart with their speakers and microphones unobstructed, and set both output
volumes around 60–75%. Adjust placement or volume before starting Cyrinx, not
by changing protocol thresholds during a run.

## 1. Prepare the same build on both laptops

Run every command in this section on **both laptops**, from the repository
root, while network access is still available.

Activate Node `22.23.1` with your normal version manager, then verify it:

```sh
node --version
```

Expected:

```text
v22.23.1
```

Install and verify the project:

```sh
npm ci
npm run verify:dependencies
npm run fetch:codecs
npm run fetch:codecs:check
npm run build
npm run cyrinx:test
npm run check
```

Confirm both laptops print the same commit and have no working-tree changes:

```sh
git rev-parse HEAD
git status --short
```

The first command must match on both laptops. The second command must print
nothing. Physical mode intentionally refuses an unresolved or dirty build.

If Chromium is missing from the Playwright cache and `npm run check` asks for
it, install the pinned browser and rerun the check:

```sh
npx playwright install chromium
npm run check
```

## 2. Collect exact-host Docker/TUN evidence

Run this entire section independently on **each laptop**. Do not copy one
laptop's TUN evidence to the other.

```sh
mkdir -p .artifacts/qualification
docker compose -f compose.preflight.yml build
docker compose -f compose.preflight.yml config --format json \
  > .artifacts/qualification/tun-compose.json
node scripts/check-compose.mjs \
  | tee .artifacts/qualification/tun-static.json
node scripts/check-compose.mjs \
  --compose-json .artifacts/qualification/tun-compose.json \
  | tee .artifacts/qualification/tun-rendered.json
docker compose -f compose.preflight.yml create tun-preflight
docker inspect "$(docker compose -f compose.preflight.yml ps -aq tun-preflight)" \
  > .artifacts/qualification/tun-inspect.json
node scripts/check-compose.mjs \
  --inspect-json .artifacts/qualification/tun-inspect.json \
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

Inspect the final record:

```sh
node -e "const fs=require('node:fs'); const e=JSON.parse(fs.readFileSync('.artifacts/qualification/tun-exact-host.json','utf8')); console.log(JSON.stringify({source:e.source,status:e.status,checks:e.checks},null,2))"
```

Required result:

- `source` is `exact_host`.
- `status` is `passed`.
- Every check is `passed`.
- Authority remains exactly `/dev/net/tun`, `NET_ADMIN`,
  `no-new-privileges:true`, non-privileged, no `SYS_ADMIN`,
  `network_mode: none`, and no published ports.

If this fails, stop and keep the failing evidence. Do not add `privileged`,
`SYS_ADMIN`, host networking, or broader device access.

## 3. Prepare the room and isolate the test

On both laptops:

1. Select the intended built-in speaker and microphone as the OS defaults.
2. Close Zoom, Teams, Discord, music players, and anything else using audio.
3. Disable Bluetooth audio. On macOS, use the normal microphone mode rather
   than Voice Isolation.
4. Mute notification sounds and prevent either laptop from sleeping.
5. After all dependencies and images are available, turn off Wi-Fi and
   disconnect Ethernet for the acoustic run. Each page communicates only with
   its own runner over `127.0.0.1`.
6. Check that the chosen local port is not occupied by an old runner. If it
   is, stop that runner or choose another port and use the printed URL.

Port checks:

```sh
# macOS
lsof -nP -iTCP:4173 -sTCP:LISTEN

# Linux
ss -ltnp | grep ':4173'
```

No output means port `4173` is available. Both separate laptops may use the
same local port.

## 4. Start the physical runners

On **Laptop A**:

```sh
npm run qualification:serve -- \
  --machine-id laptop-a \
  --role A \
  --port 4173 \
  --report .artifacts/qualification/laptop-a.json \
  --tun-evidence .artifacts/qualification/tun-exact-host.json \
  --physical-open-air
```

On **Laptop B**:

```sh
npm run qualification:serve -- \
  --machine-id laptop-b \
  --role B \
  --port 4173 \
  --report .artifacts/qualification/laptop-b.json \
  --tun-evidence .artifacts/qualification/tun-exact-host.json \
  --physical-open-air
```

Each terminal should print:

```text
FIPS over Sound runner listening on http://127.0.0.1:4173
```

Leave both terminals running. Open the printed local URL in Chromium on its
own laptop.

Before arming, open `http://127.0.0.1:4173/qualification-config` in a second
tab and verify:

| Field | Laptop A | Laptop B |
|---|---|---|
| `machineId` | `laptop-a` | `laptop-b` |
| `role` | `A` | `B` |
| `evidenceClass` | `Open air` | `Open air` |
| `tunEvidenceSource` | `exact_host` | `exact_host` |
| `reportTarget` | ends in `laptop-a.json` | ends in `laptop-b.json` |
| `buildCommit` | same 40-character commit on both | same as A |

Do not continue if either page says `Loopback`, has the wrong role, or names
the wrong report.

Keep exactly one main qualification page open on each laptop. The
`/qualification-config` JSON tab is safe, but a second main page would compete
for the runner's single tab epoch. Do not reload the main page after arming.

## 5. Arm browser audio

On each main qualification page:

1. Click **Arm modem** once.
2. Grant microphone permission.
3. Wait for the status badge to show **Ready** and for the page to say
   **Audio preflight passed on this laptop**.

Verify the **Applied audio evidence** table:

- Microphone label is present.
- Audio-context state is `running`.
- Web Audio context sample rate is `48000`.
- Input-device sample rate is `44100` or `48000`.
- Codec capture PCM sample rate is `48000`.
- Input-device channels are `1` or `2`.
- Codec capture PCM channels are `1`.
- Echo cancellation is `false`.
- Noise suppression is `false`.
- Automatic gain control is `false`.
- AudioWorklet status is `ready`.
- Bridge endpoint is `localhost only`.

If either page shows **Failed** or **Disconnected before Cyrinx has started**,
use **Reset / re-arm** after fixing the device, permission, or local runner.
Once Cyrinx has started, do not use reset to erase or restart a failed
qualification. Preserve that run's reports instead.

Do not infer success from the requested settings; the displayed applied
values must pass.

## 6. Run the Cyrinx attempt

Only begin when both pages are Ready and both laptops are in their final
physical positions.

1. Click **Start Cyrinx qualification** on both laptops within about one
   second.
2. Do not click Reset, restart Cyrinx, or manually schedule cases.
3. Watch **Bridge delivery** on both pages. This is the authoritative live
   status. The runner owns this order:
   `build` → `digital` → `cold-a-to-b` → `cold-b-to-a` → `corpus`.
4. Cyrinx transmission, capture, and corpus progression are automatic.

The deadline is a single immutable 90-minute window beginning before the
runner repeats the native build and digital tests.

Ignore the gate card's static `1:30:00` text and checklist for live progress.
They are presentation hints, not the runner's current deadline or stage.

There are two valid outcomes:

### Cyrinx completes

Both pages reach `Cyrinx gate: complete`. Continue to step 8; do not run the
Quiet buttons.

### Cyrinx is rejected

The first failure records one of:

- `cyrinx_build_failed`
- `cyrinx_digital_roundtrip_failed`
- `cyrinx_cold_a_to_b_failed`
- `cyrinx_cold_b_to_a_failed`
- `cyrinx_corpus_failed`
- `cyrinx_deadline_expired`

Both pages should transition to a message like:

```text
Cyrinx rejected: <reason>; Quiet is runner-authorized
```

That message can be transient and may be replaced by
`Quiet audio settings accepted`. Proceed only when both pages actually say
Quiet is armed and listening and show their role-specific Quiet send button.
A rejection message by itself is not proof that Quiet armed successfully;
the local report's `qualification.fallback` object preserves the authoritative
reason. Do not retry or extend Cyrinx. Continue with step 7.

If the laptops end on different codecs or one never reaches a terminal state,
stop and preserve both reports as an unqualified run.

## 7. Run the Quiet fallback corpus

Quiet is operator-ordered and half-duplex. Do not press both send buttons at
once.

1. Confirm both pages say **Quiet armed and listening**.
2. On Laptop A only, click **Send Quiet A → B corpus**.
3. Wait until Laptop A says
   `Quiet A → B corpus sent · receiver remains armed` and Laptop B has
   recorded the received A → B cases.
4. On Laptop B only, click **Send Quiet B → A corpus**.
5. Wait until Laptop B says
   `Quiet B → A corpus sent · receiver remains armed` and Laptop A has
   recorded the received B → A cases.

Allow several minutes. Each sender schedules locally after its own completion
and guard interval. There are no remote acknowledgements, retries, or ARQ.
Never click a send button twice to compensate for a missing case.

The on-page corpus table contains both local `Sent` rows and independent
receiver rows. Do not use its total row count as the pass decision; the
canonical report files and verifier are authoritative.

Remember that the reports are intentionally reversed from the local send
role:

- `laptop-a.json` proves what A received: B → A.
- `laptop-b.json` proves what B received: A → B.

## 8. Stop, collect, and verify the reports

After the surviving codec has finished on both laptops:

1. For Cyrinx, wait until each page's **Bridge delivery** line says
   `Cyrinx gate: complete`. For Quiet, wait for the sender-finished message on
   each laptop and the final `Result accepted` message on each receiving
   laptop.
2. While both runners are still active, open a second terminal on each laptop
   and set the local report path.

   Laptop A:

   ```sh
   export FIPWAVE_REPORT=.artifacts/qualification/laptop-a.json
   ```

   Laptop B:

   ```sh
   export FIPWAVE_REPORT=.artifacts/qualification/laptop-b.json
   ```

3. Run this same inspection command on both laptops:

   ```sh
   node - <<'NODE'
   const fs = require('node:fs');
   const report = JSON.parse(fs.readFileSync(process.env.FIPWAVE_REPORT, 'utf8'));
   const passes = (result) =>
     result.observed === true &&
     result.complete === true &&
     result.corrupt === false &&
     result.missing === 0 &&
     result.duplicates === 0 &&
     result.deliveryCount === 1 &&
     result.bytePerfect === true &&
     result.receivedSha256 === result.expectedSha256;
   const passed256 = report.results.filter((result) => result.size === 256 && passes(result)).length;
   const passed1536 = report.results.filter((result) => result.size === 1536 && passes(result)).length;
   const corpusThreshold = passed256 >= 19 && passed1536 === 5;
   const strongQuietEvidence = report.codec?.id !== 'quiet' || passed256 === 20;
   console.log(JSON.stringify({
     complete: report.complete,
     physicalGate: report.qualification?.physicalGate,
     codec: report.codec?.id,
     passed256,
     passed1536,
     corpusThreshold,
     strongQuietEvidence,
     reasonCodes: report.reasonCodes,
   }, null, 2));
   if (
     report.complete !== true ||
     report.qualification?.physicalGate !== 'passed' ||
     !corpusThreshold ||
     !strongQuietEvidence
   ) process.exit(1);
   NODE
   ```

   Both commands must exit successfully with `complete: true`,
   `physicalGate: "passed"`, and `strongQuietEvidence: true`. A Quiet report
   must show `passed256: 20`; this is deliberately stricter than the selector's
   19/20 threshold because of the current partial-case limitation described
   below. A Quiet report may retain the authentic Cyrinx fallback reason in
   `reasonCodes`; do not erase it. If either command fails, preserve the run as
   pending or failed rather than treating it as strong demo evidence.

4. Stop each runner with `Ctrl+C`.
5. Re-enable networking only after the acoustic run has ended, if needed to
   transfer files.
6. Preserve each laptop's full `.artifacts/qualification/` directory under a
   separate host-named archive so identically named TUN files do not overwrite
   each other.
7. Copy both machine report files to one operator laptop without editing them.

From the repository root on the operator laptop:

```sh
npm run qualify:verify -- \
  --machine-a .artifacts/qualification/laptop-a.json \
  --machine-b .artifacts/qualification/laptop-b.json \
  --host-a laptop-a \
  --host-b laptop-b \
  --selection .artifacts/qualification/selection.json
```

Show the decision:

```sh
node -e "const fs=require('node:fs'); const s=JSON.parse(fs.readFileSync('.artifacts/qualification/selection.json','utf8')); console.log(JSON.stringify({decision:s.decision,reasonCodes:s.reasonCodes},null,2))"
```

A qualifying run has:

```json
{
  "decision": "cyrinx",
  "reasonCodes": []
}
```

or:

```json
{
  "decision": "quiet",
  "reasonCodes": []
}
```

`human_needed` means reports are missing or nonphysical. `unqualified` means
the physical evidence was present but failed one or more gates; preserve the
reported reason codes.

## Pass criteria

The verifier requires all of the following:

- Ordered Laptop A/role A and Laptop B/role B reports from the same clean
  commit.
- Runner-stamped `Open air` evidence and one passing `exact_host` TUN record
  per laptop.
- Matching fixed, intentionally audible codec identity with advertised MTU at
  least 1,357 bytes.
- Real cold acquisition in both literal directions.
- At least 19/20 unique, byte-perfect, exactly-once 256-byte cases and 5/5
  1,536-byte cases in each direction.
- For Quiet, the first canonical 256-byte case in each direction supplies the
  cold-acquisition evidence and therefore cannot be the optional missing case.
- Complete-payload p95 airtime strictly below 10,000 ms, one third of the
  fixed 30,000 ms dead-link timeout.
- Capture and playback queue high-water marks at most 256 KiB each, queue
  high-water duration at most 10,000 ms, and zero discontinuities.
- For Quiet, a genuine runner-authorized Cyrinx fallback with its original
  reason. For Cyrinx, terminal stage `complete` with no fallback activation.

Do not change thresholds, report JSON, evidence class, asset identities,
deadline, or container privileges to turn a failure into a pass.

## Known POC evidence limitations

- The selector formally permits one entirely unobserved, non-first 256-byte
  case per direction. Quiet currently flushes an in-progress partial case only
  during reset, not normal corpus completion, so a partial case can resemble
  that allowed miss. The 20/20 local check in step 8 is the conservative
  demo-day workaround.
- Playback queue high-water telemetry does not yet cover both complete outbound
  paths: Quiet can omit role B's final playback high-water update, and Cyrinx
  currently reports playback high-water as zero. The verifier still evaluates
  the recorded queue fields, but a pass is not proof of fully instrumented
  two-host playback queue behavior.

## Troubleshooting

| Symptom | Action |
|---|---|
| Runner rejects a dirty build | Use the same clean committed checkout on both laptops; do not hand-edit evidence. |
| Runner rejects TUN evidence | Rerun step 2 and retain the actual failure. Do not widen Docker authority. |
| Port already in use | Stop the old local runner or choose another port and open the URL printed by the new runner. |
| Microphone permission denied | Grant Chromium microphone access, confirm the intended default input, then use **Reset / re-arm**. |
| Processing flags are `true` or settings are unknown | Close software that owns/processes the microphone, select a normal hardware input, and re-arm. The run cannot qualify while applied values fail. |
| Browser becomes Disconnected before Cyrinx starts | Confirm its local runner is still active, then use **Reset / re-arm**. |
| Browser becomes Disconnected after Cyrinx starts | Preserve the failure and reports. Do not use reset to create a second Cyrinx attempt. |
| Cyrinx rejects | Record the first reason and allow automatic Quiet fallback. Never restart Cyrinx in the same qualification. |
| Quiet misses or corrupts cases | Finish the ordered run, preserve every missing/corrupt row, and accept the verifier's decision. The formal selector can tolerate one entirely unobserved non-first 256-byte case per direction, but the strong demo check in step 8 requires 20/20. Any observed corrupt, partial, or duplicate case fails, and `*-256-01` must pass. Do not resend individual cases. |
| Verifier returns `ordered_hosts_required` or `ordered_roles_required` | Use the A report with `--machine-a/--host-a` and the B report with `--machine-b/--host-b`; do not swap them. |
| UI Docker/TUN or Decision card still says pending/missing | Expected: those cards are static presentation text. Use the embedded report evidence and `qualify:verify` output. |

For schema details and background rationale, see
[qualification-runbook.md](qualification-runbook.md).
