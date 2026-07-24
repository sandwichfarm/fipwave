import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createBridgeServer, LOOPBACK_HOST, type BridgeServer, type BridgeServerOptions, type CodecAsset, type RunnerQualificationConfig } from './server.js';
import { resolveDemoConfig, toPublicDemoConfig, type DemoConfig, type PublicDemoConfig } from './demo-config.js';
import { ResourceOwner } from './resource-owner.js';
import { NativeCommandCodecAdapter } from './codecs/command.js';
import { CyrinxBatchWorker } from './cyrinx-worker.js';
import { cyrinxDigitalCases } from './qualification-session.js';
import { CYRINX_DEADLINE_MS, QUIET_CODEC, TUN_EVIDENCE_CHECKS, validateTunEvidence, type MachineReport, type TunEvidence } from './report.js';

const execFileAsync = promisify(execFile);
function findProjectRoot(from: string): string {
  let current = from;
  while (path.dirname(current) !== current) {
    if (existsSync(path.join(current, 'package.json')) && existsSync(path.join(current, 'codec-assets.lock.json'))) return current;
    current = path.dirname(current);
  }
  throw new Error('runner project root could not be located');
}
const PROJECT_ROOT = findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));
interface BuildIdentity { commit: string; os: string; architecture: string; dirty: boolean; }
export interface ProductionRunnerOptions {
  machineId: string; role?: 'A' | 'B'; port?: number; report: string; tunEvidence: string;
  demoConfig?: DemoConfig;
  evidenceMode?: 'Fixture' | 'Loopback'; physicalOpenAir?: boolean; uiDir?: string; codecAssetDir?: string; codecAssets?: readonly CodecAsset[];
  buildIdentityForTests?: BuildIdentity;
  qualificationTrace?: Pick<NonNullable<MachineReport['qualification']>, 'deadline' | 'fallback'>;
  reportWriterForTests?: BridgeServerOptions['reportWriter'];
  nowForTests?: () => number;
  cyrinxBuildForTests?: BridgeServerOptions['cyrinxBuild'];
  cyrinxDigitalForTests?: BridgeServerOptions['cyrinxDigital'];
  cyrinxWorkerForTests?: BridgeServerOptions['cyrinxWorker'];
  cyrinxTimerForTests?: BridgeServerOptions['cyrinxTimer'];
  cyrinxSettleForTests?: BridgeServerOptions['cyrinxSettle'];
  fipsConfigOutput?: string;
  createBridgeServerForTests?: typeof createBridgeServer;
  afterBridgeStartedForTests?: () => Promise<void>;
}
export interface PublicRunnerConfig extends PublicDemoConfig { readonly reportTarget: string; }
export interface ProductionRunner extends BridgeServer { config: Readonly<PublicRunnerConfig>; }
function fail(message: string): never { throw new Error(`runner ${message}`); }
function assertText(value: string, label: string): void { if (!/^[A-Za-z0-9._/-]+$/.test(value) || value.includes('..')) fail(`${label} is invalid`); }
function assertCodecAsset(value: unknown): CodecAsset {
  if (!value || typeof value !== 'object') fail('codec lock contains an invalid asset');
  const asset = value as Partial<CodecAsset>;
  if (typeof asset.filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.filename) || typeof asset.mimeType !== 'string' || typeof asset.browserServing !== 'boolean' || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) fail('codec lock contains an invalid asset');
  return { filename: asset.filename, mimeType: asset.mimeType, browserServing: asset.browserServing, sha256: asset.sha256 };
}
async function verifiedCodecAssets(directory: string, supplied?: readonly CodecAsset[]): Promise<readonly CodecAsset[]> {
  const assets = supplied ?? (() => { fail('codec lock must be loaded before cache verification'); })();
  const root = await realpath(directory); const names = new Set<string>();
  for (const asset of assets) {
    const checked = assertCodecAsset(asset); if (names.has(checked.filename)) fail('codec lock contains duplicate filenames'); names.add(checked.filename);
    const candidate = path.resolve(root, checked.filename); if (!candidate.startsWith(`${root}${path.sep}`)) fail('codec cache path escapes its root');
    const metadata = await lstat(candidate); if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`codec cache asset is not a regular file: ${checked.filename}`);
    const body = await readFile(candidate); if (createHash('sha256').update(body).digest('hex') !== checked.sha256) fail(`codec cache asset hash mismatch: ${checked.filename}`);
  }
  return assets;
}
async function loadCodecAssets(): Promise<readonly CodecAsset[]> {
  const raw = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'codec-assets.lock.json'), 'utf8')) as { schemaVersion?: unknown; assets?: unknown };
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.assets) || raw.assets.length === 0) fail('codec lock is invalid');
  return raw.assets.map(assertCodecAsset);
}
function unavailableTunEvidence(): TunEvidence {
  return { schemaVersion: 1, source: 'static', status: 'failed', image: 'alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c', interfaceName: 'fips-preflight0', ipv6Address: 'fd42:6677:6677::1/64', authorities: { devices: ['/dev/net/tun'], capabilities: ['NET_ADMIN'], securityOptions: ['no-new-privileges:true'], privileged: false, networkMode: 'none', publishedPorts: [] }, checks: Object.fromEntries(TUN_EVIDENCE_CHECKS.map((check) => [check, 'not_run'])) as TunEvidence['checks'], errors: ['exact-host TUN evidence was not supplied for deterministic runner mode'] };
}
async function resolveBuildIdentity(injected?: BuildIdentity): Promise<BuildIdentity> {
  if (injected) return { ...injected };
  try {
    const [{ stdout: commit }, { stdout: status }] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: PROJECT_ROOT }),
      execFileAsync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: PROJECT_ROOT }),
    ]);
    return { commit: commit.trim(), os: process.platform, architecture: process.arch, dirty: status.trim().length > 0 };
  } catch {
    return { commit: 'unresolved', os: process.platform, architecture: process.arch, dirty: true };
  }
}

