import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { validateTunEvidence } from '../packages/bridge/src/report.js';
import { checkComposeSource, combineExactHostEvidence, validateComposeTopology, validateDockerInspect } from '../scripts/check-compose.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

function renderedCompose() {
  return {
    services: {
      'tun-preflight': {
        devices: ['/dev/net/tun:/dev/net/tun'],
        cap_add: ['NET_ADMIN'],
        security_opt: ['no-new-privileges:true'],
        privileged: false,
        network_mode: 'none',
      },
    },
  };
}

function inspect() {
  return {
    HostConfig: {
      Devices: [{ PathOnHost: '/dev/net/tun', PathInContainer: '/dev/net/tun' }],
      CapAdd: ['NET_ADMIN'],
      SecurityOpt: ['no-new-privileges:true'],
      Privileged: false,
      NetworkMode: 'none',
      PortBindings: {},
    },
  };
}

function lifecycle() {
  return {
    schemaVersion: 1,
    source: 'lifecycle',
    status: 'passed',
    image: 'alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c',
    interfaceName: 'fips-preflight0',
    ipv6Address: 'fd42:6677:6677::1/64',
    authorities: {
      devices: ['/dev/net/tun'],
      capabilities: ['NET_ADMIN'],
      securityOptions: ['no-new-privileges:true'],
      privileged: false,
      networkMode: 'none',
      publishedPorts: [],
    },
    checks: {
      imagePinned: 'not_run',
      tunDevice: 'not_run',
      netAdmin: 'not_run',
      noNewPrivileges: 'not_run',
      notPrivileged: 'not_run',
      sysAdminAbsent: 'not_run',
      hostNetworkAbsent: 'not_run',
      loopbackPortsOnly: 'not_run',
      interfaceCreated: 'passed',
      ipv6Assigned: 'passed',
      cleanupComplete: 'passed',
    },
    errors: [],
  };
}

describe('least-privilege Docker/TUN preflight', () => {
  it('renders the checked repository topology as stable static TunEvidence', async () => {
    const composeSource = await readFile(path.join(root, 'compose.preflight.yml'), 'utf8');
    const dockerfileSource = await readFile(path.join(root, 'docker', 'preflight.Dockerfile'), 'utf8');
    const evidence = checkComposeSource(composeSource, dockerfileSource);

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      source: 'static',
      status: 'passed',
      interfaceName: 'fips-preflight0',
      ipv6Address: 'fd42:6677:6677::1/64',
      authorities: { devices: ['/dev/net/tun'], capabilities: ['NET_ADMIN'], securityOptions: ['no-new-privileges:true'], privileged: false, networkMode: 'none', publishedPorts: [] },
    });
    expect(validateTunEvidence(evidence)).toEqual(evidence);
    expect(JSON.stringify(evidence)).toBe(JSON.stringify(checkComposeSource(composeSource, dockerfileSource)));
  });

  it('rejects missing or broader rendered Compose authority regardless of input order', () => {
    expect(() => validateComposeTopology(renderedCompose())).not.toThrow();
    expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], devices: [] } } })).toThrow('device');
    expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], cap_add: ['NET_ADMIN', 'SYS_ADMIN'] } } })).toThrow('capabilities');
    expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], security_opt: null } } })).toThrow('security options');
    expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], privileged: true } } })).toThrow('privileged');
    expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], network_mode: 'host' } } })).toThrow('host network');
    expect(() => validateComposeTopology({ ...renderedCompose(), services: { 'tun-preflight': { ...renderedCompose().services['tun-preflight'], ports: ['0.0.0.0:8787:8787'] } } })).toThrow('loopback');
  });

  it('rejects inspect authority drift and accepts only the exact inspected set', () => {
    expect(() => validateDockerInspect(inspect())).not.toThrow();
    expect(() => validateDockerInspect({ HostConfig: { ...inspect().HostConfig, CapAdd: ['SYS_ADMIN', 'NET_ADMIN'] } })).toThrow('capabilities');
    expect(() => validateDockerInspect({ HostConfig: { ...inspect().HostConfig, Devices: null } })).toThrow('devices');
    expect(() => validateDockerInspect({ HostConfig: { ...inspect().HostConfig, SecurityOpt: [] } })).toThrow('security options');
    expect(() => validateDockerInspect({ HostConfig: { ...inspect().HostConfig, NetworkMode: 'host' } })).toThrow('host network');
  });

  it('canonicalizes Docker inspect CAP_NET_ADMIN without widening authority', () => {
    const prefixedInspect = {
      HostConfig: {
        ...inspect().HostConfig,
        CapAdd: ['CAP_NET_ADMIN'],
      },
    };

    expect(validateDockerInspect(prefixedInspect).authorities.capabilities).toEqual(['NET_ADMIN']);
    expect(combineExactHostEvidence(prefixedInspect, lifecycle()).authorities.capabilities).toEqual(['NET_ADMIN']);
    expect(() => validateDockerInspect({
      HostConfig: {
        ...inspect().HostConfig,
        CapAdd: ['CAP_NET_ADMIN', 'CAP_SYS_ADMIN'],
      },
    })).toThrow('capabilities');
  });

  it('combines effective authority and owned lifecycle into one exact-host record', () => {
    const combined = combineExactHostEvidence(inspect(), lifecycle());
    expect(validateTunEvidence(combined)).toEqual(combined);
    expect(combined).toMatchObject({
      source: 'exact_host',
      status: 'passed',
      checks: {
        imagePinned: 'passed',
        tunDevice: 'passed',
        netAdmin: 'passed',
        noNewPrivileges: 'passed',
        notPrivileged: 'passed',
        sysAdminAbsent: 'passed',
        hostNetworkAbsent: 'passed',
        loopbackPortsOnly: 'passed',
        interfaceCreated: 'passed',
        ipv6Assigned: 'passed',
        cleanupComplete: 'passed',
      },
    });
    expect(() => combineExactHostEvidence(inspect(), { ...lifecycle(), status: 'failed' })).toThrow('must be passed');
    expect(() => combineExactHostEvidence(inspect(), {
      ...lifecycle(),
      authorities: { ...lifecycle().authorities, capabilities: ['NET_ADMIN', 'SYS_ADMIN'] },
    })).toThrow('capabilities');
  });

  it('writes the runner-ready exact-host record from the documented CLI inputs', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-exact-host-'));
    const inspectPath = path.join(directory, 'inspect.json');
    const lifecyclePath = path.join(directory, 'lifecycle.json');
    await writeFile(inspectPath, JSON.stringify(inspect()), 'utf8');
    await writeFile(lifecyclePath, JSON.stringify(lifecycle()), 'utf8');
    const result = await execFileAsync(process.execPath, [
      'scripts/check-compose.mjs',
      '--exact-host',
      '--inspect-json',
      inspectPath,
      '--lifecycle-json',
      lifecyclePath,
    ], { cwd: root });
    expect(validateTunEvidence(JSON.parse(result.stdout))).toMatchObject({
      source: 'exact_host',
      status: 'passed',
    });
  });
});

