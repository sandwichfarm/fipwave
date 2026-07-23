# Qualification Runbook

This runbook records deterministic preflight evidence for each demo laptop. It
does **not** prove the two-laptop acoustic hop or FIPS ping. Those exact-host
claims remain the Plan 01-07 hardware checkpoint.

## Deterministic checks (any development machine)

Use Node 22.23.1, then run:

```sh
npm run test:compose
npm run test:unit -- tests/tun-preflight.test.ts
```

The first command emits one `TunEvidence` JSON object with `source: "static"`.
The second uses a fake `ip` binary and `/dev/null`, never Docker or a real TUN
device. Both are diagnostic evidence only.

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
