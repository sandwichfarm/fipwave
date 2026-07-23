import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import manifest from '../../../fixtures/corpus/manifest.json' with { type: 'json' };
import type { CyrinxCase, CyrinxCaseMode, CyrinxResult } from './cyrinx-worker.js';
import { decodeFrame, encodeFrame, MessageType, type FwavFrame } from './protocol.js';
import {
  CyrinxQualificationSession,
  type CyrinxSessionSnapshot,
} from './qualification-session.js';
import {
  CYRINX_DEADLINE_MS,
  CYRINX_CODEC,
  MAX_QUEUE_BYTES,
  MAX_QUEUE_DURATION_MS,
  QUALIFICATION_DEAD_LINK_TIMEOUT_MS,
  QUIET_CODEC,
  writeMachineReport,
  type MachineReport,
  type MachineResult,
  type TunEvidence,
} from './report.js';

export const LOOPBACK_HOST = '127.0.0.1';
export const HEADER_BYTES = 32;
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const AUDIO_SETTINGS_MESSAGE_TYPE = MessageType.AUDIO_SETTINGS;
const MAX_QUEUE_AGE_MS = 5_000;

function findProjectRoot(from: string): string {
  let current = from;
  while (path.dirname(current) !== current) {
    if (existsSync(path.join(current, 'package.json'))) return current;
    current = path.dirname(current);
  }
  throw new Error('FIPS over Sound project root could not be located');
}
const PROJECT_ROOT = findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));
const MODEM_UI_PATH = path.join(PROJECT_ROOT, 'apps/modem-ui/index.html');

export interface QualificationReport {
  schemaVersion: 1; evidencePath: 'Loopback'; physicalQualification: false; qualificationStatus: 'not-physical'; capturedAt: string; reportPath: string;
  frame: { messageType: 'AUDIO_SETTINGS'; epoch: number; sequence: string; payloadBytes: number };
}
export interface ParsedAudioSettingsFrame { epoch: number; sequence: bigint; payload: Buffer; }
export interface RunnerQualificationConfig {
  machineId: string;
  role: 'A' | 'B';
  reportTarget: string;
  tunEvidence: string;
  tunEvidenceSource: TunEvidence['source'];
  evidenceMode: 'Fixture' | 'Loopback' | 'Open air';
  evidenceClass: 'Fixture' | 'Loopback' | 'Open air';
  buildCommit: string;
  codec: MachineReport['codec'];
  qualification: NonNullable<MachineReport['qualification']>;
}
export interface RunnerReportAuthority {
  tunEvidence: TunEvidence;
  build: { commit: string; os: string; architecture: string };
}
export interface CodecAsset { filename: string; mimeType: string; browserServing: boolean; sha256: string; }
export interface BridgeState {
  epoch: number; rejectedFrames: number; overflowedQueues: string[]; discontinuities: number;
  queueCounts: Partial<Record<keyof typeof MessageType, number>> & Record<string, number>;
  stampedResults: Array<Record<string, unknown>>;
}
export interface BridgeServer {
  port: number; sendPcmPlayback(frame: Buffer): void; startCyrinx(): Promise<{ codec: 'cyrinx' | 'quiet'; reasonCode: string | null; deadlineAtMs: number }>; reset(): Promise<number>; close(): Promise<void>; state(): BridgeState;
}
export interface CyrinxWorkerRuntime {
  begin(value: CyrinxCase, epoch: number, mode: CyrinxCaseMode): Promise<Buffer | undefined>;
  receiveCapture(encoded: Buffer): Promise<CyrinxResult | undefined>;
  reset(): void;
}
export interface CyrinxTimer {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}
export interface BridgeServerOptions {
  host: typeof LOOPBACK_HOST;
  port: number;
  artifactDir: string;
  uiDir?: string;
  qualificationConfig?: RunnerQualificationConfig;
  reportAuthority?: RunnerReportAuthority;
  codecAssetDir?: string;
  codecAssets?: readonly CodecAsset[];
  reportWriter?: (reportPath: string, report: MachineReport) => Promise<string>;
  now?: () => number;
  /** Runner-owned only: this is invoked after the immutable deadline is stamped. */
  cyrinxBuild?: () => Promise<void>;
  /** Runner-owned codec-neutral native encode/decode gate. */
  cyrinxDigital?: (context: { epoch: number; evidenceClass: MachineReport['evidenceClass']; nowMs: number }) => Promise<void>;
  /** Runner-owned native batch worker. The browser never receives this authority. */
  cyrinxWorker?: CyrinxWorkerRuntime;
  cyrinxTimer?: CyrinxTimer;
  cyrinxSettle?: (delayMs: number) => Promise<void>;
}