/** Render the role-owned FIPS configuration used only inside the shared Compose namespace. */
export function renderFipsConfig(config: DemoConfig): string {
  return [
    'node:',
    '  identity:',
    `    nsec: "${config.identity.nsec}"`,
    '  log_level: info',
    'tun:',
    '  enabled: true',
    '  name: fips0',
    '  mtu: 1280',
    'dns:',
    '  enabled: false',
    'transports:',
    '  sound:',
    `    bridge_url: "${config.bridge.fipsUrl}"`,
    `    peer_addr: "sound-${config.inputRole === 'a' ? 'b' : 'a'}"`,
    `    mtu: ${config.fips.linkMtu}`,
    '    queue_items: 32',
    `    queue_bytes: ${config.fips.linkMtu * 32}`,
    'peers: []',
    '',
  ].join('\n');
}

export async function startProductionRunner(options: ProductionRunnerOptions): Promise<ProductionRunner> {
  assertText(options.machineId, 'machine ID'); assertText(options.report, 'report target');
  const demoConfig = options.demoConfig ?? (options.role === 'A' ? resolveDemoConfig('a') : options.role === 'B' ? resolveDemoConfig('b') : fail('role must be literal A or B'));
  if (options.role && options.role !== demoConfig.role) fail('role does not match resolved config');
  if (options.fipsConfigOutput) await writeFile(options.fipsConfigOutput, renderFipsConfig(demoConfig), { encoding: 'utf8', mode: 0o644 });
  const runtimePort = options.demoConfig ? demoConfig.bridge.browserPort : options.port;
  if (typeof runtimePort !== 'number' || !Number.isInteger(runtimePort) || runtimePort < 0 || runtimePort > 65_535) fail('port is invalid');
  let evidenceMode: RunnerQualificationConfig['evidenceMode'] = options.evidenceMode ?? 'Loopback'; let tunEvidence = unavailableTunEvidence();
  if (options.physicalOpenAir) {
    let raw: unknown; try { raw = JSON.parse(await readFile(options.tunEvidence, 'utf8')); } catch { fail('physical open-air requires a readable exact_host TUN evidence record'); }
    const evidence = validateTunEvidence(raw);
    if (evidence.source !== 'exact_host' || evidence.status !== 'passed' || TUN_EVIDENCE_CHECKS.some((check) => evidence.checks[check] !== 'passed')) fail('physical open-air requires every passed source: exact_host TUN evidence field');
    tunEvidence = evidence; evidenceMode = 'Open air';
  }
  const build = await resolveBuildIdentity(options.buildIdentityForTests);
  if (options.physicalOpenAir && (build.dirty || !/^[a-f0-9]{40}$/.test(build.commit))) fail('physical open-air requires a clean resolved git HEAD build identity');
  const qualification: NonNullable<MachineReport['qualification']> = {
    deadLinkTimeoutMs: demoConfig.heartbeat.deadLinkTimeoutMs,
    cyrinxDeadlineMs: CYRINX_DEADLINE_MS,
    deadline: options.qualificationTrace?.deadline ?? { startedAtMs: null, deadlineAtMs: null, elapsedMs: null },
    physicalGate: evidenceMode === 'Open air' ? 'pending' : 'not_physical',
    fallback: options.qualificationTrace?.fallback ?? { codecId: 'quiet', state: 'available', reasonCode: null },
    cyrinx: { stage: 'idle', coldReceivePassed: false },
  };
  const config = Object.freeze({ machineId: options.machineId, role: demoConfig.role, reportTarget: options.report, tunEvidence: options.tunEvidence, tunEvidenceSource: tunEvidence.source, evidenceMode, evidenceClass: evidenceMode, buildCommit: build.commit, codec: { ...QUIET_CODEC }, qualification } satisfies RunnerQualificationConfig);
  const codecAssetDir = options.codecAssetDir ?? path.join(PROJECT_ROOT, '.artifacts', 'codecs');
  const codecAssets = await verifiedCodecAssets(codecAssetDir, options.codecAssets ?? await loadCodecAssets());
  const cyrinxExecutable = path.join(PROJECT_ROOT, '.artifacts', 'build', 'cyrinx', 'cyrinx_batch');
  const cyrinxWorker = options.cyrinxWorkerForTests ?? new CyrinxBatchWorker({
    executable: cyrinxExecutable,
    ...(options.nowForTests ? { now: options.nowForTests } : {}),
  });
  const cyrinxDigital: NonNullable<BridgeServerOptions['cyrinxDigital']> = options.cyrinxDigitalForTests ?? (async (context): Promise<void> => {
    const adapter = new NativeCommandCodecAdapter({ executable: cyrinxExecutable });
    for (const value of cyrinxDigitalCases()) {
      const result = await adapter.qualify(value, context);
      if (
        result.adapter !== 'cyrinx'
        || result.profile.name !== 'bulk-qpsk-r1-2-48k-v1'
        || result.profile.advertisedMtu !== 1536
        || result.caseId !== value.id
        || result.direction !== value.direction
        || result.digest !== value.digest
        || !result.complete
        || !result.bytePerfect
        || result.deliveryCount !== 1
      ) fail('Cyrinx digital encode/decode gate failed');
    }
  });
  const bridgeOptions = {
    host: LOOPBACK_HOST, port: runtimePort, artifactDir: path.join(PROJECT_ROOT, '.artifacts', 'qualification'),
    uiDir: options.uiDir ?? path.join(PROJECT_ROOT, 'dist', 'modem-ui'), qualificationConfig: config,
    reportAuthority: { tunEvidence, build: { commit: build.commit, os: build.os, architecture: build.architecture } },
    codecAssetDir, codecAssets,
    ...(options.reportWriterForTests ? { reportWriter: options.reportWriterForTests } : {}),
    ...(options.nowForTests ? { now: options.nowForTests } : {}),
    cyrinxBuild: options.cyrinxBuildForTests ?? (async ({ signal }) => { await execFileAsync(process.execPath, [path.join(PROJECT_ROOT, 'scripts', 'build-cyrinx.mjs')], { cwd: PROJECT_ROOT, timeout: 60_000, killSignal: 'SIGKILL', signal }); }),
    cyrinxDigital,
    cyrinxWorker,
    ...(options.cyrinxTimerForTests ? { cyrinxTimer: options.cyrinxTimerForTests } : {}),
    ...(options.cyrinxSettleForTests ? { cyrinxSettle: options.cyrinxSettleForTests } : {}),
  } satisfies BridgeServerOptions;
  const owner = new ResourceOwner();
  try {
    const bridge = await (options.createBridgeServerForTests ?? createBridgeServer)(bridgeOptions);
    owner.register('bridge', bridge.close);
    await options.afterBridgeStartedForTests?.();
    const publicConfig = Object.freeze({ ...toPublicDemoConfig(demoConfig), reportTarget: config.reportTarget });
    return { ...bridge, close: () => owner.close(), config: publicConfig };
  } catch {
    await owner.close().catch(() => undefined);
    fail('startup failed');
  }
}

