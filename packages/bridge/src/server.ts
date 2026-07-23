import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

export const LOOPBACK_HOST = '127.0.0.1';
export const HEADER_BYTES = 32;
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const AUDIO_SETTINGS_MESSAGE_TYPE = 2;

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODEM_UI_PATH = path.join(PROJECT_ROOT, 'apps/modem-ui/index.html');

export interface QualificationReport {
  schemaVersion: 1;
  evidencePath: 'Loopback';
  physicalQualification: false;
  qualificationStatus: 'not-physical';
  capturedAt: string;
  reportPath: string;
  frame: {
    messageType: 'AUDIO_SETTINGS';
    epoch: number;
    sequence: string;
    payloadBytes: number;
  };
}

export interface ParsedAudioSettingsFrame {
  epoch: number;
  sequence: bigint;
  payload: Buffer;
}

export interface BridgeServer {
  port: number;
  close(): Promise<void>;
}

export interface BridgeServerOptions {
  host: typeof LOOPBACK_HOST;
  port: number;
  artifactDir: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function isSameOriginLoopback(origin: string | undefined, port: number): boolean {
  if (!origin) {
    return false;
  }

  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
      && parsed.port === String(port);
  } catch {
    return false;
  }
}

function asBuffer(rawData: RawData): Buffer {
  if (Buffer.isBuffer(rawData)) {
    return rawData;
  }
  if (Array.isArray(rawData)) {
    return Buffer.concat(rawData);
  }
  return Buffer.from(rawData);
}

export function parseAudioSettingsFrame(frame: Buffer): ParsedAudioSettingsFrame {
  if (frame.byteLength > MAX_MESSAGE_BYTES) {
    fail('FWAV message exceeds the 256 KiB cap');
  }
  if (frame.byteLength < HEADER_BYTES) {
    fail('FWAV message is shorter than the 32-byte header');
  }
  if (frame.toString('ascii', 0, 4) !== 'FWAV') {
    fail('FWAV magic is invalid');
  }
  if (frame.readUInt8(4) !== 1) {
    fail('FWAV version is unsupported');
  }
  if (frame.readUInt8(5) !== AUDIO_SETTINGS_MESSAGE_TYPE) {
    fail('FWAV message type is not AUDIO_SETTINGS');
  }

  const declaredPayloadBytes = frame.readUInt32LE(8);
  if (declaredPayloadBytes > MAX_MESSAGE_BYTES - HEADER_BYTES) {
    fail('FWAV declared payload exceeds the 256 KiB cap');
  }
  if (frame.byteLength !== HEADER_BYTES + declaredPayloadBytes) {
    fail('FWAV declared payload length does not match the binary message');
  }

  return {
    epoch: frame.readUInt32LE(12),
    sequence: frame.readBigUInt64LE(16),
    payload: frame.subarray(HEADER_BYTES),
  };
}

export async function writeQualificationReport(report: QualificationReport): Promise<string> {
  await mkdir(path.dirname(report.reportPath), { recursive: true });
  const temporaryPath = `${report.reportPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, report.reportPath);
  return report.reportPath;
}

export async function readQualificationReport(reportPath: string): Promise<QualificationReport> {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as QualificationReport;
  if (
    report.schemaVersion !== 1
    || report.evidencePath !== 'Loopback'
    || report.physicalQualification !== false
    || report.qualificationStatus !== 'not-physical'
  ) {
    fail('qualification report is not a schema-versioned non-physical loopback report');
  }
  return report;
}

function closeServer(server: Server, webSocketServer: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    webSocketServer.close((webSocketError) => {
      if (webSocketError) {
        reject(webSocketError);
        return;
      }
      server.close((serverError) => (serverError ? reject(serverError) : resolve()));
    });
  });
}

function rejectUpgrade(socket: import('node:net').Socket): void {
  socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  socket.destroy();
}

async function handleFrame(socket: WebSocket, rawData: RawData, isBinary: boolean, artifactDir: string): Promise<void> {
  try {
    if (!isBinary) {
      fail('bridge accepts binary FWAV messages only');
    }

    const parsed = parseAudioSettingsFrame(asBuffer(rawData));
    const reportPath = path.join(artifactDir, 'loopback-qualification.json');
    const report: QualificationReport = {
      schemaVersion: 1,
      evidencePath: 'Loopback',
      physicalQualification: false,
      qualificationStatus: 'not-physical',
      capturedAt: new Date().toISOString(),
      reportPath,
      frame: {
        messageType: 'AUDIO_SETTINGS',
        epoch: parsed.epoch,
        sequence: parsed.sequence.toString(),
        payloadBytes: parsed.payload.byteLength,
      },
    };

    await writeQualificationReport(report);
    const persisted = await readQualificationReport(reportPath);
    socket.send(JSON.stringify({ reportPath: persisted.reportPath, physicalQualification: false }));
  } catch (error) {
    socket.close(1008, error instanceof Error ? error.message : 'invalid FWAV message');
  }
}

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServer> {
  if (options.host !== LOOPBACK_HOST) {
    fail(`bridge host must be ${LOOPBACK_HOST}`);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    fail('bridge port must be an integer between 0 and 65535');
  }

  await mkdir(options.artifactDir, { recursive: true });
  const page = await readFile(MODEM_UI_PATH);
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const port = (server.address() as import('node:net').AddressInfo | null)?.port;
    const route = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`).pathname;
    if (!port || route !== '/bridge' || !isSameOriginLoopback(request.headers.origin, port)) {
      rejectUpgrade(socket);
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  webSocketServer.on('connection', (socket) => {
    socket.on('message', (rawData, isBinary) => {
      void handleFrame(socket, rawData, isBinary, options.artifactDir);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, LOOPBACK_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server, webSocketServer);
    fail('bridge did not bind a TCP loopback address');
  }

  return { port: address.port, close: () => closeServer(server, webSocketServer) };
}