class BridgeInputError extends Error {
  constructor(readonly reasonCode: string) { super(reasonCode); }
}
function fail(message: string): never { throw new BridgeInputError(message); }
function asBuffer(rawData: RawData): Buffer { return Buffer.isBuffer(rawData) ? rawData : Array.isArray(rawData) ? Buffer.concat(rawData) : Buffer.from(rawData); }
function isSameOriginLoopback(origin: string | undefined, port: number): boolean {
  if (!origin) return false;
  try { const parsed = new URL(origin); return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === String(port); } catch { return false; }
}
function rejectUpgrade(socket: Duplex): void { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); }
function contentType(file: string): string {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
function immutableConfig(config: RunnerQualificationConfig): RunnerQualificationConfig {
  return Object.freeze({ ...config, codec: Object.freeze({ ...config.codec }), qualification: Object.freeze({ ...config.qualification, deadline: Object.freeze({ ...config.qualification.deadline }), fallback: Object.freeze({ ...config.qualification.fallback }) }) });
}
function sha256(body: Buffer): string { return createHash('sha256').update(body).digest('hex'); }
function hasForbiddenAuthority(value: unknown): boolean {
  const forbidden = new Set(['machineId', 'role', 'reportTarget', 'report', 'tunEvidence', 'tunEvidenceSource', 'evidenceMode', 'evidenceClass', 'hostIdentity', 'buildCommit', 'codec', 'qualification', 'deadLinkTimeoutMs', 'cyrinxDeadlineMs', 'deadline', 'fallback', 'stage', 'terminal', 'instruction']);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasForbiddenAuthority);
  return Object.entries(value).some(([key, child]) => forbidden.has(key) || hasForbiddenAuthority(child));
}
function parseJsonPayload(frame: FwavFrame): Record<string, unknown> {
  if (frame.payload.length === 0) return {};
  try {
    const value = JSON.parse(frame.payload.toString('utf8')) as unknown;
    if (!value || Array.isArray(value) || typeof value !== 'object') fail('control_payload_not_object');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BridgeInputError) throw error;
    fail('control_payload_invalid_json');
  }
}

type BrowserAudio = Required<MachineReport['audio']> & { browserVersion: string };
interface BrowserResult {
  epoch: number; caseId: string; digest: string | null; receivedSha256: string | null;
  acquisitionMs: number; airtimeMs: number; deliveryCount: number; bytePerfect: boolean;
  coldAcquired: boolean; complete: boolean; corrupt: boolean; missing: number; duplicates: number;
  queues: MachineReport['queues'];
}
type CorpusEntry = { id: string; direction: MachineResult['direction']; size: 256 | 1536; sha256: string };
function exactObject(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function asBoolean(value: unknown, name: string): boolean { if (typeof value !== 'boolean') fail(name); return value; }
function asInteger(value: unknown, name: string): number { if (!Number.isInteger(value) || (value as number) < 0) fail(name); return value as number; }
function asText(value: unknown, name: string): string { if (typeof value !== 'string' || value.trim() === '') fail(name); return value; }
function parseBrowserAudio(payload: Record<string, unknown>): BrowserAudio {
  const keys = ['browserVersion', 'microphoneLabel', 'contextState', 'inputDeviceSampleRate', 'inputDeviceChannels', 'contextSampleRate', 'captureSampleRate', 'channels', 'echoCancellation', 'noiseSuppression', 'autoGainControl'];
  if (!exactObject(payload, keys)) fail('audio_settings_shape_invalid');
  return {
    browserVersion: asText(payload.browserVersion, 'browser_version_invalid'),
    microphoneLabel: asText(payload.microphoneLabel, 'microphone_label_invalid'),
    contextState: asText(payload.contextState, 'audio_context_state_invalid'),
    inputDeviceSampleRate: asInteger(payload.inputDeviceSampleRate, 'input_device_sample_rate_invalid'),
    inputDeviceChannels: asInteger(payload.inputDeviceChannels, 'input_device_channels_invalid'),
    contextSampleRate: asInteger(payload.contextSampleRate, 'context_sample_rate_invalid'),
    captureSampleRate: asInteger(payload.captureSampleRate, 'capture_sample_rate_invalid'),
    channels: asInteger(payload.channels, 'channels_invalid'),
    echoCancellation: asBoolean(payload.echoCancellation, 'echo_cancellation_invalid'),
    noiseSuppression: asBoolean(payload.noiseSuppression, 'noise_suppression_invalid'),
    autoGainControl: asBoolean(payload.autoGainControl, 'auto_gain_control_invalid'),
  };
}
function parseQueues(value: unknown): MachineReport['queues'] {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactObject(value as Record<string, unknown>, ['captureHighWaterBytes', 'captureHighWaterMs', 'discontinuities', 'playbackHighWaterBytes', 'playbackHighWaterMs'])) fail('queue_evidence_shape_invalid');
  const queues = value as Record<string, unknown>;
  return { captureHighWaterBytes: asInteger(queues.captureHighWaterBytes, 'capture_queue_bytes_invalid'), captureHighWaterMs: asInteger(queues.captureHighWaterMs, 'capture_queue_time_invalid'), playbackHighWaterBytes: asInteger(queues.playbackHighWaterBytes, 'playback_queue_bytes_invalid'), playbackHighWaterMs: asInteger(queues.playbackHighWaterMs, 'playback_queue_time_invalid'), discontinuities: asInteger(queues.discontinuities, 'queue_discontinuities_invalid') };
}
function parseBrowserResult(payload: Record<string, unknown>, epoch: number): BrowserResult {
  const keys = ['caseId', 'digest', 'acquisitionMs', 'airtimeMs', 'deliveryCount', 'bytePerfect', 'coldAcquired', 'complete', 'corrupt', 'missing', 'duplicates', 'queues'];
  if (!exactObject(payload, keys)) fail('qualification_result_shape_invalid');
  const complete = asBoolean(payload.complete, 'complete_flag_invalid');
  const received = payload.digest;
  if (received !== null && (typeof received !== 'string' || !/^[a-f0-9]{64}$/i.test(received))) fail('received_digest_invalid');
  if (complete && received === null) fail('complete_result_digest_missing');
  return {
    epoch,
    caseId: asText(payload.caseId, 'case_id_invalid'),
    digest: received,
    receivedSha256: received,
    acquisitionMs: asInteger(payload.acquisitionMs, 'acquisition_time_invalid'),
    airtimeMs: asInteger(payload.airtimeMs, 'airtime_invalid'),
    deliveryCount: asInteger(payload.deliveryCount, 'delivery_count_invalid'),
    bytePerfect: asBoolean(payload.bytePerfect, 'byte_perfect_invalid'),
    coldAcquired: asBoolean(payload.coldAcquired, 'cold_acquisition_invalid'),
    complete,
    corrupt: asBoolean(payload.corrupt, 'corrupt_flag_invalid'),
    missing: asInteger(payload.missing, 'missing_count_invalid'),
    duplicates: asInteger(payload.duplicates, 'duplicate_count_invalid'),
    queues: parseQueues(payload.queues),
  };
}

