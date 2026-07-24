import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIPS_IPV6_BY_ROLE = Object.freeze({
  a: 'fd69:e08d:65cc:3a6b:9c2c:2ac4:bd40:5e4b',
  b: 'fd46:f688:3bb:f389:e1df:f3e:3af3:9c30',
});

export function parseFipsComposeSmokeArgs(values) {
  if (values.length === 2 && values[0] === '--role' && (values[1] === 'a' || values[1] === 'b')) return { role: values[1], timeoutMs: 60_000 };
  throw new Error('role must be exactly a or b');
}

function exact(value, expected, name) {
  const actual = [...(value ?? [])].map((entry) => entry === 'CAP_NET_ADMIN' ? 'NET_ADMIN' : entry).sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) throw new Error(`${name} must be exactly ${expected.join(', ')}`);
}

/** Runtime inspect gate for the one owned bridge namespace and its FIPS consumer. */
export function assertFipsRuntimeInspect(inspected) {
  if (!Array.isArray(inspected) || inspected.length !== 2) throw new Error('inspect must contain bridge and fips');
  const bridge = inspected.find((item) => item.Name?.includes('bridge'));
  const fips = inspected.find((item) => item.Name?.includes('fips'));
  if (!bridge || !fips) throw new Error('inspect must name bridge and fips');
  if (fips.State?.Running !== true) throw new Error('fips daemon container must be running');
  const fipsCommand = [fips.Path, ...(Array.isArray(fips.Args) ? fips.Args : [])].filter(Boolean).join(' ');
  if (!fipsCommand.includes('/usr/local/bin/fips --config /runtime/fips.yaml')) throw new Error('fips service must execute the generated FIPS daemon config');
  // Docker Desktop may expose a published port in HostConfig while omitting it
  // from NetworkSettings when another service shares this namespace.
  const bindings = bridge.NetworkSettings?.Ports?.['4310/tcp'] ?? bridge.HostConfig?.PortBindings?.['4310/tcp'];
  if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1') throw new Error('bridge browser publication must bind 127.0.0.1 only');
  if (Object.keys(fips.NetworkSettings?.Ports ?? {}).length !== 0) throw new Error('fips must not publish ports');
  if (!String(fips.HostConfig?.NetworkMode ?? '').startsWith('container:')) throw new Error('fips namespace must target bridge container');
  if (fips.HostConfig?.Privileged !== false || bridge.HostConfig?.Privileged !== false) throw new Error('privileged mode must be false');
  if (fips.Config?.User !== '0:0') throw new Error('fips daemon must run as root for its sole NET_ADMIN capability');
  exact(fips.HostConfig?.CapDrop, ['ALL'], 'fips dropped capabilities');
  exact(fips.HostConfig?.CapAdd, ['NET_ADMIN'], 'fips capabilities');
  const device = fips.HostConfig?.Devices?.map((entry) => `${entry.PathOnHost}:${entry.PathInContainer}`) ?? [];
  exact(device, ['/dev/net/tun:/dev/net/tun'], 'fips device');
  exact(fips.HostConfig?.SecurityOpt, ['no-new-privileges:true'], 'fips security options');
  return { evidenceClass: 'Loopback', physicalQualification: false, browserReady: false, soundWorker: 'starting' };
}

/** Verify the actual daemon namespace rather than trusting requested Compose fields. */
export function assertFipsTunRuntime(output, role) {
  const [uid = '', capEff = '', link = '', address = ''] = String(output).trim().split('\n');
  if (uid !== '0') throw new Error('fips PID 1 must be UID 0');
  if (!/^[0-9a-f]+$/i.test(capEff) || BigInt(`0x${capEff}`) !== 0x1000n) throw new Error('fips PID 1 must have exactly effective NET_ADMIN');
  if (!/\bfips0:.*\bmtu 1280\b/.test(link)) throw new Error('fips0 must exist with MTU 1280');
  const expected = FIPS_IPV6_BY_ROLE[role];
  if (!expected || !new RegExp(`\\b${expected.replaceAll(':', '\\:')}/128\\b`, 'i').test(address)) throw new Error('fips0 must have its role-derived IPv6 address');
  return { interface: 'fips0', mtu: 1280, ipv6Address: expected };
}

