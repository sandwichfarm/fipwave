import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  const bindings = bridge.NetworkSettings?.Ports?.['4310/tcp'];
  if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1') throw new Error('bridge browser publication must bind 127.0.0.1 only');
  if (Object.keys(fips.NetworkSettings?.Ports ?? {}).length !== 0) throw new Error('fips must not publish ports');
  if (!String(fips.HostConfig?.NetworkMode ?? '').startsWith('container:')) throw new Error('fips namespace must target bridge container');
  if (fips.HostConfig?.Privileged !== false || bridge.HostConfig?.Privileged !== false) throw new Error('privileged mode must be false');
  exact(fips.HostConfig?.CapAdd, ['NET_ADMIN'], 'fips capabilities');
  const device = fips.HostConfig?.Devices?.map((entry) => `${entry.PathOnHost}:${entry.PathInContainer}`) ?? [];
  exact(device, ['/dev/net/tun:/dev/net/tun'], 'fips device');
  exact(fips.HostConfig?.SecurityOpt, ['no-new-privileges:true'], 'fips security options');
  return { evidenceClass: 'Loopback', physicalQualification: false, browserReady: false, soundWorker: 'not-started' };
}

async function compose(project, args, environment) {
  return execFileAsync('docker', ['compose', '-p', project, '-f', 'compose.fips.yml', ...args], { cwd: root, env: { ...process.env, ...environment }, maxBuffer: 1024 * 1024 });
}

async function main() {
  const { role, timeoutMs } = parseFipsComposeSmokeArgs(process.argv.slice(2));
  const project = `fipwave_smoke_${process.pid}_${Date.now()}`.replaceAll(/[^a-z0-9_]/g, '');
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'fipwave-compose-'));
  const environment = { ROLE: role, MACHINE_ID: `fipwave-${role}`, BROWSER_PORT: role === 'a' ? '4310' : '4312' };
  let cleanupError;
  try {
    await compose(project, ['build'], environment);
    await compose(project, ['up', '--detach'], environment);
    const ids = (await compose(project, ['ps', '--quiet'], environment)).stdout.trim().split(/\s+/).filter(Boolean);
    if (ids.length !== 2) throw new Error(`expected two owned Compose containers, found ${ids.length}`);
    const inspected = JSON.parse((await execFileAsync('docker', ['inspect', ...ids], { maxBuffer: 1024 * 1024 })).stdout);
    const evidence = assertFipsRuntimeInspect(inspected);
    const deadline = Date.now() + timeoutMs;
    let bridgeReady = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${environment.BROWSER_PORT}/`);
        if (response.ok) {
          bridgeReady = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!bridgeReady) throw new Error(`bridge did not become ready on loopback port ${environment.BROWSER_PORT}`);
    console.log(JSON.stringify({ schemaVersion: 1, project, role, ...evidence, note: 'Local container topology only; no Open air, acoustic peer, or ping claim.' }));
  } finally {
    try { await compose(project, ['down', '--volumes', '--remove-orphans'], environment); } catch (error) { cleanupError = error; }
    await rm(tempDirectory, { recursive: true, force: true });
    if (cleanupError) throw cleanupError;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
