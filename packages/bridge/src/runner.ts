import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
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
import { createFipsControlClient } from './fips-control-client.js';
import { createFipsPeerReconciler } from './fips-peer-reconciler.js';
import { createProofController, projectPublicPeerExecution, projectPublicProofExecution } from './proof-controller.js';
import { createIsolationResponder, requestIsolationAttestation } from './isolation-attestation.js';
import { createImageTransfer, startAuthenticatedImageSender } from './image-transfer.js';
import { FIXED_DEMO_IMAGE_HEIGHT, FIXED_DEMO_IMAGE_WIDTH, fixedDemoImageRaster } from './demo-image-raster.js';

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
  machineId: string; role?: 'A' | 'B'; port?: number; host?: typeof LOOPBACK_HOST | '0.0.0.0'; report: string; tunEvidence: string;
  fastGuardMs?: number;
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
  createImageTransferForTests?: typeof createImageTransfer;
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
  const runtimeCommit = process.env.BUILD_COMMIT;
  if (runtimeCommit && /^[a-f0-9]{40}$/i.test(runtimeCommit)) return { commit: runtimeCommit.toLowerCase(), os: process.platform, architecture: process.arch, dirty: false };
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
    // FIPS defaults target ordinary network links (10 s heartbeat, 30 s dead
    // timeout, 1 s handshake resend). A complete packet can legitimately take
    // longer than that over the audible stop-and-wait transport, so those
    // defaults otherwise remove a correctly authenticated peer mid-demo.
    '  heartbeat_interval_secs: 60',
    '  link_dead_timeout_secs: 600',
    // The default 120-second rekey begins while the first slow acoustic data
    // packet is still crossing the room. Keep rekey enabled, but move its
    // timer outside the rehearsed demo window so it cannot starve user data.
    '  rekey:',
    '    enabled: true',
    '    after_secs: 3600',
    '    after_messages: 65536',
    '  rate_limit:',
    '    handshake_timeout_secs: 300',
    '    handshake_resend_interval_ms: 15000',
    '    handshake_resend_backoff: 2.0',
    '    handshake_max_resends: 8',
    '  mmp:',
    '    mode: minimal',
    '  session_mmp:',
    '    mode: minimal',
    '  control:',
    '    enabled: true',
    `    socket_path: "${config.fips.controlSocketPath}"`,
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
    ...(config.fips.transports.some((transport) => transport.kind === 'udp') ? [
      '  udp:',
      '    outbound_only: true',
      '    accept_connections: false',
      '    advertise_on_nostr: false',
    ] : []),
    'peers:',
    `  - npub: "${config.peer.publicKey}"`,
    `    alias: "sound-${config.inputRole === 'a' ? 'b' : 'a'}"`,
    '    addresses:',
    '      - transport: sound',
    `        addr: "sound-${config.inputRole === 'a' ? 'b' : 'a'}"`,
    `    connect_policy: ${config.role === 'A' ? 'auto_connect' : 'manual'}`,
    `    auto_reconnect: ${config.role === 'A' ? 'true' : 'false'}`,
    '    via_nostr: false',
    '',
  ].join('\n');
}

