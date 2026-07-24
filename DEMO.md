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
