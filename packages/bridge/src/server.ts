import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { decodeFrame, encodeFrame, MessageType, type FwavFrame } from './protocol.js';

export const LOOPBACK_HOST = '127.0.0.1';
export const HEADER_BYTES = 32;
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const AUDIO_SETTINGS_MESSAGE_TYPE = MessageType.AUDIO_SETTINGS;
const MAX_QUEUE_AGE_MS = 5_000;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODEM_UI_PATH = path.join(PROJECT_ROOT, 'apps/modem-ui/index.html');

export interface QualificationReport {
  schemaVersion: 1; evidencePath: 'Loopback'; physicalQualification: false; qualificationStatus: 'not-physical'; capturedAt: string; reportPath: string;
  frame: { messageType: 'AUDIO_SETTINGS'; epoch: number; sequence: string; payloadBytes: number };
}
export interface ParsedAudioSettingsFrame { epoch: number; sequence: bigint; payload: Buffer; }
export interface RunnerQualificationConfig {
  machineId: string; role: 'A' | 'B'; reportTarget: string; tunEvidence: string; evidenceMode: 'Fixture' | 'Loopback' | 'Open air'; evidenceClass: 'Fixture' | 'Loopback' | 'Open air';
}
export interface CodecAsset { filename: string; mimeType: string; browserServing: boolean; sha256: string; }
export interface BridgeState {
  epoch: number; rejectedFrames: number; overflowedQueues: string[]; discontinuities: number;
  queueCounts: Partial<Record<keyof typeof MessageType, number>> & Record<string, number>;
  stampedResults: Array<Record<string, unknown>>;
}
export interface BridgeServer {
  port: number; sendPcmPlayback(frame: Buffer): void; reset(): number; close(): Promise<void>; state(): BridgeState;
}
export interface BridgeServerOptions {
  host: typeof LOOPBACK_HOST; port: number; artifactDir: string; uiDir?: string; qualificationConfig?: RunnerQualificationConfig; codecAssetDir?: string; codecAssets?: readonly CodecAsset[];
}