function parseCli(argv: string[]): ProductionRunnerOptions {
  const values = new Map<string, string>(); let physicalOpenAir = false;
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]!; if (key === '--physical-open-air') { physicalOpenAir = true; continue; }
    const value = argv[index + 1]; if (!['--machine-id', '--role', '--port', '--report', '--tun-evidence', '--evidence-mode', '--fips-config'].includes(key) || !value) fail('usage: --machine-id ID --role A|B --port PORT --report PATH --tun-evidence PATH [--evidence-mode Fixture|Loopback] [--fips-config PATH] [--physical-open-air]');
    values.set(key, value); index += 1;
  }
  const evidenceMode = values.get('--evidence-mode') as 'Fixture' | 'Loopback' | undefined; if (evidenceMode && evidenceMode !== 'Fixture' && evidenceMode !== 'Loopback') fail('deterministic evidence mode must be Fixture or Loopback');
  const parsed: ProductionRunnerOptions = { machineId: values.get('--machine-id') ?? '', role: values.get('--role') as 'A' | 'B', port: Number(values.get('--port')), report: values.get('--report') ?? '', tunEvidence: values.get('--tun-evidence') ?? '', physicalOpenAir };
  if (evidenceMode !== undefined) parsed.evidenceMode = evidenceMode;
  const fipsConfigOutput = values.get('--fips-config');
  if (fipsConfigOutput !== undefined) parsed.fipsConfigOutput = fipsConfigOutput;
  return parsed;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void startProductionRunner(parseCli(process.argv.slice(2))).then((runner) => process.stdout.write(`FIPS over Sound runner listening on http://${LOOPBACK_HOST}:${runner.port}\n`)).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
