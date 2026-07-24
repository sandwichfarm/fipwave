# FIPS over Sound — two-laptop speed run

## Before disconnecting Laptop B

Do this on both laptops while they still have network access:

```sh
git pull
npm ci
npm run demo:check
docker compose -f compose.fips.yml build
```

Both laptops must be on the same Git commit. Docker Desktop must be running.
On Linux, `/dev/net/tun` must exist. Chrome may show one unavoidable operating
system microphone prompt on its first run; choose **Allow**.

After permission is already granted, budget roughly 30–120 seconds for
discovery, the two directional calibration sweeps, settings commitment, and
FIPS authentication. Room acoustics can extend that time; the stage timer,
stage log, and protocol activity card must continue changing while retries are
in progress.

The canonical real-audio preflight/E2E is:

```sh
npm run demo:e2e
```

It must finish with `success: true`, independently received byte-perfect
messages in both directions, and successful browser/runner/audio cleanup. It is
single-laptop **Loopback** evidence; it validates the complete acoustic browser
path but never substitutes for the two-laptop **Open air** run below.

Place the laptops 30–60 cm apart with their speakers and microphones facing
each other. Use a quiet room and keep each system output near 65% and input
near 90%. Do not use Bluetooth audio, headphones, a virtual audio device, or
browser noise suppression.

After the build is warm, disconnect Laptop B from Wi-Fi and Ethernet. Laptop A
may remain connected to the wider mesh.

## Start the demo

Start the isolated receiver first.

Laptop B:

```sh
npm run demo -- b
```

Then start the gateway.

Laptop A:

```sh
npm run demo -- a
```

Each command owns its exact Docker project, headed Chrome instance, and
artifact directory. It grants browser microphone permission where Chrome and
the operating system allow automation, opens the audience dashboard, and
presses the single Start/Connect action. Do not open another copy of the UI.

The expected screen progression is:

```text
Starting → Discovering peer → Handshake
→ Calibrating A → B → Calibrating B → A
→ Committing settings → Connecting FIPS → Connected
```

On Laptop A, the Ping action remains disabled until the current acoustic
session, heartbeat, authenticated FIPS peer, Sound transport/link, and Laptop B
isolation attestation all agree. Run the Ping once it becomes available. A
successful result must show a real kernel IPv6 reply and matching transport
counter movement; browser/WebSocket connectivity alone is never reported as a
FIPS ping.

## Presenter script

1. “Node A still has the ordinary FIPS mesh. Node B has no network transport;
   its only route out is the room.”
2. Start B, then A. As the screens advance, say: “They discover one another,
   authenticate the expected peer, and test the room in both directions.”
3. During calibration: “The laptops are negotiating packet size, gain, and
   guard timing from byte-perfect measurements—not merely choosing the loudest
   sound.”
4. At **Connected**, point to the large FIPS TX/RX counters: “These are complete
   FIPS packets accepted across the acoustic adapter.”
5. Run the sound-only ping from A: “The absurd part is real: from FIPS’s point
   of view, sound is simply another transport hop.”

## Stop and collect evidence

Press `Ctrl-C` in each launcher terminal. The launcher closes only its owned
Chrome instance and Compose project. It captures logs, stops containers, and
writes a summary under:

```text
.artifacts/demo/<timestamp>-a/
.artifacts/demo/<timestamp>-b/
```

Check `summary.json`, `events.ndjson`, `compose.log`, and
`qualification.json`. The final physical two-laptop record is **Open air**;
single-laptop and automated evidence must remain **Loopback** or **Fixture**.

## Fast recovery

- **Stuck at Starting:** run `npm run demo:check`; confirm Docker Desktop and
  port 4310 are available.
- **Stuck at Discovering/Handshake:** confirm both Chrome windows have
  microphone access, move the laptops closer, reduce room noise, then use
  Reset on B followed by A.
- **Calibration repeatedly fails:** restore output 65%, input 90%, face the
  devices directly, and remove cases/soft surfaces blocking the speaker or
  microphone.
- **Sound is connected but FIPS is waiting:** open **Debug** on both screens
  and compare epoch, heartbeat, Sound worker, expected peer, link, and
  isolation fields. Do not restart only one side; Reset B, then A.
- **Docker reports `CAP_NET_ADMIN`:** that spelling is normal runtime output.
  The committed Compose capability is exactly `NET_ADMIN`; do not add
  `SYS_ADMIN` or privileged mode.

If a launcher is killed before cleanup, remove only its known project:

```sh
docker compose -p fipwave_demo_a -f compose.fips.yml down --volumes --remove-orphans
docker compose -p fipwave_demo_b -f compose.fips.yml down --volumes --remove-orphans
```

On a dedicated demo laptop, if Playwright-owned Chrome survives an interrupted
launcher, close every Chrome process before restarting:

```sh
pkill -x 'Google Chrome'
```

This intentionally closes unrelated Chrome windows too; use it only on the
dedicated presentation machine.

## Current verification status

- A real single-laptop, non-virtual **Loopback** run delivered 5/5 byte-perfect
  messages in each direction with output 65%, input 90%, browser playback gain
  200%, 48 kHz mono capture, and processing disabled. Evidence:
  `.artifacts/diagnostics/self-loop/20260724T110008734Z-89852/`.
- The current transmitter-serialization and playback-aware handshake-retry
  changes are covered by a silent asynchronous two-role test through Ready and
  byte-perfect packets in both directions. Venue constraints prevented another
  acoustic replay after that fix.
- No two-laptop **Open air** qualification or successful end-to-end FIPS ping
  has been recorded. Do not present Loopback, Fixture, or browser state as that
  missing physical proof.