async function fakeIpHarness() {
  const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-tun-'));
  const ipPath = path.join(directory, 'ip');
  const logPath = path.join(directory, 'ip.log');
  await writeFile(ipPath, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_IP_LOG"
case "$*" in
  "link show dev fips-preflight0") [ "\${FAKE_COLLISION:-0}" = "1" ] && exit 0; exit 1 ;;
  "tuntap add dev fips-preflight0 mode tun") [ "\${FAKE_FAIL_ADD:-0}" = "1" ] && exit 7; exit 0 ;;
  "-6 addr add fd42:6677:6677::1/64 dev fips-preflight0") [ "\${FAKE_FAIL_ADDR:-0}" = "1" ] && exit 8; exit 0 ;;
  "link set dev fips-preflight0 up") exit 0 ;;
  "-details link show dev fips-preflight0"|"-6 addr show dev fips-preflight0") printf 'fake evidence\\n'; exit 0 ;;
  "link delete dev fips-preflight0") exit 0 ;;
  *) exit 9 ;;
esac
`, 'utf8');
  await chmod(ipPath, 0o755);
  return { directory, ipPath, logPath };
}

async function runLifecycle(environment: Record<string, string>) {
  return execFileAsync('sh', ['scripts/preflight-tun.sh'], {
    cwd: root,
    env: { ...process.env, ...environment },
  });
}

describe('owned fake TUN lifecycle', () => {
  it('creates, configures, captures, and deletes only its newly created interface', async () => {
    const harness = await fakeIpHarness();
    const result = await runLifecycle({ IP_BIN: harness.ipPath, FAKE_IP_LOG: harness.logPath, TUN_DEVICE: '/dev/null' });
    const evidence = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
    expect(validateTunEvidence(evidence)).toMatchObject({ source: 'lifecycle', status: 'passed' });
    expect(await readFile(harness.logPath, 'utf8')).toEqual([
      'link show dev fips-preflight0',
      'tuntap add dev fips-preflight0 mode tun',
      '-6 addr add fd42:6677:6677::1/64 dev fips-preflight0',
      'link set dev fips-preflight0 up',
      '-details link show dev fips-preflight0',
      '-6 addr show dev fips-preflight0',
      'link delete dev fips-preflight0',
      '',
    ].join('\n'));
  });

  it('fails on a collision or unavailable device without reuse or destructive cleanup', async () => {
    const collision = await fakeIpHarness();
    await expect(runLifecycle({ IP_BIN: collision.ipPath, FAKE_IP_LOG: collision.logPath, TUN_DEVICE: '/dev/null', FAKE_COLLISION: '1' })).rejects.toMatchObject({ code: 1 });
    expect(await readFile(collision.logPath, 'utf8')).toBe('link show dev fips-preflight0\n');

    const missing = await fakeIpHarness();
    const missingDevice = path.join(missing.directory, 'not-a-device');
    await writeFile(missingDevice, 'not a character device', 'utf8');
    await expect(runLifecycle({ IP_BIN: missing.ipPath, FAKE_IP_LOG: missing.logPath, TUN_DEVICE: missingDevice })).rejects.toMatchObject({ code: 1 });
    await expect(readFile(missing.logPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans up an owned interface after an address configuration failure', async () => {
    const harness = await fakeIpHarness();
    await expect(runLifecycle({ IP_BIN: harness.ipPath, FAKE_IP_LOG: harness.logPath, TUN_DEVICE: '/dev/null', FAKE_FAIL_ADDR: '1' })).rejects.toMatchObject({ code: 8 });
    expect(await readFile(harness.logPath, 'utf8')).toContain('link delete dev fips-preflight0\n');
  });
});