/** Publish the secret-bearing config only after the bridge is accepting FIPS connections. */
export async function publishFipsConfig(output: string, content: string): Promise<void> {
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, output);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function startProductionRunner(options: ProductionRunnerOptions): Promise<ProductionRunner> {
  assertText(options.machineId, 'machine ID'); assertText(options.report, 'report target');
  const roleInput = options.role === 'A' ? 'a' : options.role === 'B' ? 'b' : undefined;
  if (options.fastGuardMs !== undefined && (!Number.isSafeInteger(options.fastGuardMs) || options.fastGuardMs < 50 || options.fastGuardMs > 1_500)) fail('fast guard must be an integer from 50 through 1500 milliseconds');
  const demoOverride = {
    ...(options.fipsConfigOutput && options.port ? { bridge: { browserPort: options.port, fipsPort: options.port, fipsUrl: `ws://${LOOPBACK_HOST}:${options.port}/bridge/fips` } } : {}),
    ...(options.fastGuardMs !== undefined ? { acoustic: { fastGuardMs: options.fastGuardMs } } : {}),
  };
  const demoConfig = options.demoConfig ?? (roleInput ? resolveDemoConfig(roleInput, Object.keys(demoOverride).length ? demoOverride : undefined) : fail('role must be literal A or B'));
  if (options.role && options.role !== demoConfig.role) fail('role does not match resolved config');
  const fipsConfig = options.fipsConfigOutput ? renderFipsConfig(demoConfig) : undefined;
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
  const calibrationCandidates = demoConfig.calibrationCandidates.map((candidate) => ({ id: candidate.id, profileId: candidate.profileId, payloadBytes: candidate.payloadBytes, repetition: candidate.repetition, guardMs: candidate.guardMs, playbackGain: candidate.playbackGain, ackTimeoutMs: candidate.ackTimeoutMs }));
  const peerIpv6 = resolveDemoConfig(demoConfig.role === 'A' ? 'b' : 'a').fips.ipv6Address;
  const config = Object.freeze({
    machineId: options.machineId, role: demoConfig.role, reportTarget: options.report, tunEvidence: options.tunEvidence, tunEvidenceSource: tunEvidence.source, evidenceMode, evidenceClass: evidenceMode, buildCommit: build.commit, codec: { ...QUIET_CODEC }, qualification,
    fipsNetwork: { localPublicKey: demoConfig.identity.publicKey, peerPublicKey: demoConfig.peer.publicKey, localIpv6: demoConfig.fips.ipv6Address, peerIpv6 },
    // The browser receives this exact public projection of demo-config.  It
    // cannot invent, reorder, or truncate acoustic candidates at runtime.
    acoustic: {
      profiles: ['quiet-audible-7k-v1'] as ['quiet-audible-7k-v1'],
      ranges: { minPayloadBytes: Math.min(...calibrationCandidates.map((candidate) => candidate.payloadBytes)), maxPayloadBytes: Math.max(...calibrationCandidates.map((candidate) => candidate.payloadBytes)) },
      candidates: calibrationCandidates,
      calibration: { ...demoConfig.acoustic.calibration },
    },
  } satisfies RunnerQualificationConfig);
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
  const bridgeOptions: BridgeServerOptions = {
    host: options.host ?? LOOPBACK_HOST, port: runtimePort, artifactDir: path.join(PROJECT_ROOT, '.artifacts', 'qualification'),
    uiDir: options.uiDir ?? path.join(PROJECT_ROOT, 'dist', 'modem-ui'), qualificationConfig: config,
    // FIPS can enqueue a short burst while acoustic delivery is intentionally
    // slow. Keep admitted packets current for the server's maximum bounded
    // interval instead of applying the generic 5-second media-queue age.
    // A proof response plus six image bands can arrive as a short FIPS burst
    // while the browser drains one deliberately slow acoustic packet at a
    // time. Bound by bytes and age, but do not disconnect the FIPS endpoint
    // merely because more than 32 small packets are awaiting sound playback.
    packetQueueLimits: { maxItems: 256, maxBytes: 256 * 1024, maxAgeMs: 600_000 },
    reportAuthority: { tunEvidence, build: { commit: build.commit, os: build.os, architecture: build.architecture } },
    codecAssetDir, codecAssets,
    ...(options.reportWriterForTests ? { reportWriter: options.reportWriterForTests } : {}),
    ...(options.nowForTests ? { now: options.nowForTests } : {}),
    cyrinxBuild: options.cyrinxBuildForTests ?? (async ({ signal }) => { await execFileAsync(process.execPath, [path.join(PROJECT_ROOT, 'scripts', 'build-cyrinx.mjs')], { cwd: PROJECT_ROOT, timeout: 60_000, killSignal: 'SIGKILL', signal }); }),
    cyrinxDigital,
    cyrinxWorker,
    ...(options.cyrinxTimerForTests ? { cyrinxTimer: options.cyrinxTimerForTests } : {}),
    ...(options.cyrinxSettleForTests ? { cyrinxSettle: options.cyrinxSettleForTests } : {}),
  };
  const owner = new ResourceOwner();
  try {
    const control = createFipsControlClient({ socketPath: demoConfig.fips.controlSocketPath });
    owner.register('fips-control', control.close);
    const imageTransfer = (options.createImageTransferForTests ?? createImageTransfer)({
      role: demoConfig.role,
      localIpv6: demoConfig.fips.ipv6Address,
      peerIpv6,
    });
    owner.register('image-transfer', imageTransfer.close);
    let bridge: Awaited<ReturnType<typeof createBridgeServer>> | undefined;
    const settingsId = demoConfig.calibrationCandidates[0]?.profileId;
    if (!settingsId) fail('startup failed');
    let cachedIsolation: { readonly epoch: number; readonly observedAtMs: number } | undefined;
    const proof = createProofController({
      config: demoConfig, targetIpv6: demoConfig.fips.targetIpv6, control,
      // The bridge's browser-facing state is deliberately not enough to infer
      // peer truth. Until the runner receives the current acoustic projection,
      // this fails closed and routes refreshes to a bounded blocked state.
      acousticStatus: () => {
        const state = bridge?.state();
        return { epoch: state?.epoch ?? 0, ready: state?.acousticReady ?? false, observedAtMs: Date.now() };
      },
      isolation: async () => {
        const now = Date.now(); const state = bridge?.state();
        if (!state?.acousticReady) { cachedIsolation = undefined; return { accepted: false, epoch: state?.epoch ?? 0, observedAtMs: now, targetIpv6: demoConfig.fips.targetIpv6 }; }
        if (cachedIsolation && cachedIsolation.epoch === state.epoch && now - cachedIsolation.observedAtMs < 10_000) return { accepted: true, epoch: state.epoch, observedAtMs: cachedIsolation.observedAtMs, targetIpv6: demoConfig.fips.targetIpv6 };
        try {
          const attestation = await requestIsolationAttestation({ now: () => Date.now(), sourceHost: demoConfig.fips.ipv6Address, targetHost: demoConfig.fips.targetIpv6, port: demoConfig.proof.port, expectedPeerPublicKey: demoConfig.identity.publicKey, expectedTargetIpv6: demoConfig.fips.targetIpv6, expectedBuild: build.commit, expectedEpoch: state.epoch, expectedSettingsId: settingsId, timeoutMs: demoConfig.proof.timeoutMs, maxAttempts: demoConfig.proof.maxAttempts });
          cachedIsolation = { epoch: state.epoch, observedAtMs: attestation.observedAtMs };
          return { accepted: true, epoch: state.epoch, observedAtMs: attestation.observedAtMs, targetIpv6: demoConfig.fips.targetIpv6 };
        } catch { cachedIsolation = undefined; return { accepted: false, epoch: state.epoch, observedAtMs: now, targetIpv6: demoConfig.fips.targetIpv6 }; }
      },
      now: () => Date.now(),
      execFile: async (file, args, commandOptions) => {
        try { const result = await execFileAsync(file, [...args], { timeout: commandOptions.timeout, maxBuffer: commandOptions.maxBuffer, windowsHide: commandOptions.windowsHide }); return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }; }
        catch (error) { const failed = error as { code?: unknown; stdout?: unknown; stderr?: unknown }; return { exitCode: typeof failed.code === 'number' ? failed.code : 2, stdout: typeof failed.stdout === 'string' ? failed.stdout : '', stderr: typeof failed.stderr === 'string' ? failed.stderr : '' }; }
      },
    });
    bridgeOptions.proofController = {
      role: demoConfig.role,
      peerStatus: async () => projectPublicPeerExecution(await proof.peerStatus()),
      status: async () => projectPublicProofExecution(await proof.status()),
      ping: async () => projectPublicProofExecution(await proof.ping()),
    };
    bridgeOptions.imageTransfer = imageTransfer;
    bridge = await (options.createBridgeServerForTests ?? createBridgeServer)(bridgeOptions);
    owner.register('bridge', bridge.close);
    // Role A owns the initial acoustic transmit turn. Keep it as the one
    // reconnect initiator, while Role B's daemon is configured manual/passive.
    // A second initiator can promote crossed Noise handshakes whose keys do
    // not match even though both peer tables independently say connected.
    if (demoConfig.role === 'A') {
      const peerReconciler = createFipsPeerReconciler({
        control,
        peer: {
          npub: demoConfig.fips.expectedPeerPublicKey,
          address: 'sound-b',
          transport: 'sound',
        },
        acousticReady: () => bridge?.state().acousticReady ?? false,
      });
      owner.register('fips-peer-reconciler', peerReconciler.close);
    }
    if (options.fipsConfigOutput && fipsConfig) await publishFipsConfig(options.fipsConfigOutput, fipsConfig);
    if (demoConfig.role === 'A') {
      const imageSender = startAuthenticatedImageSender({
        // A connected row for the expected npub is the authenticated FIPS
        // peer link. End-to-end sessions are send-path state, so the fixed
        // image must be allowed to create that session.
        peerReady: async () => (await proof.peerStatus()).peerReady,
        send: async () => {
          await imageTransfer.send(FIXED_DEMO_IMAGE_WIDTH, FIXED_DEMO_IMAGE_HEIGHT, fixedDemoImageRaster());
        },
      });
      owner.register('authenticated-image-sender', async () => imageSender.close());
    }
    if (demoConfig.role === 'B') {
      const responder = createIsolationResponder({
        now: () => Date.now(), host: demoConfig.fips.ipv6Address, port: demoConfig.proof.port,
        snapshot: async () => {
          const state = bridge?.state();
          if (!state?.acousticReady) throw new Error('snapshot_invalid');
          const [peerData, linkData, transportData] = await Promise.all([control.query('peers'), control.query('links'), control.query('transports')]);
          const peers = (peerData as { peers: readonly { npub: string; connectivity: string; link_id: number; transport_type: string }[] }).peers;
          const links = (linkData as { links: readonly { link_id: number; transport_id: number; state: string }[] }).links;
          const transports = (transportData as { transports: readonly { transport_id: number; type: string; state: string; stats: Readonly<Record<string, unknown>> }[] }).transports;
          const peer = peers.find((item) => item.npub === demoConfig.fips.expectedPeerPublicKey && item.connectivity === 'connected' && item.transport_type === 'sound');
          const link = peer && links.find((item) => item.link_id === peer.link_id && item.state === 'connected');
          const transport = link && transports.find((item) => item.transport_id === link.transport_id && item.type === 'sound' && item.state === 'up');
          if (!peer || !link || !transport || transport.stats.worker_up !== true || transport.stats.acoustic_ready !== true || transport.stats.epoch !== state.epoch) throw new Error('snapshot_invalid');
          return { expectedPeerPublicKey: demoConfig.fips.expectedPeerPublicKey, targetIpv6: demoConfig.fips.ipv6Address, build: build.commit, epoch: state.epoch, settingsId, observedAtMs: Date.now(), transport: { transportId: transport.transport_id, type: 'sound' as const, state: 'active' as const, workerUp: true as const, acousticReady: true as const }, link: { linkId: link.link_id, peerPublicKey: peer.npub } };
        },
      });
      let stopped = false; let retry: ReturnType<typeof setTimeout> | undefined;
      const bind = (): void => { void responder.listen().catch(() => { if (!stopped) retry = setTimeout(bind, 250); }); };
      bind();
      owner.register('isolation-responder', async () => { stopped = true; if (retry) clearTimeout(retry); await responder.close(); });
    }
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
    const value = argv[index + 1]; if (!['--machine-id', '--role', '--port', '--report', '--tun-evidence', '--evidence-mode', '--fips-config', '--bind-host', '--fast-guard-ms'].includes(key) || !value) fail('usage: --machine-id ID --role A|B --port PORT --report PATH --tun-evidence PATH [--evidence-mode Fixture|Loopback] [--fips-config PATH] [--bind-host 127.0.0.1|0.0.0.0] [--fast-guard-ms 50..1500] [--physical-open-air]');
    values.set(key, value); index += 1;
  }
  const evidenceMode = values.get('--evidence-mode') as 'Fixture' | 'Loopback' | undefined; if (evidenceMode && evidenceMode !== 'Fixture' && evidenceMode !== 'Loopback') fail('deterministic evidence mode must be Fixture or Loopback');
  const host = values.get('--bind-host');
  if (host !== undefined && host !== LOOPBACK_HOST && host !== '0.0.0.0') fail('bind host is invalid');
  const parsed: ProductionRunnerOptions = { machineId: values.get('--machine-id') ?? '', role: values.get('--role') as 'A' | 'B', port: Number(values.get('--port')), report: values.get('--report') ?? '', tunEvidence: values.get('--tun-evidence') ?? '', physicalOpenAir, ...(host ? { host } : {}) };
  const fastGuard = values.get('--fast-guard-ms');
  if (fastGuard !== undefined) parsed.fastGuardMs = Number(fastGuard);
  if (evidenceMode !== undefined) parsed.evidenceMode = evidenceMode;
  const fipsConfigOutput = values.get('--fips-config');
  if (fipsConfigOutput !== undefined) parsed.fipsConfigOutput = fipsConfigOutput;
  return parsed;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void startProductionRunner(parseCli(process.argv.slice(2))).then((runner) => {
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closing ??= runner.close().finally(() => {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      });
      return closing;
    };
    const stop = (): void => {
      void close().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    process.stdout.write(`FIPS over Sound runner listening on http://${LOOPBACK_HOST}:${runner.port}\n`);
  }).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