/** Phase 2 proves a configured, non-degraded local node; acoustic linkage is later work. */
export function assertFipsDaemonLogs(logs, role) {
  const expectedPeer = role === 'a'
    ? 'npub1f49ke5fkzqev4x7j46uajq92f4zan6kcpty5yvm5c3g6wf2dqanqn7qsy2'
    : 'npub1sjlh2c3x9w7kjsqg2ay080n2lff2uvt325vpan33ke34rn8l5jcqawh57m';
  for (const required of ['Loaded config file', 'TUN device active:', 'Node started:', 'state: running', 'FIPS running', expectedPeer]) {
    if (!String(logs).includes(required)) throw new Error(`first FIPS process is missing runtime evidence: ${required}`);
  }
  if (/\bDEGRADED\b|sound_bridge_connect_failed/.test(String(logs))) throw new Error('first FIPS process must not be degraded or lose its sound bridge on startup');
  return { configuredPeer: expectedPeer, state: 'running' };
}

async function compose(project, args, environment) {
  return execFileAsync('docker', ['compose', '-p', project, '-f', 'compose.fips.yml', ...args], { cwd: root, env: { ...process.env, ...environment }, maxBuffer: 1024 * 1024 });
}

async function main() {
  const { role, timeoutMs } = parseFipsComposeSmokeArgs(process.argv.slice(2));
  const project = `fipwave_smoke_${process.pid}_${Date.now()}`.replaceAll(/[^a-z0-9_]/g, '');
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'fipwave-compose-'));
  const environment = { ROLE: role.toUpperCase(), MACHINE_ID: `fipwave-${role}`, BROWSER_PORT: role === 'a' ? '4310' : '4312' };
  let cleanupError;
  try {
    await compose(project, ['build'], environment);
    await compose(project, ['up', '--detach'], environment);
    const ids = (await compose(project, ['ps', '--quiet'], environment)).stdout.trim().split(/\s+/).filter(Boolean);
    if (ids.length !== 2) throw new Error(`expected two owned Compose containers, found ${ids.length}`);
    const inspected = JSON.parse((await execFileAsync('docker', ['inspect', ...ids], { maxBuffer: 1024 * 1024 })).stdout);
    const evidence = assertFipsRuntimeInspect(inspected);
    const fips = inspected.find((item) => item.Name?.includes('fips'));
    if (!fips?.Id) throw new Error('fips inspect identity is missing');
    const firstPid = fips.State?.Pid;
    if (!Number.isInteger(firstPid) || firstPid <= 0) throw new Error('first FIPS process PID is invalid');
    const deadline = Date.now() + timeoutMs;
    let bridgeReady = false;
    let soundWorker = false;
    let tun;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${environment.BROWSER_PORT}/`);
        if (response.ok) {
          bridgeReady = true;
          const status = await fetch(`http://127.0.0.1:${environment.BROWSER_PORT}/bridge-status`).then((value) => value.json());
          soundWorker = status?.soundTransport === 'started';
          if (soundWorker) {
            const tunOutput = await execFileAsync('docker', ['exec', fips.Id, 'sh', '-ec', 'id -u; sed -n "s/^CapEff:[[:space:]]*//p" /proc/1/status; ip -o link show dev fips0; ip -6 -o addr show dev fips0 scope global'], { maxBuffer: 1024 * 1024 });
            tun = assertFipsTunRuntime(tunOutput.stdout, role);
            break;
          }
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!bridgeReady) throw new Error(`bridge did not become ready on loopback port ${environment.BROWSER_PORT}`);
    if (!soundWorker) throw new Error('FIPS sound worker did not connect to the bridge');
    if (!tun) throw new Error('fips0 did not become ready before the smoke deadline');
    const current = JSON.parse((await execFileAsync('docker', ['inspect', fips.Id], { maxBuffer: 1024 * 1024 })).stdout)[0];
    if (current?.State?.Pid !== firstPid) throw new Error('FIPS must connect on its first process without a manual restart');
    const logs = (await execFileAsync('docker', ['logs', fips.Id], { maxBuffer: 1024 * 1024 })).stdout;
    const daemon = assertFipsDaemonLogs(logs, role);
    console.log(JSON.stringify({ schemaVersion: 1, project, role, ...evidence, tun, daemon, firstFipsPid: firstPid, soundWorker: 'connected', note: 'Local container topology proves configured peer, first-process Sound bridge, and usable TUN; it does not claim open-air acoustic delivery or ICMPv6 ping.' }));
  } finally {
    try { await compose(project, ['down', '--volumes', '--remove-orphans'], environment); } catch (error) { cleanupError = error; }
    await rm(tempDirectory, { recursive: true, force: true });
    if (cleanupError) throw cleanupError;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
