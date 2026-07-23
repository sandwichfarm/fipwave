import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridgeServer, LOOPBACK_HOST, type BridgeServer, type BridgeServerOptions, type CodecAsset, type RunnerQualificationConfig } from './server.js';
import { validateTunEvidence } from './report.js';

function findProjectRoot(from: string): string {
  let current = from;
  while (path.dirname(current) !== current) {
    if (existsSync(path.join(current, 'package.json')) && existsSync(path.join(current, 'codec-assets.lock.json'))) return current;
    current = path.dirname(current);
  }
  throw new Error('runner project root could not be located');
}
const PROJECT_ROOT = findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));
export interface ProductionRunnerOptions { machineId: string; role: 'A' | 'B'; port: number; report: string; tunEvidence: string; evidenceMode?: 'Fixture' | 'Loopback'; physicalOpenAir?: boolean; uiDir?: string; codecAssetDir?: string; codecAssets?: readonly CodecAsset[]; }
export interface ProductionRunner extends BridgeServer { config: Readonly<RunnerQualificationConfig>; }
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
  const root = await realpath(directory);
  const names = new Set<string>();
  for (const asset of assets) {
    const checked = assertCodecAsset(asset);
    if (names.has(checked.filename)) fail('codec lock contains duplicate filenames');
    names.add(checked.filename);
    const candidate = path.resolve(root, checked.filename);
    if (!candidate.startsWith(`${root}${path.sep}`)) fail('codec cache path escapes its root');
    const metadata = await lstat(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`codec cache asset is not a regular file: ${checked.filename}`);
    const body = await readFile(candidate);
    if (createHash('sha256').update(body).digest('hex') !== checked.sha256) fail(`codec cache asset hash mismatch: ${checked.filename}`);
  }
  return assets;
}
async function loadCodecAssets(): Promise<readonly CodecAsset[]> {
  const raw = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'codec-assets.lock.json'), 'utf8')) as { schemaVersion?: unknown; assets?: unknown };
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.assets) || raw.assets.length === 0) fail('codec lock is invalid');
  return raw.assets.map(assertCodecAsset);
}

export async function startProductionRunner(options: ProductionRunnerOptions): Promise<ProductionRunner> {
  assertText(options.machineId, 'machine ID'); if (options.role !== 'A' && options.role !== 'B') fail('role must be literal A or B'); assertText(options.report, 'report target');
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) fail('port is invalid');
  let evidenceMode: RunnerQualificationConfig['evidenceMode'] = options.evidenceMode ?? 'Loopback';
  if (options.physicalOpenAir) {
    let raw: unknown; try { raw = JSON.parse(await readFile(options.tunEvidence, 'utf8')); } catch { fail('physical open-air requires a readable exact_host TUN evidence record'); }
    const evidence = validateTunEvidence(raw); if (evidence.source !== 'exact_host' || evidence.status !== 'passed') fail('physical open-air requires passed source: exact_host TUN evidence'); evidenceMode = 'Open air';
  }
  const config = Object.freeze({ machineId: options.machineId, role: options.role, reportTarget: options.report, tunEvidence: options.tunEvidence, evidenceMode, evidenceClass: evidenceMode } satisfies RunnerQualificationConfig);
  const codecAssetDir = options.codecAssetDir ?? path.join(PROJECT_ROOT, '.artifacts', 'codecs');
  const codecAssets = await verifiedCodecAssets(codecAssetDir, options.codecAssets ?? await loadCodecAssets());
  const bridgeOptions = { host: LOOPBACK_HOST, port: options.port, artifactDir: path.join(PROJECT_ROOT, '.artifacts', 'qualification'), uiDir: options.uiDir ?? path.join(PROJECT_ROOT, 'dist', 'modem-ui'), qualificationConfig: config, codecAssetDir, codecAssets } satisfies BridgeServerOptions;
  const bridge = await createBridgeServer(bridgeOptions);
  return { ...bridge, config };
}

function parseCli(argv: string[]): ProductionRunnerOptions {
  const values = new Map<string, string>(); let physicalOpenAir = false;
  for (let index = 0; index < argv.length; index += 1) { const key = argv[index]!; if (key === '--physical-open-air') { physicalOpenAir = true; continue; } const value = argv[index + 1]; if (!['--machine-id', '--role', '--port', '--report', '--tun-evidence', '--evidence-mode'].includes(key) || !value) fail('usage: --machine-id ID --role A|B --port PORT --report PATH --tun-evidence PATH [--evidence-mode Fixture|Loopback] [--physical-open-air]'); values.set(key, value); index += 1; }
  const evidenceMode = values.get('--evidence-mode') as 'Fixture' | 'Loopback' | undefined; if (evidenceMode && evidenceMode !== 'Fixture' && evidenceMode !== 'Loopback') fail('deterministic evidence mode must be Fixture or Loopback');
  const parsed: ProductionRunnerOptions = { machineId: values.get('--machine-id') ?? '', role: values.get('--role') as 'A' | 'B', port: Number(values.get('--port')), report: values.get('--report') ?? '', tunEvidence: values.get('--tun-evidence') ?? '', physicalOpenAir };
  if (evidenceMode !== undefined) parsed.evidenceMode = evidenceMode;
  return parsed;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { void startProductionRunner(parseCli(process.argv.slice(2))).then((runner) => process.stdout.write(`FIPS over Sound runner listening on http://${LOOPBACK_HOST}:${runner.port}\n`)).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }); }