export function parseAudioSettingsFrame(frame: Buffer): ParsedAudioSettingsFrame {
  const parsed = decodeFrame(frame);
  if (parsed.type !== MessageType.AUDIO_SETTINGS) fail('FWAV message type is not AUDIO_SETTINGS');
  return { epoch: parsed.epoch, sequence: parsed.sequence, payload: parsed.payload };
}
export async function writeQualificationReport(report: QualificationReport): Promise<string> {
  await mkdir(path.dirname(report.reportPath), { recursive: true });
  const temporaryPath = `${report.reportPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); await rename(temporaryPath, report.reportPath); return report.reportPath;
}
export async function readQualificationReport(reportPath: string): Promise<QualificationReport> {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as QualificationReport;
  if (report.schemaVersion !== 1 || report.evidencePath !== 'Loopback' || report.physicalQualification !== false || report.qualificationStatus !== 'not-physical') fail('qualification report is not a schema-versioned non-physical loopback report');
  return report;
}
function closeServer(server: Server, webSocketServer: WebSocketServer): Promise<void> { return new Promise((resolve, reject) => webSocketServer.close((webSocketError) => webSocketError ? reject(webSocketError) : server.close((serverError) => serverError ? reject(serverError) : resolve()))); }
interface QueueEntry { frame: FwavFrame; enqueuedAt: number; }
interface Queue { frames: QueueEntry[]; bytes: number; overflowed: boolean; }
function queueName(type: MessageType): string { return MessageType[type]; }
function acoustic(type: MessageType): boolean { return type === MessageType.PCM_CAPTURE || type === MessageType.PCM_PLAYBACK; }
function p95(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
}

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServer> {
  if (options.host !== LOOPBACK_HOST) fail(`bridge host must be ${LOOPBACK_HOST}`);
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) fail('bridge port must be an integer between 0 and 65535');
  await mkdir(options.artifactDir, { recursive: true });
  const config = options.qualificationConfig && immutableConfig(options.qualificationConfig);
  const cyrinxSession = config ? new CyrinxQualificationSession(config.role) : undefined;
  const corpus = manifest.cases as CorpusEntry[];
  const expectedDirection = config?.role === 'A' ? 'B → A' : 'A → B';
  const expectedCorpus = corpus.filter((entry) => entry.direction === expectedDirection);
  const expectedById = new Map(expectedCorpus.map((entry) => [entry.id, entry]));
  const uiRoot = options.uiDir ? await realpath(options.uiDir) : undefined;
  const assets = new Map<string, CodecAsset>();
  for (const asset of options.codecAssets ?? []) {
    if (!asset.browserServing) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.filename) || assets.has(asset.filename) || !/^[a-f0-9]{64}$/.test(asset.sha256)) fail('codec asset allowlist is invalid');
    assets.set(asset.filename, asset);
  }
  const assetRoot = options.codecAssetDir ? await realpath(options.codecAssetDir) : undefined;
  if (assets.size && !assetRoot) fail('codec assets require a verified cache directory');
  const serveFile = async (response: import('node:http').ServerResponse, root: string, requestPath: string, mime?: string, asset?: CodecAsset, headOnly = false): Promise<void> => {
    if (requestPath.includes('\\') || requestPath.split('/').some((segment) => segment === '.' || segment === '..' || segment === '')) { response.writeHead(404).end(); return; }
    const candidate = path.resolve(root, requestPath);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) { response.writeHead(404).end(); return; }
    try {
      const metadata = await lstat(candidate); if (!metadata.isFile() || metadata.isSymbolicLink()) { response.writeHead(404).end(); return; }
      const resolved = await realpath(candidate); if (!resolved.startsWith(`${root}${path.sep}`)) { response.writeHead(404).end(); return; }
      const body = await readFile(resolved); if (asset && sha256(body) !== asset.sha256) { response.writeHead(404).end(); return; }
      const headers: Record<string, string> = { 'content-type': mime ?? contentType(requestPath), 'content-length': String(body.byteLength), 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=31536000, immutable' };
      if (asset) headers.etag = `"sha256-${asset.sha256}"`;
      response.writeHead(200, headers); response.end(headOnly ? undefined : body);
    } catch { response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found'); }
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`);
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    if (url.pathname === '/qualification-config' && config) { response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(config)); return; }
    if (url.pathname.startsWith('/codec-assets/')) {
      const filename = url.pathname.slice('/codec-assets/'.length); const asset = !url.search && assets.get(filename);
      if (!asset || !assetRoot || filename !== encodeURIComponent(filename)) { response.writeHead(404).end(); return; }
      void serveFile(response, assetRoot, filename, asset.mimeType, asset, request.method === 'HEAD'); return;
    }
    if (url.pathname === '/' && !url.search) {
      if (uiRoot) { void serveFile(response, uiRoot, 'index.html'); return; }
      void readFile(MODEM_UI_PATH).then((page) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(page); }).catch(() => { response.writeHead(404).end(); }); return;
    }
    if (uiRoot && !url.search) { void serveFile(response, uiRoot, url.pathname.slice(1)); return; }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found');
  });
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const clients = new Set<WebSocket>(); const queues = new Map<MessageType, Queue>();
  const state: BridgeState = { epoch: 1, rejectedFrames: 0, overflowedQueues: [], discontinuities: 0, queueCounts: {}, stampedResults: [] };
  let audio: BrowserAudio | undefined; let generation = 1; let writeTail: Promise<unknown> = Promise.resolve();
  let results = new Map<string, BrowserResult>(); let failureReasons = new Set<string>();
  let owner: WebSocket | undefined; let epochClaimed = false; let reconnectAllowed = false;
  let cyrinxExpiryTimer: unknown;
  for (const type of [MessageType.PCM_CAPTURE, MessageType.PCM_PLAYBACK, MessageType.QUALIFICATION_CASE, MessageType.QUALIFICATION_RESULT, MessageType.ERROR, MessageType.RESET]) queues.set(type, { frames: [], bytes: 0, overflowed: false });
  const refreshState = () => { for (const [type, queue] of queues) state.queueCounts[queueName(type)] = queue.frames.length; };
  const clearQueues = () => { for (const queue of queues.values()) { queue.frames = []; queue.bytes = 0; queue.overflowed = false; } refreshState(); };
  const enqueue = (frame: FwavFrame): void => {
    const queue = queues.get(frame.type); if (!queue) return;
    const now = options.now?.() ?? Date.now();
    while (queue.frames.length && now - queue.frames[0]!.enqueuedAt > MAX_QUEUE_AGE_MS) {
      const expired = queue.frames.shift()!; queue.bytes -= expired.frame.payload.byteLength + HEADER_BYTES;
      if (acoustic(frame.type)) state.discontinuities += 1;
    }
    if (queue.bytes + frame.payload.byteLength + HEADER_BYTES > MAX_MESSAGE_BYTES) {
      queue.overflowed = true; state.overflowedQueues = [...new Set([...state.overflowedQueues, queueName(frame.type)])];
      if (acoustic(frame.type)) state.discontinuities += 1;
      fail(`FWAV ${queueName(frame.type)} queue overflow`);
    }
    queue.frames.push({ frame, enqueuedAt: now }); queue.bytes += frame.payload.byteLength + HEADER_BYTES; refreshState();
  };
  const clock = (): number => options.now?.() ?? Date.now();
  const timer: CyrinxTimer = options.cyrinxTimer ?? {
    set: (callback, delayMs) => setTimeout(callback, delayMs),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  function clearCyrinxTimer(): void {
    if (cyrinxExpiryTimer !== undefined) timer.clear(cyrinxExpiryTimer);
    cyrinxExpiryTimer = undefined;
  }
  const settleExpiry = (): boolean => {
    if (!cyrinxSession || !cyrinxSession.expire(clock())) return false;
    options.cyrinxWorker?.reset();
    clearCyrinxTimer();
    failureReasons.add('cyrinx_deadline_expired');
    return true;
  };
  const sessionSnapshot = (): CyrinxSessionSnapshot | undefined => {
    const changed = settleExpiry();
    const snapshot = cyrinxSession?.snapshot(state.epoch, clock());
    if (changed && snapshot) {
      const encoded = JSON.stringify(snapshot);
      queueMicrotask(() => {
        for (const client of clients) if (client.readyState === client.OPEN) client.send(encoded);
      });
    }
    return snapshot;
  };
  const reportAuthority = (): {
    codec: MachineReport['codec'];
    qualification: NonNullable<MachineReport['qualification']>;
    snapshot?: CyrinxSessionSnapshot;
  } | undefined => {
    if (!config) return undefined;
    const snapshot = sessionSnapshot();
    if (!snapshot || snapshot.codec === 'idle') {
      return {
        codec: { ...config.codec },
        qualification: {
          ...config.qualification,
          deadline: { ...config.qualification.deadline },
          fallback: { ...config.qualification.fallback },
        },
        ...(snapshot ? { snapshot } : {}),
      };
    }
    return {
      codec: { ...(snapshot.codec === 'cyrinx' ? CYRINX_CODEC : QUIET_CODEC) },
      qualification: {
        deadLinkTimeoutMs: QUALIFICATION_DEAD_LINK_TIMEOUT_MS,
        cyrinxDeadlineMs: CYRINX_DEADLINE_MS,
        deadline: { ...snapshot.deadline },
        physicalGate: config.evidenceClass === 'Open air' ? 'pending' : 'not_physical',
        fallback: { ...snapshot.fallback },
      },
      snapshot,
    };
  };
  const buildReport = (): MachineReport | undefined => {
    if (!config || !options.reportAuthority || !expectedDirection) return undefined;
    const authority = reportAuthority();
    if (!authority) return undefined;
    const canonicalResults: MachineResult[] = expectedCorpus.map((entry) => {
      const observed = results.get(entry.id);
      return observed ? { epoch: state.epoch, direction: expectedDirection, caseId: entry.id, size: entry.size, expectedSha256: entry.sha256, receivedSha256: observed.receivedSha256 ?? null, acquisitionMs: observed.acquisitionMs, airtimeMs: observed.airtimeMs, deliveryCount: observed.deliveryCount, bytePerfect: observed.bytePerfect, coldAcquired: observed.coldAcquired, observed: true, complete: observed.complete, corrupt: observed.corrupt, missing: observed.missing, duplicates: observed.duplicates } : { epoch: state.epoch, direction: expectedDirection, caseId: entry.id, size: entry.size, expectedSha256: entry.sha256, receivedSha256: null, acquisitionMs: 0, airtimeMs: 0, deliveryCount: 0, bytePerfect: false, coldAcquired: false, observed: false, complete: false, corrupt: false, missing: 1, duplicates: 0 };
    });
    const values = [...results.values()];
    const queuesEvidence = values.reduce<MachineReport['queues']>((current, value) => ({ captureHighWaterBytes: Math.max(current.captureHighWaterBytes, value.queues.captureHighWaterBytes), captureHighWaterMs: Math.max(current.captureHighWaterMs, value.queues.captureHighWaterMs), playbackHighWaterBytes: Math.max(current.playbackHighWaterBytes, value.queues.playbackHighWaterBytes), playbackHighWaterMs: Math.max(current.playbackHighWaterMs, value.queues.playbackHighWaterMs), discontinuities: Math.max(current.discontinuities, value.queues.discontinuities) }), { captureHighWaterBytes: 0, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: state.discontinuities });
    const good = canonicalResults.filter((value) => value.observed && value.complete && !value.corrupt && value.missing === 0 && value.duplicates === 0 && value.deliveryCount === 1 && value.bytePerfect && value.receivedSha256 === value.expectedSha256);
    const reasons = new Set(failureReasons);
    if (authority.snapshot?.fallback.reasonCode) reasons.add(authority.snapshot.fallback.reasonCode);
    const audioPassed = Boolean(audio?.microphoneLabel && audio.contextState === 'running' && (audio.inputDeviceSampleRate === 44_100 || audio.inputDeviceSampleRate === 48_000) && (audio.inputDeviceChannels === 1 || audio.inputDeviceChannels === 2) && audio.contextSampleRate === 48_000 && audio.captureSampleRate === 48_000 && audio.channels === 1 && !audio.echoCancellation && !audio.noiseSuppression && !audio.autoGainControl);
    if (!audioPassed) reasons.add('audio_preflight_failed');
    if (good.filter((value) => value.size === 256).length < 19 || good.filter((value) => value.size === 1536).length < 5) reasons.add('corpus_incomplete');
    const coldReceivePassed = authority.snapshot?.codec === 'cyrinx'
      ? Boolean(cyrinxSession?.coldReceivePassed)
      : good.some((value) => value.coldAcquired);
    if (good.length > 0 && !coldReceivePassed) reasons.add('cold_acquisition_failed');
    if (good.length > 0 && p95(good.map((value) => value.airtimeMs)) >= QUALIFICATION_DEAD_LINK_TIMEOUT_MS / 3) reasons.add('airtime_budget_exceeded');
    if (queuesEvidence.captureHighWaterBytes > MAX_QUEUE_BYTES || queuesEvidence.playbackHighWaterBytes > MAX_QUEUE_BYTES || queuesEvidence.captureHighWaterMs > MAX_QUEUE_DURATION_MS || queuesEvidence.playbackHighWaterMs > MAX_QUEUE_DURATION_MS) reasons.add('queue_bound_exceeded');
    if (queuesEvidence.discontinuities > 0) reasons.add('queue_discontinuity');
    for (const value of canonicalResults.filter((entry) => entry.observed)) {
      if (value.duplicates! > 0 || value.deliveryCount !== 1) reasons.add('duplicate_case');
      if (value.receivedSha256 !== value.expectedSha256 || !value.bytePerfect || value.corrupt) reasons.add('bad_digest');
      if (!value.complete || value.missing! > 0) reasons.add('partial_evidence');
    }
    const corpusComplete = !reasons.has('corpus_incomplete') && !reasons.has('bad_digest') && !reasons.has('duplicate_case') && !reasons.has('partial_evidence') && !reasons.has('airtime_budget_exceeded') && !reasons.has('cold_acquisition_failed') && !reasons.has('queue_bound_exceeded') && !reasons.has('queue_discontinuity') && audioPassed;
    const stageAuthorityPassed = authority.snapshot?.codec === 'cyrinx'
      ? authority.snapshot.stage === 'complete' && Boolean(cyrinxSession?.coldReceivePassed)
      : authority.snapshot?.codec === 'quiet'
        ? authority.snapshot.fallback.state === 'activated' && coldReceivePassed
        : config.evidenceClass !== 'Open air';
    const complete = corpusComplete && (config.evidenceClass !== 'Open air' || stageAuthorityPassed);
    const evidenceFailed = values.length >= 24 && !corpusComplete;
    const physicalGate: NonNullable<MachineReport['qualification']>['physicalGate'] =
      config.evidenceClass !== 'Open air'
        ? 'not_physical'
        : complete && stageAuthorityPassed
          ? 'passed'
          : authority.snapshot?.codec === 'unqualified' || evidenceFailed
            ? 'failed'
            : 'pending';
    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      machine: {
        hostName: config.machineId,
        os: options.reportAuthority.build.os,
        architecture: options.reportAuthority.build.architecture,
        browserVersion: audio?.browserVersion ?? 'Unavailable',
        commit: options.reportAuthority.build.commit,
      },
      evidenceClass: config.evidenceClass,
      epoch: state.epoch,
      codec: { ...authority.codec },
      audio: audio
        ? {
            microphoneLabel: audio.microphoneLabel,
            contextState: audio.contextState,
            inputDeviceSampleRate: audio.inputDeviceSampleRate,
            inputDeviceChannels: audio.inputDeviceChannels,
            contextSampleRate: audio.contextSampleRate,
            captureSampleRate: audio.captureSampleRate,
            channels: audio.channels,
            echoCancellation: audio.echoCancellation,
            noiseSuppression: audio.noiseSuppression,
            autoGainControl: audio.autoGainControl,
          }
        : {
            microphoneLabel: 'Unavailable',
            contextState: 'unavailable',
            inputDeviceSampleRate: 0,
            inputDeviceChannels: 0,
            contextSampleRate: 0,
            captureSampleRate: 0,
            channels: 0,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
      queues: queuesEvidence,
      results: canonicalResults,
      complete,
      reasonCodes: [...reasons],
      qualification: {
        ...authority.qualification,
        deadline: { ...authority.qualification.deadline },
        fallback: { ...authority.qualification.fallback },
        physicalGate,
      },
      runner: {
        machineId: config.machineId,
        role: config.role,
        reportTarget: config.reportTarget,
        evidenceClass: config.evidenceClass,
        tunEvidence: options.reportAuthority.tunEvidence,
      },
    };
  };
  const persist = (expectedGeneration = generation): Promise<string | undefined> => {
    const snapshot = buildReport(); if (!snapshot || !config) return Promise.resolve(undefined);
    const writer = options.reportWriter ?? writeMachineReport;
    const task = writeTail.then(async () => expectedGeneration === generation ? writer(config.reportTarget, snapshot) : undefined);
    writeTail = task.catch(() => undefined); return task;
  };
  const broadcastJson = (value: unknown): void => {
    const encoded = JSON.stringify(value);
    for (const client of clients) if (client.readyState === client.OPEN) client.send(encoded);
  };
  const broadcastSession = (): void => {
    const snapshot = sessionSnapshot();
    if (snapshot) broadcastJson(snapshot);
  };
  const activateCurrentFallback = async (): Promise<boolean> => {
    if (!cyrinxSession || cyrinxSession.codec !== 'cyrinx') return false;
    const changed = cyrinxSession.failCurrent(clock());
    if (!changed) return false;
    generation += 1;
    options.cyrinxWorker?.reset();
    clearCyrinxTimer();
    if (cyrinxSession.fallbackReason) failureReasons.add(cyrinxSession.fallbackReason);
    await persist(generation);
    broadcastSession();
    return true;
  };
  const expireCyrinx = async (): Promise<boolean> => {
    if (!settleExpiry()) return false;
    await persist();
    broadcastSession();
    return true;
  };
  const cyrinxSummary = (): { codec: 'cyrinx' | 'quiet'; reasonCode: string | null; deadlineAtMs: number } => {
    if (!cyrinxSession) fail('cyrinx authority is unavailable');
    const snapshot = cyrinxSession.snapshot(state.epoch, clock());
    if (snapshot.deadline.deadlineAtMs === null) fail('cyrinx deadline is unavailable');
    return {
      codec: snapshot.codec === 'cyrinx' ? 'cyrinx' : 'quiet',
      reasonCode: snapshot.fallback.reasonCode,
      deadlineAtMs: snapshot.deadline.deadlineAtMs,
    };
  };
  const reset = async (): Promise<number> => {
    if (cyrinxSession?.operatorReset(clock()) && cyrinxSession.fallbackReason) {
      failureReasons.add(cyrinxSession.fallbackReason);
    }
    clearCyrinxTimer();
    options.cyrinxWorker?.reset();
    generation += 1; state.epoch += 1; audio = undefined; results = new Map(); failureReasons = new Set(cyrinxSession?.fallbackReason ? [cyrinxSession.fallbackReason] : []); state.stampedResults = []; state.overflowedQueues = []; state.discontinuities = 0; clearQueues(); reconnectAllowed = true;
    await persist(generation);
    const resetFrame = encodeFrame({ type: MessageType.RESET, epoch: state.epoch, sequence: 0n, payload: Buffer.alloc(0) });
    for (const client of clients) if (client.readyState === client.OPEN) client.send(resetFrame);
    broadcastSession();
    return state.epoch;
  };
  const startCyrinx = async (): Promise<{ codec: 'cyrinx' | 'quiet'; reasonCode: string | null; deadlineAtMs: number }> => {
    if (!cyrinxSession || !config) fail('cyrinx authority is unavailable');
    if (!cyrinxSession.start(clock())) {
      await expireCyrinx();
      return cyrinxSummary();
    }
    cyrinxExpiryTimer = timer.set(() => { void expireCyrinx(); }, CYRINX_DEADLINE_MS);
    await persist();
    broadcastSession();
    try {
      await options.cyrinxBuild?.();
      if (await expireCyrinx()) return cyrinxSummary();
      cyrinxSession.completeBuild(clock());
      await persist();
      broadcastSession();
      await options.cyrinxDigital?.({ epoch: state.epoch, evidenceClass: config.evidenceClass, nowMs: clock() });
      if (await expireCyrinx()) return cyrinxSummary();
      cyrinxSession.completeDigital(clock());
      await persist();
      broadcastSession();
    } catch {
      await activateCurrentFallback();
    }
    return cyrinxSummary();
  };
  if (config && options.reportAuthority) await persist();
  const instructionRequest = (
    payload: Record<string, unknown>,
    action: 'accept_cyrinx_instruction' | 'playback_complete',
  ): { caseId: string; direction: MachineResult['direction'] } => {
    if (!exactObject(payload, ['action', 'caseId', 'direction']) || payload.action !== action) fail('qualification_instruction_shape_invalid');
    const direction = payload.direction;
    if (direction !== 'A → B' && direction !== 'B → A') fail('qualification_instruction_direction_invalid');
    return { caseId: asText(payload.caseId, 'qualification_instruction_case_invalid'), direction };
  };
  const forwardPlayback = (encoded: Buffer): void => {
    const frame = decodeFrame(encoded);
    if (frame.type !== MessageType.PCM_PLAYBACK) fail('bridge only forwards PCM_PLAYBACK frames');
    if (frame.epoch !== state.epoch) fail('bridge rejects stale PCM playback epoch');
    for (const client of clients) if (client.readyState === client.OPEN) client.send(encoded);
  };
  const acceptCyrinxInstruction = async (payload: Record<string, unknown>): Promise<void> => {
    if (!cyrinxSession || cyrinxSession.codec !== 'cyrinx' || !options.cyrinxWorker) fail('cyrinx_instruction_unavailable');
    if (await expireCyrinx()) return;
    const request = instructionRequest(payload, 'accept_cyrinx_instruction');
    const accepted = cyrinxSession.acceptInstruction(request.caseId, request.direction, clock());
    const acceptedGeneration = generation;
    try {
      const playback = await options.cyrinxWorker.begin(accepted.value, state.epoch, accepted.mode);
      if (acceptedGeneration !== generation || cyrinxSession.codec !== 'cyrinx' || await expireCyrinx()) return;
      if (accepted.mode === 'transmit') {
        if (!playback) throw new Error('cyrinx_transmit_playback_missing');
        forwardPlayback(playback);
      } else if (playback !== undefined) {
        throw new Error('cyrinx_listener_created_playback');
      }
    } catch {
      if (acceptedGeneration === generation) await activateCurrentFallback();
    }
  };
  const completeCyrinxPlayback = async (payload: Record<string, unknown>): Promise<void> => {
    if (!cyrinxSession || cyrinxSession.codec !== 'cyrinx') fail('cyrinx_instruction_unavailable');
    const request = instructionRequest(payload, 'playback_complete');
    const current = cyrinxSession.currentCase();
    if (!current || current.id !== request.caseId || current.direction !== request.direction) fail('qualification_instruction_mismatch');
    const acceptedGeneration = generation;
    const remaining = cyrinxSession.transmitSettleRemaining(clock());
    if (remaining > 0) {
      if (options.cyrinxSettle) await options.cyrinxSettle(remaining);
      else await new Promise<void>((resolve) => setTimeout(resolve, remaining));
    }
    if (acceptedGeneration !== generation || cyrinxSession.codec !== 'cyrinx' || await expireCyrinx()) return;
    cyrinxSession.completeAccepted('transmit', clock());
    if (cyrinxSession.terminal) clearCyrinxTimer();
    await persist(acceptedGeneration);
    if (acceptedGeneration === generation) broadcastSession();
  };
  const acceptCyrinxCapture = async (socket: WebSocket, encoded: Buffer): Promise<void> => {
    if (!cyrinxSession || cyrinxSession.codec !== 'cyrinx') return;
    if (await expireCyrinx() || !cyrinxSession.canReceiveCapture() || !options.cyrinxWorker) return;
    const acceptedGeneration = generation;
    let nativeResult: CyrinxResult | undefined;
    try {
      nativeResult = await options.cyrinxWorker.receiveCapture(encoded);
    } catch {
      if (acceptedGeneration === generation) await activateCurrentFallback();
      return;
    }
    if (!nativeResult || acceptedGeneration !== generation || cyrinxSession.codec !== 'cyrinx' || await expireCyrinx()) return;
    const current = cyrinxSession.currentCase();
    if (
      !current
      || nativeResult.epoch !== state.epoch
      || nativeResult.direction !== current.direction
      || nativeResult.caseId !== current.id
      || nativeResult.digest !== current.digest
      || !nativeResult.complete
      || nativeResult.corrupt
      || nativeResult.missing !== 0
      || nativeResult.duplicates !== 0
      || nativeResult.deliveryCount !== 1
      || !nativeResult.bytePerfect
    ) {
      await activateCurrentFallback();
      return;
    }
    if (!current.cold) {
      const committed = expectedById.get(current.id);
      if (!committed) {
        await activateCurrentFallback();
        return;
      }
      if (results.has(current.id)) {
        failureReasons.add('duplicate_case');
        await activateCurrentFallback();
        return;
      }
      const result: BrowserResult = {
        epoch: state.epoch,
        caseId: current.id,
        digest: nativeResult.digest,
        receivedSha256: nativeResult.digest,
        acquisitionMs: nativeResult.acquisitionMs,
        airtimeMs: nativeResult.airtimeMs,
        deliveryCount: nativeResult.deliveryCount,
        bytePerfect: nativeResult.bytePerfect,
        coldAcquired: false,
        complete: nativeResult.complete,
        corrupt: nativeResult.corrupt,
        missing: nativeResult.missing,
        duplicates: nativeResult.duplicates,
        queues: { ...nativeResult.queues },
      };
      results.set(current.id, result);
      state.stampedResults.push({ caseId: current.id, epoch: state.epoch, machineId: config?.machineId, role: config?.role, evidenceClass: config?.evidenceClass, source: 'native-cyrinx' });
    }
    const cold = current.cold;
    cyrinxSession.completeAccepted('listen', clock());
    if (cyrinxSession.terminal) clearCyrinxTimer();
    await persist(acceptedGeneration);
    if (acceptedGeneration !== generation) return;
    socket.send(JSON.stringify({ kind: 'cyrinx-result', epoch: state.epoch, caseId: current.id, direction: current.direction, accepted: true, cold }));
    broadcastSession();
  };
  const handleFrame = async (socket: WebSocket, rawData: RawData, isBinary: boolean, lastSequence: { value: bigint }): Promise<void> => {
    try {
      if (!isBinary) fail('binary_frames_required');
      const encoded = asBuffer(rawData);
      const frame = decodeFrame(encoded);
      if (frame.type === MessageType.AUDIO_SETTINGS && lastSequence.value < 0n && state.epoch === 1) state.epoch = frame.epoch;
      if (frame.epoch !== state.epoch || frame.sequence <= lastSequence.value) fail('stale_or_duplicate_frame');
      lastSequence.value = frame.sequence;
      await expireCyrinx();
      if (frame.type === MessageType.RESET) { await reset(); lastSequence.value = -1n; return; }
      if (frame.type === MessageType.PCM_CAPTURE && cyrinxSession?.codec === 'cyrinx') {
        await acceptCyrinxCapture(socket, encoded);
        return;
      }
      if ([MessageType.QUALIFICATION_CASE, MessageType.QUALIFICATION_RESULT, MessageType.ERROR].includes(frame.type)) {
        const payload = parseJsonPayload(frame); if (hasForbiddenAuthority(payload)) fail('browser_authority_forbidden');
        if (frame.type === MessageType.QUALIFICATION_CASE && payload.action === 'start_cyrinx' && Object.keys(payload).length === 1) {
          await startCyrinx(); return;
        }
        if (frame.type === MessageType.QUALIFICATION_CASE && payload.action === 'accept_cyrinx_instruction') {
          await acceptCyrinxInstruction(payload); return;
        }
        if (frame.type === MessageType.QUALIFICATION_CASE && payload.action === 'playback_complete') {
          await completeCyrinxPlayback(payload); return;
        }
        if (frame.type === MessageType.ERROR && cyrinxSession?.codec === 'cyrinx') {
          await activateCurrentFallback(); return;
        }
        if (frame.type === MessageType.ERROR && cyrinxSession?.codec === 'quiet' && cyrinxSession.fallbackState === 'activated') {
          cyrinxSession.markQuietFailed();
          options.cyrinxWorker?.reset();
          await persist();
          broadcastSession();
          return;
        }
        if (frame.type === MessageType.QUALIFICATION_RESULT && config) {
          if (cyrinxSession?.codec === 'cyrinx' || cyrinxSession?.codec === 'unqualified') fail('browser_result_forbidden_during_cyrinx');
          let result: BrowserResult;
          try {
            result = parseBrowserResult(payload, frame.epoch);
            if (!expectedById.has(result.caseId)) fail('unknown_case');
          } catch (error) {
            failureReasons.add(error instanceof BridgeInputError ? error.reasonCode : 'qualification_result_invalid');
            await persist(); throw error;
          }
          const existing = results.get(result.caseId);
          if (existing) {
            results.set(result.caseId, { ...existing, deliveryCount: Math.max(2, existing.deliveryCount + 1), duplicates: existing.duplicates! + 1 });
            failureReasons.add('duplicate_case'); await persist(); fail('duplicate_case');
          }
          results.set(result.caseId, result);
          state.stampedResults.push({ caseId: result.caseId, epoch: frame.epoch, machineId: config.machineId, role: config.role, evidenceClass: config.evidenceClass });
          const acceptedGeneration = generation;
          await persist(acceptedGeneration);
          if (acceptedGeneration !== generation || frame.epoch !== state.epoch) return;
          socket.send(JSON.stringify({ kind: 'qualification-result', caseId: result.caseId, epoch: frame.epoch, accepted: true }));
        }
      }
      if (frame.type === MessageType.AUDIO_SETTINGS) {
        if (config) {
          const payload = parseJsonPayload(frame); if (hasForbiddenAuthority(payload)) fail('browser_authority_forbidden');
          audio = parseBrowserAudio(payload); await persist();
        }
        const reportPath = path.join(options.artifactDir, 'loopback-qualification.json');
        await writeQualificationReport({ schemaVersion: 1, evidencePath: 'Loopback', physicalQualification: false, qualificationStatus: 'not-physical', capturedAt: new Date().toISOString(), reportPath, frame: { messageType: 'AUDIO_SETTINGS', epoch: frame.epoch, sequence: frame.sequence.toString(), payloadBytes: frame.payload.byteLength } });
        socket.send(JSON.stringify({ reportPath, physicalQualification: false })); return;
      }
      enqueue(frame);
    } catch (error) {
      if (config && error instanceof BridgeInputError) {
        failureReasons.add(error.reasonCode);
        await persist().catch(() => undefined);
      }
      state.rejectedFrames += 1;
      socket.close(1008, error instanceof Error ? error.message : 'invalid_fwav_message');
    }
  };
  const sendPcmPlayback = (encoded: Buffer): void => {
    forwardPlayback(encoded);
  };
  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const port = (server.address() as import('node:net').AddressInfo | null)?.port; const route = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`).pathname;
    if (!port || route !== '/bridge' || !isSameOriginLoopback(request.headers.origin, port)) { rejectUpgrade(socket); return; }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => webSocketServer.emit('connection', webSocket, request));
  });
  webSocketServer.on('connection', (socket) => {
    if (owner?.readyState === socket.OPEN || epochClaimed && !reconnectAllowed) { state.rejectedFrames += 1; socket.close(1008, 'one browser tab owns each qualification epoch'); return; }
    owner = socket; epochClaimed = true; reconnectAllowed = false; clients.add(socket);
    const lastSequence = { value: -1n }; let processing = Promise.resolve();
    void expireCyrinx().then((expired) => {
      if (expired) return;
      const snapshot = sessionSnapshot();
      if (snapshot && socket.readyState === socket.OPEN) socket.send(JSON.stringify(snapshot));
    });
    socket.once('close', () => { clients.delete(socket); if (owner === socket) owner = undefined; });
    socket.on('message', (rawData, isBinary) => { processing = processing.then(() => handleFrame(socket, rawData, isBinary, lastSequence)); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, LOOPBACK_HOST, () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') { await closeServer(server, webSocketServer); fail('bridge did not bind a TCP loopback address'); }
  return { port: address.port, sendPcmPlayback, startCyrinx, reset, close: async () => { clearCyrinxTimer(); options.cyrinxWorker?.reset(); for (const client of clients) client.terminate(); await writeTail; await closeServer(server, webSocketServer); }, state: () => ({ ...state, queueCounts: { ...state.queueCounts }, overflowedQueues: [...state.overflowedQueues], stampedResults: state.stampedResults.map((result) => ({ ...result })) }) };
}
