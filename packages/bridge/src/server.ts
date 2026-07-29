import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import manifest from '../../../fixtures/corpus/manifest.json' with { type: 'json' };
import type { CyrinxCase, CyrinxCaseMode, CyrinxResult } from './cyrinx-worker.js';
import type { CyrinxPacketTransport } from './cyrinx-transport.js';
import { ACOUSTIC_DISARM_CAPABILITY_BYTES, ACOUSTIC_READINESS_FRESHNESS_MS, FIPS_PACKET_ADMISSION_ACCEPTED, FIPS_PACKET_ADMISSION_QUEUE_FULL, decodeAcousticReadinessProof, decodeFipsPacketAdmission, decodeFrame, encodeFrame, MessageType, RESET_ACK_FLAG, type FwavFrame } from './protocol.js';
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
export interface RunnerAcousticCalibration {
  profiles: readonly ['quiet-audible-7k-v1'];
  ranges: Readonly<{ minPayloadBytes: number; maxPayloadBytes: number }>;
  candidates: readonly Readonly<{ id: string; profileId: 'quiet-audible-7k-v1'; payloadBytes: number; repetition: number; guardMs: number; playbackGain: number; ackTimeoutMs: number }>[];
  calibration: Readonly<{ maxCandidates: number; probesPerDirection: number; deadlineMs: number; maximumPlaybackGain: number }>;
}
export interface RunnerQualificationConfig {
  machineId: string;
  /** Exact FAS1 identity accepted during the acoustic HELLO exchange. */
  peerMachineId: string;
  role: 'A' | 'B';
  fipsNetwork?: Readonly<{ localPublicKey: string; peerPublicKey: string; localIpv6: string; peerIpv6: string }>;
  reportTarget: string;
  tunEvidence: string;
  tunEvidenceSource: TunEvidence['source'];
  evidenceMode: 'Fixture' | 'Loopback' | 'Open air';
  evidenceClass: 'Fixture' | 'Loopback' | 'Open air';
  buildCommit: string;
  codec: MachineReport['codec'];
  acoustic: RunnerAcousticCalibration;
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
  packetCounters: { browserToFips: number; fipsToBrowser: number };
  evidenceClass: 'Loopback'; acousticReady: boolean; peerConnected: false; pingReady: false;
}
/** Additional safe observability emitted by the FIPS packet bridge. */
export interface PacketBridgeState {
  packetQueues: {
    browserToFips: PacketQueueSnapshot;
    fipsToBrowser: PacketQueueSnapshot;
  };
  packetReadiness: { browser: boolean; fips: boolean };
  packetEndpoints: { browser: 'not-connected' | 'ready' | 'disconnected'; fips: 'not-connected' | 'ready' | 'disconnected'; worker: 'waiting' };
  lastAcceptedAtMs: number | null;
  lastError: { code: string; message: string } | null;
}
export interface PacketQueueLimits { maxItems: number; maxBytes: number; maxAgeMs: number; }
export type PacketQueueHealth = 'not-connected' | 'waiting' | 'ready' | 'overflow' | 'rejected';
export interface PacketQueueSnapshot extends PacketQueueLimits { items: number; bytes: number; health: PacketQueueHealth; }
export interface BridgeServer {
  port: number; sendPcmPlayback(frame: Buffer): void; startCyrinx(): Promise<{ codec: 'cyrinx' | 'quiet'; reasonCode: string | null; deadlineAtMs: number }>; reset(): Promise<number>; close(): Promise<void>; state(): BridgeState;
}
export interface ProofControllerApi { readonly role: 'A' | 'B'; peerStatus(): Promise<unknown>; status(): Promise<unknown>; ping(): Promise<unknown>; }
export interface ImageTransferControllerApi {
  readonly role: 'A' | 'B';
  send(width: number, height: number, rgba: Buffer): Promise<unknown>;
  status(): unknown;
}
export interface CyrinxWorkerRuntime {
  begin(value: CyrinxCase, epoch: number, mode: CyrinxCaseMode): Promise<Buffer | undefined>;
  receiveCapture(encoded: Buffer): Promise<CyrinxResult | undefined>;
  reset(): void;
}
export interface CyrinxPacketTransportRuntime {
  readonly receiving: boolean;
  encode(packet: Uint8Array, epoch: number): Promise<Buffer>;
  beginReceive(epoch: number): void;
  receiveCapture(encoded: Buffer): Promise<Uint8Array | undefined>;
  reset(): void;
}
export interface CyrinxTimer {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}
export interface CyrinxBuildContext { signal: AbortSignal; }
export interface CyrinxDigitalContext {
  epoch: number;
  evidenceClass: MachineReport['evidenceClass'];
  nowMs: number;
  signal: AbortSignal;
}
export interface BridgeServerOptions {
  /** Docker may require an all-interface listener inside its private namespace; host publication remains loopback-only. */
  host: typeof LOOPBACK_HOST | '0.0.0.0';
  port: number;
  artifactDir: string;
  uiDir?: string;
  qualificationConfig?: RunnerQualificationConfig;
  reportAuthority?: RunnerReportAuthority;
  codecAssetDir?: string;
  codecAssets?: readonly CodecAsset[];
  reportWriter?: (reportPath: string, report: MachineReport) => Promise<string>;
  now?: () => number;
  /** Bounded, independently configurable queues for opaque FIPS packets. */
  packetQueueLimits?: Partial<PacketQueueLimits>;
  /** Runner-owned only: this is invoked after the immutable deadline is stamped. */
  cyrinxBuild?: (context: CyrinxBuildContext) => Promise<void>;
  /** Runner-owned codec-neutral native encode/decode gate. */
  cyrinxDigital?: (context: CyrinxDigitalContext) => Promise<void>;
  /** Runner-owned native batch worker. The browser never receives this authority. */
  cyrinxWorker?: CyrinxWorkerRuntime;
  /** Fast packet modem used by the production acoustic session, never browser-controlled. */
  cyrinxTransport?: CyrinxPacketTransportRuntime;
  cyrinxTimer?: CyrinxTimer;
  cyrinxSettle?: (delayMs: number) => Promise<void>;
  /** Runner-owned proof surface; absence is explicit 503 rather than inferred readiness. */
  proofController?: ProofControllerApi;
  /** Runner-owned UDP/IPv6 image transfer through the shared FIPS namespace. */
  imageTransfer?: ImageTransferControllerApi;
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
  return Object.freeze({
    ...config,
    ...(config.fipsNetwork ? { fipsNetwork: Object.freeze({ ...config.fipsNetwork }) } : {}),
    codec: Object.freeze({ ...config.codec }),
    acoustic: Object.freeze({
      profiles: [...config.acoustic.profiles] as ['quiet-audible-7k-v1'],
      ranges: Object.freeze({ ...config.acoustic.ranges }),
      candidates: Object.freeze(config.acoustic.candidates.map((candidate) => Object.freeze({ ...candidate }))),
      calibration: Object.freeze({ ...config.acoustic.calibration }),
    }),
    qualification: Object.freeze({
      ...config.qualification,
      deadline: Object.freeze({ ...config.qualification.deadline }),
      fallback: Object.freeze({ ...config.qualification.fallback }),
      cyrinx: Object.freeze({ ...config.qualification.cyrinx }),
    }),
  });
}
function sha256(body: Buffer): string { return createHash('sha256').update(body).digest('hex'); }
function hasForbiddenAuthority(value: unknown): boolean {
  const forbidden = new Set(['machineId', 'role', 'reportTarget', 'report', 'tunEvidence', 'tunEvidenceSource', 'evidenceMode', 'evidenceClass', 'hostIdentity', 'buildCommit', 'codec', 'qualification', 'deadLinkTimeoutMs', 'cyrinxDeadlineMs', 'deadline', 'fallback', 'stage', 'terminal', 'instruction']);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasForbiddenAuthority);
  return Object.entries(value).some(([key, child]) => forbidden.has(key) || hasForbiddenAuthority(child));
}
function parseJsonPayload(frame: FwavFrame): Record<string, unknown> {
  if (frame.payload.length > 16 * 1024) fail('control_payload_too_large');
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

function hasPacketBulk(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasPacketBulk);
  return Object.entries(value).some(([key, child]) => ['packet', 'packets', 'base64', 'binary', 'payload', 'frame'].includes(key.toLowerCase()) || hasPacketBulk(child));
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
interface PendingBrowserAdmission { entry: QueueEntry; owner: WebSocket; attempts: number; retryTimer: ReturnType<typeof setTimeout> | undefined; }
interface BrowserConnectionState {
  mustResetBeforeUse: boolean;
  errorOrigins: Map<bigint, 'cyrinx' | 'quiet' | 'other'>;
  preemptedControls: Set<bigint>;
  receivedEpoch: number;
  highestReceivedSequence: bigint;
  acousticCapability: Buffer;
  acousticCapabilityUsed: boolean;
}
type PacketDirection = 'browser-to-fips' | 'fips-to-browser';
const DEFAULT_PACKET_QUEUE_LIMITS: PacketQueueLimits = Object.freeze({ maxItems: 32, maxBytes: MAX_MESSAGE_BYTES, maxAgeMs: MAX_QUEUE_AGE_MS });
function packetLimits(input: BridgeServerOptions['packetQueueLimits']): PacketQueueLimits {
  const limits = { ...DEFAULT_PACKET_QUEUE_LIMITS, ...input };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0 || (name === 'maxBytes' && value > MAX_MESSAGE_BYTES) || (name === 'maxAgeMs' && value > 600_000)) fail(`packet_queue_${name}_invalid`);
  }
  return limits;
}
function safeBridgeError(error: unknown): { code: string; message: string } {
  const candidate = error instanceof BridgeInputError ? error.reasonCode : 'invalid_fwav_message';
  const code = /^[a-z0-9_]{1,80}$/.test(candidate) ? candidate : 'invalid_fwav_message';
  return { code, message: `Bridge rejected ${code}.`.slice(0, 240) };
}
function queueName(type: MessageType): string { return MessageType[type]; }
function packetQueueName(direction: PacketDirection): 'FIPS_PACKET_TO_FIPS' | 'FIPS_PACKET_TO_BROWSER' {
  return direction === 'browser-to-fips' ? 'FIPS_PACKET_TO_FIPS' : 'FIPS_PACKET_TO_BROWSER';
}
function acoustic(type: MessageType): boolean { return type === MessageType.PCM_CAPTURE || type === MessageType.PCM_PLAYBACK; }
function p95(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
}

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServer> {
  if (options.host !== LOOPBACK_HOST && options.host !== '0.0.0.0') fail('bridge host must be 127.0.0.1 or 0.0.0.0');
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
    if (url.pathname === '/image-transfer') {
      void (async () => {
        const address = server.address();
        if (url.search || !address || typeof address === 'string' || request.headers.host !== `${LOOPBACK_HOST}:${address.port}`) { response.writeHead(403).end(); return; }
        const transfer = options.imageTransfer;
        if (!transfer) { response.writeHead(503).end(); return; }
        if (request.method === 'GET') {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          response.end(JSON.stringify(transfer.status()));
          return;
        }
        if (request.method !== 'POST' || transfer.role !== 'A' || request.headers['content-type'] !== 'application/octet-stream') { response.writeHead(transfer.role === 'B' ? 403 : 405).end(); return; }
        if (!isSameOriginLoopback(request.headers.origin, address.port)) { response.writeHead(403).end(); return; }
        const proof = options.proofController;
        const peerStatus = proof?.role === 'A' ? await proof.peerStatus() : undefined;
        if (!peerStatus || typeof peerStatus !== 'object' || (peerStatus as { peerReady?: unknown }).peerReady !== true) {
          response.writeHead(409, { 'cache-control': 'no-store' }).end();
          return;
        }
        const chunks: Buffer[] = []; let size = 0;
        request.on('data', (chunk: Buffer) => { size += chunk.byteLength; if (size <= 4 + 96 * 96 * 4) chunks.push(Buffer.from(chunk)); });
        await new Promise<void>((resolve) => request.once('end', resolve));
        const body = Buffer.concat(chunks);
        if (size !== body.byteLength || body.byteLength < 8) { response.writeHead(400).end(); return; }
        const width = body.readUInt16LE(0); const height = body.readUInt16LE(2);
        if (body.readUInt32LE(4) !== 0) { response.writeHead(400).end(); return; }
        try {
          const result = await transfer.send(width, height, body.subarray(8));
          response.writeHead(202, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          response.end(JSON.stringify(result));
        } catch { response.writeHead(400).end(); }
      })().catch(() => { if (!response.headersSent) response.writeHead(503); response.end(); });
      return;
    }
    if (url.pathname === '/peer-status' || url.pathname === '/proof-status' || url.pathname === '/proof-ping') {
      void (async () => {
        const address = server.address();
        if (url.search || !address || typeof address === 'string' || request.headers.host !== `${LOOPBACK_HOST}:${address.port}`) { response.writeHead(403).end(); return; }
        const proof = options.proofController;
        if (!proof) {
          const unavailable = url.pathname === '/peer-status'
            ? { peerReady: false, reason: 'peer_missing' }
            : { state: 'loading', pingReady: false, reason: 'proof_unavailable', result: null };
          response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(unavailable));
          return;
        }
        if (url.pathname === '/peer-status' || url.pathname === '/proof-status') {
          if (request.method !== 'GET') { response.writeHead(405).end(); return; }
          const projection = url.pathname === '/peer-status' ? await proof.peerStatus() : await proof.status();
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(projection)); return;
        }
        if (request.method !== 'POST' || proof.role !== 'A' || request.headers['content-type'] !== 'application/json') { response.writeHead(proof.role === 'B' ? 403 : 405).end(); return; }
        if (!isSameOriginLoopback(request.headers.origin, address.port)) { response.writeHead(403).end(); return; }
        const chunks: Buffer[] = []; let size = 0;
        request.on('data', (chunk: Buffer) => { size += chunk.byteLength; if (size <= 256) chunks.push(Buffer.from(chunk)); });
        await new Promise<void>((resolve) => request.once('end', resolve));
        if (size > 256 || Buffer.concat(chunks).toString('utf8') !== '{}') { response.writeHead(400).end(); return; }
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(await proof.ping()));
      })().catch(() => { if (!response.headersSent) response.writeHead(503); response.end(); });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    if (url.pathname === '/qualification-config' && config) { response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(config)); return; }
    if (url.pathname === '/bridge-status' && !url.search) { response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(safeStatus())); return; }
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
  const clients = new Set<WebSocket>(); const queues = new Map<MessageType, Queue>(); const packetQueues = new Map<PacketDirection, Queue>();
  const packetQueueLimits = packetLimits(options.packetQueueLimits);
  const state: BridgeState & PacketBridgeState = {
    epoch: 1, rejectedFrames: 0, overflowedQueues: [], discontinuities: 0, queueCounts: {}, stampedResults: [],
    packetCounters: { browserToFips: 0, fipsToBrowser: 0 },
    packetQueues: {
      browserToFips: { ...packetQueueLimits, items: 0, bytes: 0, health: 'not-connected' },
      fipsToBrowser: { ...packetQueueLimits, items: 0, bytes: 0, health: 'not-connected' },
    },
    packetReadiness: { browser: false, fips: false },
    packetEndpoints: { browser: 'not-connected', fips: 'not-connected', worker: 'waiting' }, lastAcceptedAtMs: null, lastError: null,
    evidenceClass: 'Loopback', acousticReady: false, peerConnected: false, pingReady: false,
  };
  let audio: BrowserAudio | undefined; let generation = 1; let writeTail: Promise<unknown> = Promise.resolve();
  let results = new Map<string, BrowserResult>(); let failureReasons = new Set<string>(); let localAudioPreflight = false;
  let owner: WebSocket | undefined; let fipsOwner: WebSocket | undefined; let epochClaimed = false; let reconnectAllowed = false; let reconnectRequiresReset = false;
  let ownerConnection: BrowserConnectionState | undefined;
  let pendingBrowserAdmission: PendingBrowserAdmission | undefined;
  let acousticReadinessProof: Buffer | undefined;
  let operationGeneration = 1; let operationAbort = new AbortController(); let settleAbort: AbortController | undefined; let shuttingDown = false;
  let cyrinxExpiryTimer: unknown;
  const sequenceTrackers = new Set<{ value: bigint }>();
  options.cyrinxTransport?.beginReceive(state.epoch);
  const browserConnections = new Set<BrowserConnectionState>();
  const safeStatus = () => {
    const queue = state.packetQueues.browserToFips;
    const reverseQueue = state.packetQueues.fipsToBrowser;
    const queueHealth = [queue.health, reverseQueue.health].includes('overflow')
      ? 'overflow'
      : [queue.health, reverseQueue.health].includes('rejected')
        ? 'rejected'
        : queue.health === 'ready' || reverseQueue.health === 'ready'
          ? 'clear'
          : 'unknown';
    return {
      // A listener without the runner-owned configuration has no demo role or
      // IPv6 MTU authority. Keep that absence explicit for the browser rather
      // than projecting plausible defaults.
      role: config?.role ?? 'Unknown', configuration: config ? 'ready' : 'unknown',
      browserAudio: localAudioPreflight ? 'armed' : 'not-armed',
      localBridge: state.packetEndpoints.browser === 'ready' ? 'ready' : 'disconnected',
      soundTransport: state.packetEndpoints.fips === 'ready' ? 'started' : 'waiting',
      epoch: state.epoch, queueHealth,
      queueItems: queue.items + reverseQueue.items, queueBytes: queue.bytes + reverseQueue.bytes,
      txPackets: state.packetCounters.browserToFips, rxPackets: state.packetCounters.fipsToBrowser,
      soundMtu: config ? 1357 : null,
      lastEventAt: new Date(state.lastAcceptedAtMs ?? 0).toISOString(),
      lastError: state.lastError?.message ?? null,
    };
  };
  for (const type of [MessageType.PCM_CAPTURE, MessageType.PCM_PLAYBACK, MessageType.QUALIFICATION_CASE, MessageType.QUALIFICATION_RESULT, MessageType.ERROR, MessageType.RESET]) queues.set(type, { frames: [], bytes: 0, overflowed: false });
  for (const direction of ['browser-to-fips', 'fips-to-browser'] as const) packetQueues.set(direction, { frames: [], bytes: 0, overflowed: false });
  const refreshState = () => {
    for (const [type, queue] of queues) state.queueCounts[queueName(type)] = queue.frames.length;
    for (const [direction, queue] of packetQueues) {
      state.queueCounts[packetQueueName(direction)] = queue.frames.length;
      const target = direction === 'browser-to-fips' ? state.packetQueues.browserToFips : state.packetQueues.fipsToBrowser;
      target.items = queue.frames.length;
      target.bytes = queue.bytes;
    }
  };
  const clearPendingBrowserAdmission = (): void => {
    if (pendingBrowserAdmission?.retryTimer) clearTimeout(pendingBrowserAdmission.retryTimer);
    pendingBrowserAdmission = undefined;
  };
  const clearQueues = () => { clearPendingBrowserAdmission(); for (const queue of [...queues.values(), ...packetQueues.values()]) { queue.frames = []; queue.bytes = 0; queue.overflowed = false; } refreshState(); };
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
  const enqueuePacket = (direction: PacketDirection, frame: FwavFrame): void => {
    const queue = packetQueues.get(direction)!;
    const now = options.now?.() ?? Date.now();
    while (queue.frames.length && now - queue.frames[0]!.enqueuedAt > packetQueueLimits.maxAgeMs) {
      const expired = queue.frames.shift()!; queue.bytes -= expired.frame.payload.byteLength + HEADER_BYTES;
      if (pendingBrowserAdmission?.entry === expired) clearPendingBrowserAdmission();
      state.lastError = safeBridgeError(new BridgeInputError('fips_packet_queue_expired'));
    }
    const frameBytes = frame.payload.byteLength + HEADER_BYTES;
    if (queue.frames.length >= packetQueueLimits.maxItems || queue.bytes + frameBytes > packetQueueLimits.maxBytes) {
      queue.overflowed = true;
      state.overflowedQueues = [...new Set([...state.overflowedQueues, packetQueueName(direction)])];
      (direction === 'browser-to-fips' ? state.packetQueues.browserToFips : state.packetQueues.fipsToBrowser).health = 'overflow';
      fail('fips_packet_queue_overflow');
    }
    (direction === 'browser-to-fips' ? state.packetQueues.browserToFips : state.packetQueues.fipsToBrowser).health = 'waiting';
    queue.frames.push({ frame, enqueuedAt: now }); queue.bytes += frameBytes; refreshState();
  };
  const flushPacketQueue = (direction: PacketDirection): void => {
    const target = direction === 'browser-to-fips' ? fipsOwner : owner;
    if (!target || target.readyState !== target.OPEN) return;
    if (direction === 'fips-to-browser' && ownerConnection?.mustResetBeforeUse) return;
    const queue = packetQueues.get(direction)!;
    if (direction === 'fips-to-browser') {
      if (pendingBrowserAdmission) return;
      const entry = queue.frames[0];
      if (!entry) { refreshState(); return; }
      const acceptedGeneration = generation;
      const acceptedEpoch = state.epoch;
      try {
        target.send(encodeFrame(entry.frame));
      } catch {
        state.lastError = safeBridgeError(new BridgeInputError('browser_destination_unavailable'));
        state.packetQueues.fipsToBrowser.health = 'rejected';
        refreshState();
        return;
      }
      if (acceptedGeneration !== generation || acceptedEpoch !== state.epoch || owner !== target) return;
      pendingBrowserAdmission = { entry, owner: target, attempts: 1, retryTimer: undefined };
      state.packetQueues.fipsToBrowser.health = 'waiting';
      refreshState();
      return;
    }
    while (queue.frames.length) {
      const entry = queue.frames.shift()!;
      queue.bytes -= entry.frame.payload.byteLength + HEADER_BYTES;
      const acceptedGeneration = generation;
      const acceptedEpoch = state.epoch;
      try {
        target.send(encodeFrame(entry.frame));
      } catch {
        // A bridge delivery failure is terminal for this packet. Retaining it
        // would replay stale FIPS traffic when an endpoint reconnects.
        state.lastError = safeBridgeError(new BridgeInputError('fips_destination_unavailable'));
        (direction === 'browser-to-fips' ? state.packetQueues.browserToFips : state.packetQueues.fipsToBrowser).health = 'rejected';
        refreshState();
        return;
      }
      if (acceptedGeneration !== generation || acceptedEpoch !== state.epoch) return;
      if (direction === 'browser-to-fips') state.packetCounters.browserToFips += 1;
      else state.packetCounters.fipsToBrowser += 1;
      state.lastAcceptedAtMs = options.now?.() ?? Date.now();
      (direction === 'browser-to-fips' ? state.packetQueues.browserToFips : state.packetQueues.fipsToBrowser).health = 'ready';
    }
    refreshState();
  };
  const retryBrowserAdmission = (): void => {
    const pending = pendingBrowserAdmission;
    if (!pending || pending.owner !== owner || pending.entry.frame.epoch !== state.epoch) return;
    pending.retryTimer = undefined;
    if (pending.owner.readyState !== pending.owner.OPEN) return;
    try {
      pending.owner.send(encodeFrame(pending.entry.frame));
    } catch {
      state.lastError = safeBridgeError(new BridgeInputError('browser_destination_unavailable'));
      state.packetQueues.fipsToBrowser.health = 'rejected';
      refreshState();
    }
  };
  const notifyFipsPacketAdmission = (packet: FwavFrame, result: number): void => {
    if (!fipsOwner || fipsOwner.readyState !== fipsOwner.OPEN) return;
    try {
      fipsOwner.send(encodeFrame({
        type: MessageType.FIPS_PACKET_ADMISSION,
        epoch: packet.epoch,
        sequence: packet.sequence,
        payload: Buffer.of(result),
      }));
    } catch {
      state.lastError = safeBridgeError(new BridgeInputError('fips_destination_unavailable'));
    }
  };
  const acceptBrowserAdmission = (socket: WebSocket, frame: FwavFrame): void => {
    const pending = pendingBrowserAdmission;
    // Admission responses can arrive after a slow acoustic queue has expired
    // or advanced its former head. Such a response has no authority once its
    // exact pending entry is gone, so ignoring it is both safe and recoverable;
    // disconnecting the browser here stranded the other node mid-session.
    if (!pending || pending.owner !== socket || owner !== socket || frame.epoch !== state.epoch) return;
    if (frame.sequence !== pending.entry.frame.sequence) {
      if (frame.sequence < pending.entry.frame.sequence) return;
      fail('fips_packet_admission_stale_or_unowned');
    }
    const result = decodeFipsPacketAdmission(frame.payload);
    if (result === FIPS_PACKET_ADMISSION_ACCEPTED) {
      const queue = packetQueues.get('fips-to-browser')!;
      if (queue.frames[0] !== pending.entry) {
        clearPendingBrowserAdmission();
        refreshState();
        flushPacketQueue('fips-to-browser');
        return;
      }
      queue.frames.shift(); queue.bytes -= pending.entry.frame.payload.byteLength + HEADER_BYTES;
      clearPendingBrowserAdmission();
      state.packetCounters.fipsToBrowser += 1;
      notifyFipsPacketAdmission(pending.entry.frame, result);
      state.lastAcceptedAtMs = options.now?.() ?? Date.now();
      state.packetQueues.fipsToBrowser.health = queue.frames.length ? 'waiting' : 'ready';
      refreshState();
      flushPacketQueue('fips-to-browser');
      return;
    }
    if (result !== FIPS_PACKET_ADMISSION_QUEUE_FULL) fail('fips_packet_admission_result_invalid');
    // Queue-full is backpressure, not packet failure. The browser owns a
    // deliberately small acoustic queue while FIPS may produce a short burst
    // after authentication. Retain the exact head frame and retry it until its
    // bounded packet-queue age expires instead of dropping it after 150 ms.
    if (pending.attempts === 1) notifyFipsPacketAdmission(pending.entry.frame, result);
    const now = options.now?.() ?? Date.now();
    if (now - pending.entry.enqueuedAt > packetQueueLimits.maxAgeMs) {
      const queue = packetQueues.get('fips-to-browser')!;
      if (queue.frames[0] !== pending.entry) fail('fips_packet_admission_queue_mismatch');
      queue.frames.shift(); queue.bytes -= pending.entry.frame.payload.byteLength + HEADER_BYTES;
      clearPendingBrowserAdmission();
      state.packetQueues.fipsToBrowser.health = 'rejected';
      state.lastError = safeBridgeError(new BridgeInputError('fips_packet_queue_expired'));
      refreshState();
      flushPacketQueue('fips-to-browser');
      return;
    }
    pending.attempts += 1;
    pending.retryTimer = setTimeout(retryBrowserAdmission, 250);
    state.packetQueues.fipsToBrowser.health = 'waiting';
    refreshState();
  };
  const packetDestinationReady = (direction: PacketDirection): boolean => {
    const target = direction === 'browser-to-fips' ? fipsOwner : owner;
    return Boolean(target && target.readyState === target.OPEN);
  };
  const notifyFipsBrowserState = (armed: boolean): void => {
    if (!fipsOwner || fipsOwner.readyState !== fipsOwner.OPEN) return;
    const payload = armed
      ? acousticReadinessProof
      : acousticReadinessProof?.subarray(acousticReadinessProof.byteLength - ACOUSTIC_DISARM_CAPABILITY_BYTES);
    if (!payload) return;
    fipsOwner.send(encodeFrame({
      type: armed ? MessageType.BROWSER_ARM : MessageType.BROWSER_DISARM,
      epoch: state.epoch,
      sequence: 0n,
      payload: Buffer.from(payload),
    }));
  };
  const issueAcousticCapability = (socket: WebSocket, connection: BrowserConnectionState): void => {
    connection.acousticCapability = randomBytes(ACOUSTIC_DISARM_CAPABILITY_BYTES);
    connection.acousticCapabilityUsed = false;
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ kind: 'acoustic-capability', epoch: state.epoch, capability: connection.acousticCapability.toString('hex') }));
  };
  const disarmAcousticSession = (): void => {
    if (!state.acousticReady) return;
    state.acousticReady = false;
    notifyFipsBrowserState(false);
    acousticReadinessProof = undefined;
    state.packetReadiness = { browser: false, fips: false };
    clearQueues();
  };
  const rejectSocket = (socket: WebSocket, error: unknown): void => {
    const safe = safeBridgeError(error);
    state.rejectedFrames += 1;
    state.lastError = safe;
    socket.close(1008, safe.code);
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
  const abortCyrinxOperation = (): void => {
    operationGeneration += 1;
    operationAbort.abort();
    operationAbort = new AbortController();
    settleAbort?.abort();
    settleAbort = undefined;
    options.cyrinxWorker?.reset();
  };
  const waitForCyrinxOperation = async <T>(
    work: Promise<T>,
    acceptedOperation: number,
    signal: AbortSignal,
  ): Promise<{ aborted: true } | { aborted: false; value: T }> => {
    if (acceptedOperation !== operationGeneration || signal.aborted) return { aborted: true };
    let abort!: () => void;
    const cancelled = new Promise<{ aborted: true }>((resolve) => {
      abort = () => resolve({ aborted: true });
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([
        work.then((value) => ({ aborted: false as const, value })),
        cancelled,
      ]);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  };
  const waitForCyrinxSettle = async (delayMs: number): Promise<boolean> => {
    if (delayMs <= 0) return true;
    const controller = new AbortController();
    settleAbort?.abort();
    settleAbort = controller;
    const aborted = new Promise<false>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve(false), { once: true });
    });
    const settleWork = options.cyrinxSettle
      ? options.cyrinxSettle(delayMs)
      : new Promise<void>((resolve) => {
          const handle = setTimeout(resolve, delayMs);
          controller.signal.addEventListener('abort', () => clearTimeout(handle), { once: true });
        });
    const settled = settleWork
      .then(() => true as const);
    try {
      return await Promise.race([settled, aborted]);
    } finally {
      if (settleAbort === controller) settleAbort = undefined;
    }
  };
  const settleExpiry = (nowMs = clock()): boolean => {
    if (!cyrinxSession || !cyrinxSession.expire(nowMs)) return false;
    generation += 1;
    abortCyrinxOperation();
    clearCyrinxTimer();
    failureReasons.add('cyrinx_deadline_expired');
    return true;
  };
  const sessionSnapshot = (nowMs = clock()): CyrinxSessionSnapshot | undefined =>
    cyrinxSession?.snapshot(state.epoch, nowMs);
  const reportAuthority = (nowMs: number): {
    codec: MachineReport['codec'];
    qualification: NonNullable<MachineReport['qualification']>;
    snapshot?: CyrinxSessionSnapshot;
  } | undefined => {
    if (!config) return undefined;
    const snapshot = sessionSnapshot(nowMs);
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
        cyrinx: { stage: snapshot.stage, coldReceivePassed: Boolean(cyrinxSession?.coldReceivePassed) },
      },
      snapshot,
    };
  };
  const buildReport = (nowMs: number): MachineReport | undefined => {
    if (!config || !options.reportAuthority || !expectedDirection) return undefined;
    const authority = reportAuthority(nowMs);
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
    const canonicalColdCase = expectedCorpus[0];
    const coldReceivePassed = authority.snapshot?.codec === 'cyrinx'
      ? Boolean(cyrinxSession?.coldReceivePassed)
      : Boolean(canonicalColdCase && good.some((value) => value.caseId === canonicalColdCase.id && value.coldAcquired));
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
  const persist = (expectedGeneration?: number): Promise<string | undefined> => {
    const nowMs = clock();
    const expiredDuringPersist = settleExpiry(nowMs);
    const reportGeneration = expiredDuringPersist ? generation : expectedGeneration ?? generation;
    const snapshot = buildReport(nowMs);
    if (!snapshot || !config) {
      if (expiredDuringPersist) queueMicrotask(() => broadcastSession());
      return Promise.resolve(undefined);
    }
    const writer = options.reportWriter ?? writeMachineReport;
    const task = writeTail.then(async () => {
      if (reportGeneration !== generation) return undefined;
      const reportPath = await writer(config.reportTarget, snapshot);
      if (expiredDuringPersist && reportGeneration === generation) broadcastSession();
      return reportPath;
    });
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
  const transitionCurrentFallback = (alreadyPreempted = false): boolean => {
    if (!cyrinxSession || cyrinxSession.codec !== 'cyrinx') return false;
    const changed = cyrinxSession.failCurrent(clock());
    if (!changed) return false;
    generation += 1;
    if (!alreadyPreempted) abortCyrinxOperation();
    clearCyrinxTimer();
    if (cyrinxSession.fallbackReason) failureReasons.add(cyrinxSession.fallbackReason);
    return true;
  };
  const activateCurrentFallback = async (alreadyPreempted = false): Promise<boolean> => {
    if (!transitionCurrentFallback(alreadyPreempted)) return false;
    await persist(generation);
    broadcastSession();
    return true;
  };
  const expireCyrinxAt = async (nowMs: number): Promise<boolean> => {
    if (!settleExpiry(nowMs)) return false;
    await persist(generation);
    broadcastSession();
    return true;
  };
  const expireCyrinx = async (): Promise<boolean> => expireCyrinxAt(clock());
  const forceExpireCyrinx = async (): Promise<boolean> => {
    if (!cyrinxSession || !cyrinxSession.forceDeadlineExpiry(clock())) return false;
    generation += 1;
    abortCyrinxOperation();
    clearCyrinxTimer();
    failureReasons.add('cyrinx_deadline_expired');
    await persist(generation);
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
  const reset = async (alreadyPreempted = false): Promise<number> => {
    if (state.epoch >= 0xffff_ffff) fail('epoch_exhausted');
    disarmAcousticSession();
    if (cyrinxSession?.operatorReset(clock()) && cyrinxSession.fallbackReason) {
      failureReasons.add(cyrinxSession.fallbackReason);
    }
    clearCyrinxTimer();
    if (!alreadyPreempted) abortCyrinxOperation();
    options.cyrinxTransport?.reset();
    generation += 1; state.epoch += 1; audio = undefined; results = new Map(); failureReasons = new Set(cyrinxSession?.fallbackReason ? [cyrinxSession.fallbackReason] : []);
    options.cyrinxTransport?.beginReceive(state.epoch);
    state.stampedResults = []; state.overflowedQueues = []; state.discontinuities = 0; state.rejectedFrames = 0;
    state.packetCounters = { browserToFips: 0, fipsToBrowser: 0 }; state.packetReadiness = { browser: false, fips: false }; state.lastError = null; localAudioPreflight = false; state.acousticReady = false;
    state.lastAcceptedAtMs = null;
    state.packetQueues.browserToFips.health = 'not-connected'; state.packetQueues.fipsToBrowser.health = 'not-connected';
    for (const tracker of sequenceTrackers) tracker.value = -1n;
    for (const connection of browserConnections) {
      connection.mustResetBeforeUse = false; connection.receivedEpoch = state.epoch; connection.highestReceivedSequence = -1n;
      connection.errorOrigins.clear(); connection.preemptedControls.clear();
    }
    clearQueues(); reconnectAllowed = true; reconnectRequiresReset = false;
    await persist(generation);
    const browserResetAck = encodeFrame({ type: MessageType.RESET, flags: RESET_ACK_FLAG, epoch: state.epoch, sequence: 0n, payload: Buffer.alloc(0) });
    const fipsWorkerReset = encodeFrame({ type: MessageType.RESET, epoch: state.epoch, sequence: 0n, payload: Buffer.alloc(0) });
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(client === fipsOwner ? fipsWorkerReset : browserResetAck);
    }
    broadcastSession();
    return state.epoch;
  };
  const startCyrinx = async (): Promise<{ codec: 'cyrinx' | 'quiet'; reasonCode: string | null; deadlineAtMs: number }> => {
    if (!cyrinxSession || !config) fail('cyrinx authority is unavailable');
    if (!cyrinxSession.start(clock())) {
      await expireCyrinx();
      return cyrinxSummary();
    }
    const acceptedOperation = operationGeneration;
    const signal = operationAbort.signal;
    cyrinxExpiryTimer = timer.set(() => { void forceExpireCyrinx().catch(() => undefined); }, CYRINX_DEADLINE_MS);
    await persist();
    if (acceptedOperation !== operationGeneration || signal.aborted || cyrinxSession.codec !== 'cyrinx') return cyrinxSummary();
    const startedPersistedAt = clock();
    if (await expireCyrinxAt(startedPersistedAt)) return cyrinxSummary();
    if (acceptedOperation !== operationGeneration || signal.aborted || cyrinxSession.codec !== 'cyrinx') return cyrinxSummary();
    broadcastSession();
    try {
      const build = await waitForCyrinxOperation(
        options.cyrinxBuild?.({ signal }) ?? Promise.resolve(),
        acceptedOperation,
        signal,
      );
      if (build.aborted || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return cyrinxSummary();
      const buildCompletedAt = clock();
      if (await expireCyrinxAt(buildCompletedAt)) return cyrinxSummary();
      cyrinxSession.completeBuild(buildCompletedAt);
      await persist();
      if (acceptedOperation !== operationGeneration || signal.aborted || cyrinxSession.codec !== 'cyrinx') return cyrinxSummary();
      const buildPersistedAt = clock();
      if (await expireCyrinxAt(buildPersistedAt)) return cyrinxSummary();
      if (acceptedOperation !== operationGeneration || signal.aborted || cyrinxSession.codec !== 'cyrinx') return cyrinxSummary();
      broadcastSession();
      const digital = await waitForCyrinxOperation(
        options.cyrinxDigital?.({ epoch: state.epoch, evidenceClass: config.evidenceClass, nowMs: clock(), signal }) ?? Promise.resolve(),
        acceptedOperation,
        signal,
      );
      if (digital.aborted || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return cyrinxSummary();
      const digitalCompletedAt = clock();
      if (await expireCyrinxAt(digitalCompletedAt)) return cyrinxSummary();
      cyrinxSession.completeDigital(digitalCompletedAt);
      await persist();
      if (acceptedOperation !== operationGeneration || signal.aborted || cyrinxSession.codec !== 'cyrinx') return cyrinxSummary();
      const digitalPersistedAt = clock();
      if (await expireCyrinxAt(digitalPersistedAt)) return cyrinxSummary();
      if (acceptedOperation !== operationGeneration || signal.aborted || cyrinxSession.codec !== 'cyrinx') return cyrinxSummary();
      broadcastSession();
    } catch {
      if (acceptedOperation === operationGeneration && !signal.aborted && cyrinxSession.codec === 'cyrinx') await activateCurrentFallback();
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
    const acceptedAt = clock();
    if (await expireCyrinxAt(acceptedAt)) return;
    const request = instructionRequest(payload, 'accept_cyrinx_instruction');
    const accepted = cyrinxSession.acceptInstruction(request.caseId, request.direction, acceptedAt);
    const acceptedGeneration = generation;
    const acceptedOperation = operationGeneration;
    try {
      const playback = await options.cyrinxWorker.begin(accepted.value, state.epoch, accepted.mode);
      if (acceptedGeneration !== generation || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return;
      if (await expireCyrinx()) return;
      if (acceptedGeneration !== generation || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return;
      if (accepted.mode === 'transmit') {
        if (!playback) throw new Error('cyrinx_transmit_playback_missing');
        forwardPlayback(playback);
      } else if (playback !== undefined) {
        throw new Error('cyrinx_listener_created_playback');
      }
    } catch {
      if (acceptedGeneration === generation && acceptedOperation === operationGeneration && cyrinxSession.codec === 'cyrinx') await activateCurrentFallback();
    }
  };
  const completeCyrinxPlayback = async (payload: Record<string, unknown>): Promise<void> => {
    if (!cyrinxSession || cyrinxSession.codec !== 'cyrinx') fail('cyrinx_instruction_unavailable');
    const request = instructionRequest(payload, 'playback_complete');
    const current = cyrinxSession.currentCase();
    if (!current || current.id !== request.caseId || current.direction !== request.direction) fail('qualification_instruction_mismatch');
    const acceptedGeneration = generation;
    const acceptedOperation = operationGeneration;
    try {
      const remaining = cyrinxSession.caseSettleRemaining('transmit', clock());
      if (!await waitForCyrinxSettle(remaining)) return;
    } catch {
      if (acceptedGeneration === generation && acceptedOperation === operationGeneration && cyrinxSession.codec === 'cyrinx') await activateCurrentFallback();
      return;
    }
    if (acceptedGeneration !== generation || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return;
    const completedAt = clock();
    if (await expireCyrinxAt(completedAt)) return;
    if (acceptedGeneration !== generation || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return;
    cyrinxSession.completeAccepted('transmit', completedAt);
    await persist(acceptedGeneration);
    if (acceptedGeneration !== generation || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return;
    const acknowledgedAt = clock();
    if (await expireCyrinxAt(acknowledgedAt)) return;
    if (acceptedGeneration !== generation || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return;
    cyrinxSession.acknowledgeAcceptedCompletion();
    if (cyrinxSession.terminal) clearCyrinxTimer();
    broadcastSession();
  };
  const acceptCyrinxCapture = async (socket: WebSocket, encoded: Buffer): Promise<void> => {
    if (!cyrinxSession || cyrinxSession.codec !== 'cyrinx') return;
    if (await expireCyrinx() || !cyrinxSession.canReceiveCapture() || !options.cyrinxWorker) return;
    const acceptedGeneration = generation;
    const acceptedOperation = operationGeneration;
    let nativeResult: CyrinxResult | undefined;
    try {
      nativeResult = await options.cyrinxWorker.receiveCapture(encoded);
    } catch {
      if (acceptedGeneration === generation && acceptedOperation === operationGeneration && cyrinxSession.codec === 'cyrinx') await activateCurrentFallback();
      return;
    }
    if (!nativeResult || acceptedGeneration !== generation || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return;
    if (await expireCyrinx()) return;
    if (acceptedGeneration !== generation || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return;
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
    try {
      const remaining = cyrinxSession.caseSettleRemaining('listen', clock());
      if (!await waitForCyrinxSettle(remaining)) return;
    } catch {
      if (acceptedGeneration === generation && acceptedOperation === operationGeneration && cyrinxSession.codec === 'cyrinx') await activateCurrentFallback();
      return;
    }
    if (acceptedGeneration !== generation || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return;
    const completedAt = clock();
    if (await expireCyrinxAt(completedAt)) return;
    if (acceptedGeneration !== generation || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return;
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
    cyrinxSession.completeAccepted('listen', completedAt);
    await persist(acceptedGeneration);
    if (acceptedGeneration !== generation || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return;
    const acknowledgedAt = clock();
    if (await expireCyrinxAt(acknowledgedAt)) return;
    if (acceptedGeneration !== generation || acceptedOperation !== operationGeneration || cyrinxSession.codec !== 'cyrinx') return;
    cyrinxSession.acknowledgeAcceptedCompletion();
    if (cyrinxSession.terminal) clearCyrinxTimer();
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ kind: 'cyrinx-result', epoch: state.epoch, caseId: current.id, direction: current.direction, accepted: true, cold }));
    broadcastSession();
  };
  const preemptUrgentControl = (
    rawData: RawData,
    isBinary: boolean,
    connection: BrowserConnectionState,
  ): void => {
    if (!isBinary) return;
    try {
      const urgent = decodeFrame(asBuffer(rawData));
      if (urgent.epoch !== state.epoch) return;
      if (connection.receivedEpoch !== urgent.epoch) {
        connection.receivedEpoch = urgent.epoch;
        connection.highestReceivedSequence = -1n;
      }
      if (urgent.sequence <= connection.highestReceivedSequence) return;
      connection.highestReceivedSequence = urgent.sequence;
      if (urgent.type !== MessageType.RESET && urgent.type !== MessageType.ERROR) return;
      if (urgent.type === MessageType.RESET) {
        if (urgent.payload.length !== 0 || urgent.flags !== 0) return;
        if (cyrinxSession?.codec === 'cyrinx') {
          connection.preemptedControls.add(urgent.sequence);
          abortCyrinxOperation();
          transitionCurrentFallback(true);
        }
        return;
      }
      const payload = parseJsonPayload(urgent);
      if (hasForbiddenAuthority(payload)) return;
      const origin = cyrinxSession?.codec === 'cyrinx'
        ? 'cyrinx'
        : cyrinxSession?.codec === 'quiet'
          ? 'quiet'
          : 'other';
      connection.errorOrigins.set(urgent.sequence, origin);
      if (origin === 'cyrinx') {
        connection.preemptedControls.add(urgent.sequence);
        abortCyrinxOperation();
        void activateCurrentFallback(true).catch(() => undefined);
      }
    } catch {
      // Unsafe or malformed urgent controls remain in the serialized path,
      // where normal validation rejects them without interrupting native work.
    }
  };
  const handleFrame = async (
    socket: WebSocket,
    rawData: RawData,
    isBinary: boolean,
    lastSequence: { value: bigint },
    connection: BrowserConnectionState,
  ): Promise<void> => {
    try {
      if (!isBinary) fail('binary_frames_required');
      const encoded = asBuffer(rawData);
      const frame = decodeFrame(encoded);
      const acousticControl = frame.type === MessageType.ACOUSTIC_READY || frame.type === MessageType.ACOUSTIC_DISARM;
      if (frame.epoch !== state.epoch) fail('stale_or_duplicate_frame');
      if (connection.mustResetBeforeUse && frame.type !== MessageType.RESET) fail('recovery_reset_required');
      if (frame.type === MessageType.FIPS_PACKET_ADMISSION) {
        acceptBrowserAdmission(socket, frame);
        return;
      }
      if (acousticControl) {
        if (frame.sequence !== 0n || frame.flags !== 0) fail('acoustic_control_invalid');
        if (frame.type === MessageType.ACOUSTIC_READY) {
          const proof = decodeAcousticReadinessProof(frame.payload);
          // Capability delivery and the session-ready callback can race in the
          // browser. A replay for the accepted session/settings/capability is
          // idempotent even if its heartbeat timestamp advanced; a different
          // authority tuple still has to present a fresh capability below.
          if (
            state.acousticReady
            && acousticReadinessProof
            && timingSafeEqual(frame.payload.subarray(0, 40), acousticReadinessProof.subarray(0, 40))
            && timingSafeEqual(frame.payload.subarray(48), acousticReadinessProof.subarray(48))
          ) return;
          const nowMs = BigInt(clock());
          const fresh = proof.heartbeatAtMs <= nowMs && nowMs - proof.heartbeatAtMs <= BigInt(ACOUSTIC_READINESS_FRESHNESS_MS);
          if (!fresh || connection.acousticCapabilityUsed || !timingSafeEqual(proof.capability, connection.acousticCapability)) fail('acoustic_readiness_proof_invalid');
          if (!state.acousticReady) {
            connection.acousticCapabilityUsed = true;
            acousticReadinessProof = Buffer.from(frame.payload);
            state.acousticReady = true;
            notifyFipsBrowserState(true);
          }
        } else {
          if (!acousticReadinessProof || !timingSafeEqual(frame.payload, connection.acousticCapability)) fail('acoustic_disarm_capability_invalid');
          disarmAcousticSession();
          // The capability is intentionally single-use. Recovery in the same
          // epoch therefore receives a fresh capability instead of replaying
          // the just-consumed readiness proof and being disconnected.
          issueAcousticCapability(socket, connection);
        }
        return;
      }
      if (frame.sequence <= lastSequence.value) fail('stale_or_duplicate_frame');
      lastSequence.value = frame.sequence;
      if (frame.type === MessageType.HELLO) {
        if (frame.payload.byteLength !== 0 || frame.flags !== 0) fail('acoustic_capability_request_invalid');
        issueAcousticCapability(socket, connection);
        return;
      }
      await expireCyrinx();
      if (frame.type === MessageType.RESET) {
        if (frame.flags === RESET_ACK_FLAG) fail('reset_ack_not_accepted');
        if (frame.payload.length !== 0 || frame.flags !== 0) fail('reset_payload_not_empty');
        const alreadyPreempted = connection.preemptedControls.delete(frame.sequence);
        connection.mustResetBeforeUse = false;
        const previousEpoch = state.epoch;
        const resetting = reset(alreadyPreempted);
        if (state.epoch !== previousEpoch) {
          connection.receivedEpoch = state.epoch;
          connection.highestReceivedSequence = -1n;
          connection.errorOrigins.clear();
          connection.preemptedControls.clear();
        }
        await resetting;
        lastSequence.value = -1n;
        if (owner === socket && ownerConnection === connection && !connection.mustResetBeforeUse && frame.epoch + 1 === state.epoch) flushPacketQueue('fips-to-browser');
        return;
      }
      if (frame.type === MessageType.FIPS_PACKET) {
        if (!packetDestinationReady('browser-to-fips')) { state.packetQueues.browserToFips.health = 'not-connected'; fail('fips_destination_unavailable'); }
        enqueuePacket('browser-to-fips', frame);
        flushPacketQueue('browser-to-fips');
        state.packetReadiness.fips = true;
        return;
      }
      if (frame.type === MessageType.ACOUSTIC_UNIT) {
        if (frame.flags !== 0 || frame.payload.byteLength < 1 || frame.payload.byteLength > 253 || !options.cyrinxTransport) fail('acoustic_unit_invalid');
        const playback = await options.cyrinxTransport.encode(frame.payload, state.epoch);
        if (socket.readyState === socket.OPEN) socket.send(playback);
        return;
      }
      if (frame.type === MessageType.ACOUSTIC_LISTEN) {
        if (frame.flags !== 0 || frame.payload.byteLength !== 0 || !options.cyrinxTransport) fail('acoustic_listen_invalid');
        options.cyrinxTransport.beginReceive(state.epoch);
        if (socket.readyState === socket.OPEN) socket.send(encodeFrame({ type: MessageType.ACOUSTIC_LISTEN, epoch: state.epoch, sequence: frame.sequence, payload: Buffer.alloc(0) }));
        return;
      }
      if (frame.type === MessageType.PCM_CAPTURE && cyrinxSession?.codec === 'cyrinx') {
        await acceptCyrinxCapture(socket, encoded);
        return;
      }
      if (frame.type === MessageType.PCM_CAPTURE && options.cyrinxTransport) {
        const unit = await options.cyrinxTransport.receiveCapture(encoded);
        // The capture window is deliberately one-shot. Re-arm after every
        // complete window, including ordinary silence, so a modem retry never
        // depends on the timing of a native decode process.
        if (!options.cyrinxTransport.receiving) {
          options.cyrinxTransport.beginReceive(state.epoch);
          if (socket.readyState === socket.OPEN) {
            if (unit) socket.send(encodeFrame({ type: MessageType.ACOUSTIC_UNIT, epoch: state.epoch, sequence: frame.sequence, payload: Buffer.from(unit) }));
            socket.send(encodeFrame({ type: MessageType.ACOUSTIC_LISTEN, epoch: state.epoch, sequence: frame.sequence, payload: Buffer.alloc(0) }));
          }
        }
        return;
      }
      if ([MessageType.QUALIFICATION_CASE, MessageType.QUALIFICATION_RESULT, MessageType.ERROR].includes(frame.type)) {
        const payload = parseJsonPayload(frame);
        if (hasPacketBulk(payload)) fail('control_payload_contains_packet_data');
        if (hasForbiddenAuthority(payload)) fail('browser_authority_forbidden');
        if (frame.type === MessageType.QUALIFICATION_CASE && payload.action === 'start_cyrinx' && Object.keys(payload).length === 1) {
          await startCyrinx(); return;
        }
        if (frame.type === MessageType.QUALIFICATION_CASE && payload.action === 'accept_cyrinx_instruction') {
          await acceptCyrinxInstruction(payload); return;
        }
        if (frame.type === MessageType.QUALIFICATION_CASE && payload.action === 'playback_complete') {
          await completeCyrinxPlayback(payload); return;
        }
        if (frame.type === MessageType.ERROR) {
          disarmAcousticSession();
          // An in-place browser recovery keeps this WebSocket and epoch alive.
          // Rotate the single-use readiness capability immediately; otherwise
          // the recovered acoustic session replays a consumed capability and
          // the bridge rejects the healthy retry.
          issueAcousticCapability(socket, connection);
          const origin = connection.errorOrigins.get(frame.sequence)
            ?? (cyrinxSession?.codec === 'cyrinx' ? 'cyrinx' : cyrinxSession?.codec === 'quiet' ? 'quiet' : 'other');
          connection.errorOrigins.delete(frame.sequence);
          const alreadyPreempted = connection.preemptedControls.delete(frame.sequence);
          if (origin === 'cyrinx') {
            if (cyrinxSession?.codec === 'cyrinx') await activateCurrentFallback(alreadyPreempted);
            return;
          }
          if (origin === 'quiet' && cyrinxSession?.codec === 'quiet' && cyrinxSession.fallbackState === 'activated') {
            if (cyrinxSession.markQuietFailed()) {
              generation += 1;
              abortCyrinxOperation();
              await persist(generation);
              broadcastSession();
            }
          }
          return;
        }
        if (frame.type === MessageType.QUALIFICATION_RESULT && config) {
          if (cyrinxSession?.codec === 'cyrinx' || cyrinxSession?.codec === 'unqualified') fail('browser_result_forbidden_during_cyrinx');
          let result: BrowserResult;
          try {
            result = parseBrowserResult(payload, frame.epoch);
            if (!expectedById.has(result.caseId)) fail('unknown_case');
            if (result.coldAcquired && (result.caseId !== expectedCorpus[0]?.id || results.size !== 0)) fail('quiet_cold_case_invalid');
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
        localAudioPreflight = true;
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
      rejectSocket(socket, error);
    }
  };
  const sendPcmPlayback = (encoded: Buffer): void => {
    forwardPlayback(encoded);
  };
  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const port = (server.address() as import('node:net').AddressInfo | null)?.port; const route = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`).pathname;
    if (!port || !['/bridge', '/bridge/browser', '/bridge/fips'].includes(route) || !isSameOriginLoopback(request.headers.origin, port)) { rejectUpgrade(socket); return; }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => webSocketServer.emit('connection', webSocket, request));
  });
  webSocketServer.on('connection', (socket, request) => {
    const route = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`).pathname;
    if (route === '/bridge/fips') {
      if (fipsOwner?.readyState === socket.OPEN) { rejectSocket(socket, new BridgeInputError('fips_endpoint_already_owned')); return; }
      fipsOwner = socket; clients.add(socket); state.packetEndpoints.fips = 'ready';
      const lastSequence = { value: -1n }; sequenceTrackers.add(lastSequence); let processing = Promise.resolve();
      flushPacketQueue('browser-to-fips');
      if (state.acousticReady) notifyFipsBrowserState(true);
      socket.once('close', () => { clients.delete(socket); sequenceTrackers.delete(lastSequence); if (fipsOwner === socket) { fipsOwner = undefined; state.packetEndpoints.fips = 'disconnected'; } });
      socket.on('message', (rawData, isBinary) => {
        processing = processing.then(() => {
          try {
            if (!isBinary) fail('binary_frames_required');
            const frame = decodeFrame(asBuffer(rawData));
            if (frame.type !== MessageType.FIPS_PACKET) fail('fips_endpoint_requires_fips_packet');
            if (frame.epoch !== state.epoch || frame.sequence <= lastSequence.value) fail('stale_or_duplicate_frame');
            lastSequence.value = frame.sequence;
            if (!packetDestinationReady('fips-to-browser')) { state.packetQueues.fipsToBrowser.health = 'not-connected'; fail('browser_destination_unavailable'); }
            enqueuePacket('fips-to-browser', frame);
            flushPacketQueue('fips-to-browser');
            state.packetReadiness.browser = true;
          } catch (error) {
            rejectSocket(socket, error);
          }
        });
      });
      return;
    }
    if (owner?.readyState === socket.OPEN || epochClaimed && !reconnectAllowed) { rejectSocket(socket, new BridgeInputError('browser_endpoint_already_owned')); return; }
    const connection: BrowserConnectionState = {
      mustResetBeforeUse: epochClaimed && reconnectAllowed && reconnectRequiresReset,
      errorOrigins: new Map(),
      preemptedControls: new Set(),
      receivedEpoch: state.epoch,
      highestReceivedSequence: -1n,
      acousticCapability: Buffer.alloc(ACOUSTIC_DISARM_CAPABILITY_BYTES),
      acousticCapabilityUsed: false,
    };
    owner = socket; ownerConnection = connection; epochClaimed = true; reconnectAllowed = false; clients.add(socket); browserConnections.add(connection); state.packetEndpoints.browser = 'ready';
    if (!connection.mustResetBeforeUse) flushPacketQueue('fips-to-browser');
    const lastSequence = { value: -1n }; sequenceTrackers.add(lastSequence); let processing = Promise.resolve();
    void expireCyrinx().then((expired) => {
      if (expired) return;
      const snapshot = sessionSnapshot();
      if (snapshot && socket.readyState === socket.OPEN) socket.send(JSON.stringify(snapshot));
    });
    socket.once('close', () => {
      clients.delete(socket);
      sequenceTrackers.delete(lastSequence);
      browserConnections.delete(connection);
      if (owner !== socket) return;
      clearPendingBrowserAdmission();
      owner = undefined; ownerConnection = undefined; state.packetEndpoints.browser = 'disconnected'; localAudioPreflight = false; disarmAcousticSession();
      if (shuttingDown) return;
      if (connection.mustResetBeforeUse) {
        reconnectAllowed = true;
        reconnectRequiresReset = true;
        return;
      }
      if (reconnectAllowed) return;
      reconnectAllowed = true;
      reconnectRequiresReset = true;
      if (cyrinxSession?.codec === 'cyrinx') {
        void activateCurrentFallback().catch(() => undefined);
      }
    });
    socket.on('message', (rawData, isBinary) => {
      preemptUrgentControl(rawData, isBinary, connection);
      processing = processing.then(() => handleFrame(socket, rawData, isBinary, lastSequence, connection));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, options.host, () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') { await closeServer(server, webSocketServer); fail('bridge did not bind a TCP loopback address'); }
  return {
    port: address.port,
    sendPcmPlayback,
    startCyrinx,
    reset,
    close: async () => {
      shuttingDown = true;
      clearCyrinxTimer();
      abortCyrinxOperation();
      for (const client of clients) client.terminate();
      await writeTail;
      await closeServer(server, webSocketServer);
    },
    state: () => ({
      ...state,
      packetCounters: { ...state.packetCounters },
      packetQueues: { browserToFips: { ...state.packetQueues.browserToFips }, fipsToBrowser: { ...state.packetQueues.fipsToBrowser } },
      packetReadiness: { ...state.packetReadiness }, packetEndpoints: { ...state.packetEndpoints }, lastAcceptedAtMs: state.lastAcceptedAtMs, lastError: state.lastError ? { ...state.lastError } : null,
      queueCounts: { ...state.queueCounts }, overflowedQueues: [...state.overflowedQueues], stampedResults: state.stampedResults.map((result) => ({ ...result })),
    }),
  };
}