function fail(message: string): never { throw new Error(message); }
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
function immutableConfig(config: RunnerQualificationConfig): RunnerQualificationConfig { return Object.freeze({ ...config }); }
function hasForbiddenAuthority(value: unknown): boolean {
  const forbidden = new Set(['machineId', 'role', 'reportTarget', 'report', 'tunEvidence', 'evidenceMode', 'evidenceClass', 'hostIdentity']);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasForbiddenAuthority);
  return Object.entries(value).some(([key, child]) => forbidden.has(key) || hasForbiddenAuthority(child));
}
function parseJsonPayload(frame: FwavFrame): Record<string, unknown> {
  if (frame.payload.length === 0) return {};
  try { const value = JSON.parse(frame.payload.toString('utf8')) as unknown; if (!value || Array.isArray(value) || typeof value !== 'object') fail('FWAV control payload must be a JSON object'); return value as Record<string, unknown>; } catch (error) { if (error instanceof Error && error.message.startsWith('FWAV')) throw error; fail('FWAV control payload is invalid JSON'); }
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

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServer> {
  if (options.host !== LOOPBACK_HOST) fail(`bridge host must be ${LOOPBACK_HOST}`);
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) fail('bridge port must be an integer between 0 and 65535');
  await mkdir(options.artifactDir, { recursive: true });
  const config = options.qualificationConfig && immutableConfig(options.qualificationConfig);
  const uiRoot = options.uiDir ? await realpath(options.uiDir) : undefined;
  const assets = new Map((options.codecAssets ?? []).filter((asset) => asset.browserServing).map((asset) => [asset.filename, asset]));
  const assetRoot = options.codecAssetDir ? await realpath(options.codecAssetDir) : undefined;
  if (assets.size && !assetRoot) fail('codec assets require a verified cache directory');
  const serveFile = async (response: import('node:http').ServerResponse, root: string, requestPath: string, mime?: string): Promise<void> => {
    if (requestPath.includes('\\') || requestPath.split('/').some((segment) => segment === '.' || segment === '..' || segment === '')) { response.writeHead(404).end(); return; }
    const candidate = path.resolve(root, requestPath);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) { response.writeHead(404).end(); return; }
    try {
      const metadata = await lstat(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink()) { response.writeHead(404).end(); return; }
      const resolved = await realpath(candidate);
      if (!resolved.startsWith(`${root}${path.sep}`)) { response.writeHead(404).end(); return; }
      const body = await readFile(resolved);
      response.writeHead(200, { 'content-type': mime ?? contentType(requestPath), 'content-length': String(body.byteLength), 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=31536000, immutable' }); response.end(body);
    } catch { response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found'); }
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`);
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    if (url.pathname === '/qualification-config' && config) { response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(config)); return; }
    if (url.pathname.startsWith('/codec-assets/')) {
      const filename = url.pathname.slice('/codec-assets/'.length);
      const asset = !url.search && assets.get(filename);
      if (!asset || !assetRoot || filename !== encodeURIComponent(filename)) { response.writeHead(404).end(); return; }
      void serveFile(response, assetRoot, filename, asset.mimeType); return;
    }
    if (url.pathname === '/' && !url.search) { if (uiRoot) { void serveFile(response, uiRoot, 'index.html'); return; } void readFile(MODEM_UI_PATH).then((page) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(page); }).catch(() => { response.writeHead(404).end(); }); return; }
    if (uiRoot && !url.search) { void serveFile(response, uiRoot, url.pathname.slice(1)); return; }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found');
  });
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const clients = new Set<WebSocket>(); const queues = new Map<MessageType, Queue>();
  const state: BridgeState = { epoch: 1, rejectedFrames: 0, overflowedQueues: [], discontinuities: 0, queueCounts: {}, stampedResults: [] };
  for (const type of [MessageType.PCM_CAPTURE, MessageType.PCM_PLAYBACK, MessageType.QUALIFICATION_CASE, MessageType.QUALIFICATION_RESULT, MessageType.ERROR, MessageType.RESET]) queues.set(type, { frames: [], bytes: 0, overflowed: false });
  const refreshState = () => { for (const [type, queue] of queues) state.queueCounts[queueName(type)] = queue.frames.length; };
  const clearQueues = () => { for (const queue of queues.values()) { queue.frames = []; queue.bytes = 0; } refreshState(); };
  const enqueue = (frame: FwavFrame): void => {
    const queue = queues.get(frame.type); if (!queue) return;
    const now = Date.now();
    while (queue.frames.length && now - queue.frames[0]!.enqueuedAt > MAX_QUEUE_AGE_MS) { const expired = queue.frames.shift()!; queue.bytes -= expired.frame.payload.byteLength + HEADER_BYTES; state.discontinuities += 1; }
    if (queue.bytes + frame.payload.byteLength + HEADER_BYTES > MAX_MESSAGE_BYTES) { queue.overflowed = true; state.overflowedQueues = [...new Set([...state.overflowedQueues, queueName(frame.type)])]; state.discontinuities += 1; fail(`FWAV ${queueName(frame.type)} queue overflow`); }
    queue.frames.push({ frame, enqueuedAt: now }); queue.bytes += frame.payload.byteLength + HEADER_BYTES; refreshState();
  };
  const reset = (): number => { state.epoch += 1; clearQueues(); const resetFrame = encodeFrame({ type: MessageType.RESET, epoch: state.epoch, sequence: 0n, payload: Buffer.alloc(0) }); for (const client of clients) if (client.readyState === client.OPEN) client.send(resetFrame); return state.epoch; };
  const handleFrame = async (socket: WebSocket, rawData: RawData, isBinary: boolean, lastSequence: { value: bigint }): Promise<void> => {
    try {
      if (!isBinary) fail('bridge accepts binary FWAV messages only');
      const frame = decodeFrame(asBuffer(rawData));
      // The walking-skeleton settings report may establish the first browser
      // epoch; every subsequent frame is pinned to the server's current one.
      if (frame.type === MessageType.AUDIO_SETTINGS && lastSequence.value < 0n && state.epoch === 1) state.epoch = frame.epoch;
      if (frame.epoch !== state.epoch || frame.sequence <= lastSequence.value) fail('FWAV frame is stale or duplicate');
      lastSequence.value = frame.sequence;
      if (frame.type === MessageType.RESET) { reset(); return; }
      if ([MessageType.QUALIFICATION_CASE, MessageType.QUALIFICATION_RESULT, MessageType.ERROR].includes(frame.type)) {
        const payload = parseJsonPayload(frame); if (hasForbiddenAuthority(payload)) fail('FWAV browser payload attempts to own runner authority');
        if (frame.type === MessageType.QUALIFICATION_RESULT && config) state.stampedResults.push({ ...payload, machineId: config.machineId, role: config.role, reportTarget: config.reportTarget, tunEvidence: config.tunEvidence, evidenceMode: config.evidenceMode, evidenceClass: config.evidenceClass });
      }
      if (frame.type === MessageType.AUDIO_SETTINGS) {
        const reportPath = path.join(options.artifactDir, 'loopback-qualification.json');
        await writeQualificationReport({ schemaVersion: 1, evidencePath: 'Loopback', physicalQualification: false, qualificationStatus: 'not-physical', capturedAt: new Date().toISOString(), reportPath, frame: { messageType: 'AUDIO_SETTINGS', epoch: frame.epoch, sequence: frame.sequence.toString(), payloadBytes: frame.payload.byteLength } });
        socket.send(JSON.stringify({ reportPath, physicalQualification: false })); return;
      }
      enqueue(frame);
    } catch (error) { state.rejectedFrames += 1; socket.close(1008, error instanceof Error ? error.message : 'invalid FWAV message'); }
  };
  const sendPcmPlayback = (encoded: Buffer): void => { const frame = decodeFrame(encoded); if (frame.type !== MessageType.PCM_PLAYBACK) fail('bridge only forwards PCM_PLAYBACK frames'); if (frame.epoch !== state.epoch) fail('bridge rejects stale PCM playback epoch'); enqueue(frame); for (const client of clients) if (client.readyState === client.OPEN) client.send(encoded); };
  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const port = (server.address() as import('node:net').AddressInfo | null)?.port; const route = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`).pathname;
    if (!port || route !== '/bridge' || !isSameOriginLoopback(request.headers.origin, port)) { rejectUpgrade(socket); return; }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => webSocketServer.emit('connection', webSocket, request));
  });
  webSocketServer.on('connection', (socket) => { const lastSequence = { value: -1n }; clients.add(socket); socket.once('close', () => clients.delete(socket)); socket.on('message', (rawData, isBinary) => void handleFrame(socket, rawData, isBinary, lastSequence)); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, LOOPBACK_HOST, () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') { await closeServer(server, webSocketServer); fail('bridge did not bind a TCP loopback address'); }
  return { port: address.port, sendPcmPlayback, reset, close: () => { for (const client of clients) client.terminate(); return closeServer(server, webSocketServer); }, state: () => ({ ...state, queueCounts: { ...state.queueCounts }, overflowedQueues: [...state.overflowedQueues], stampedResults: state.stampedResults.map((result) => ({ ...result })) }) };
}
