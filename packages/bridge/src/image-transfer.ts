import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export const IMAGE_TRANSFER_PORT = 45_910;
export const IMAGE_MAX_WIDTH = 96;
export const IMAGE_MAX_HEIGHT = 96;
export const IMAGE_MAX_BYTES = IMAGE_MAX_WIDTH * IMAGE_MAX_HEIGHT * 4;
// IPv6's 1280-byte path MTU leaves 1232 bytes after IPv6 + UDP headers.
// Each band is compressed independently. This both keeps every UDP datagram
// under the IPv6 path MTU and lets Node B paint completed bands without waiting
// for the remainder of the image.
export const IMAGE_BAND_MAX_BYTES = 1_200;
export const IMAGE_BAND_TARGET_ROWS = 6;
const HEADER_BYTES = 32;
const MAGIC = Buffer.from('FIMG');
const ENCODING_DEFLATE_RAW = 2;

export interface ImageTransferBand {
  readonly y: number;
  readonly rows: number;
  readonly rgbaBase64: string;
}

export interface ImageTransferSnapshot {
  readonly transferId: string | null;
  readonly width: number;
  readonly height: number;
  readonly receivedRows: number;
  readonly complete: boolean;
  readonly revision: number;
  readonly bands: readonly ImageTransferBand[];
}

export interface ImageTransferApi {
  readonly role: 'A' | 'B';
  send(width: number, height: number, rgba: Buffer): Promise<{ transferId: string; bands: number }>;
  status(): ImageTransferSnapshot;
  close(): Promise<void>;
}

export interface AuthenticatedImageSender {
  sent(): boolean;
  close(): void;
}

interface DecodedBand {
  transferId: string;
  width: number;
  height: number;
  y: number;
  rows: number;
  rgba: Buffer;
}

function integer(value: number, minimum: number, maximum: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(code);
  return value;
}

export function validateRaster(width: number, height: number, rgba: Buffer): void {
  integer(width, 1, IMAGE_MAX_WIDTH, 'image_width_invalid');
  integer(height, 1, IMAGE_MAX_HEIGHT, 'image_height_invalid');
  if (rgba.byteLength !== width * height * 4 || rgba.byteLength > IMAGE_MAX_BYTES) throw new Error('image_raster_invalid');
}

export function encodeImageBand(input: Omit<DecodedBand, 'transferId'> & { transferId: Buffer }): Buffer {
  integer(input.width, 1, IMAGE_MAX_WIDTH, 'image_width_invalid');
  integer(input.height, 1, IMAGE_MAX_HEIGHT, 'image_height_invalid');
  if (input.transferId.byteLength !== 8) throw new Error('image_transfer_id_invalid');
  integer(input.y, 0, input.height - 1, 'image_band_y_invalid');
  integer(input.rows, 1, input.height - input.y, 'image_band_rows_invalid');
  if (input.rgba.byteLength !== input.width * input.rows * 4 || input.rgba.byteLength > IMAGE_MAX_BYTES) throw new Error('image_band_payload_invalid');
  const payload = deflateRawSync(input.rgba, { level: 9 });
  if (payload.byteLength < 1 || payload.byteLength > IMAGE_BAND_MAX_BYTES) throw new Error('image_band_compressed_oversize');
  const frame = Buffer.alloc(HEADER_BYTES + payload.byteLength);
  MAGIC.copy(frame, 0); frame[4] = 1; frame[5] = ENCODING_DEFLATE_RAW;
  input.transferId.copy(frame, 8);
  frame.writeUInt16LE(input.width, 16); frame.writeUInt16LE(input.height, 18);
  frame.writeUInt16LE(input.y, 20); frame.writeUInt16LE(input.rows, 22);
  frame.writeUInt32LE(payload.byteLength, 24);
  payload.copy(frame, HEADER_BYTES);
  return frame;
}

export function decodeImageBand(frame: Buffer): DecodedBand {
  if (frame.byteLength <= HEADER_BYTES || frame.byteLength > HEADER_BYTES + IMAGE_BAND_MAX_BYTES) throw new Error('image_frame_size_invalid');
  if (!frame.subarray(0, 4).equals(MAGIC) || frame[4] !== 1 || frame[5] !== ENCODING_DEFLATE_RAW || frame.readUInt16LE(6) !== 0 || frame.readUInt32LE(28) !== 0) throw new Error('image_frame_header_invalid');
  const width = frame.readUInt16LE(16); const height = frame.readUInt16LE(18);
  const y = frame.readUInt16LE(20); const rows = frame.readUInt16LE(22);
  const payload = frame.subarray(HEADER_BYTES);
  if (frame.readUInt32LE(24) !== payload.byteLength) throw new Error('image_frame_length_invalid');
  integer(width, 1, IMAGE_MAX_WIDTH, 'image_width_invalid');
  integer(height, 1, IMAGE_MAX_HEIGHT, 'image_height_invalid');
  integer(y, 0, height - 1, 'image_band_y_invalid');
  integer(rows, 1, height - y, 'image_band_rows_invalid');
  const expectedBytes = width * rows * 4;
  let rgba: Buffer;
  try {
    rgba = inflateRawSync(payload, { maxOutputLength: expectedBytes });
  } catch {
    throw new Error('image_band_payload_invalid');
  }
  if (rgba.byteLength !== expectedBytes) throw new Error('image_band_payload_invalid');
  return { transferId: frame.subarray(8, 16).toString('hex'), width, height, y, rows, rgba: Buffer.from(rgba) };
}

function emptySnapshot(): ImageTransferSnapshot {
  return Object.freeze({ transferId: null, width: 0, height: 0, receivedRows: 0, complete: false, revision: 0, bands: Object.freeze([]) });
}

function sendDatagram(socket: Socket, frame: Buffer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => socket.send(frame, port, host, (error) => error ? reject(error) : resolve()));
}

export function startAuthenticatedImageSender(options: Readonly<{
  peerReady(): Promise<boolean>;
  send(): Promise<unknown>;
  retryMs?: number;
}>): AuthenticatedImageSender {
  const retryMs = options.retryMs ?? 1_500;
  if (!Number.isSafeInteger(retryMs) || retryMs < 1 || retryMs > 60_000) throw new Error('image_retry_invalid');
  let closed = false; let sentOnce = false; let peerWasReady = false; let sendNeeded = true; let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number): void => {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = undefined; void attempt(); }, delay);
  };
  const attempt = async (): Promise<void> => {
    if (closed || running) return;
    running = true;
    try {
      const peerReady = await options.peerReady();
      if (!peerReady) {
        peerWasReady = false;
        sendNeeded = true;
      } else {
        if (!peerWasReady) sendNeeded = true;
        peerWasReady = true;
      }
      if (peerReady && sendNeeded) {
        await options.send();
        sendNeeded = false;
        sentOnce = true;
      }
    } catch {
      // FIPS control and the local UDP socket are both transient during
      // startup. The next bounded poll remains authoritative.
    } finally {
      running = false;
      if (!closed) schedule(retryMs);
    }
  };
  schedule(0);
  return Object.freeze({
    sent: () => sentOnce,
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  });
}

export function createImageTransfer(options: Readonly<{
  role: 'A' | 'B';
  localIpv6: string;
  peerIpv6: string;
  port?: number;
  socket?: Socket;
}>): ImageTransferApi {
  const socket = options.socket ?? createSocket('udp6');
  const port = options.port ?? IMAGE_TRANSFER_PORT;
  let snapshot = emptySnapshot();
  const received = new Map<number, ImageTransferBand>();
  let closed = false;

  const accept = (frame: Buffer, remote: RemoteInfo): void => {
    if (options.role !== 'B' || remote.address !== options.peerIpv6) return;
    let band: DecodedBand;
    try { band = decodeImageBand(frame); } catch { return; }
    if (snapshot.transferId !== band.transferId || snapshot.width !== band.width || snapshot.height !== band.height) {
      received.clear();
      snapshot = Object.freeze({ transferId: band.transferId, width: band.width, height: band.height, receivedRows: 0, complete: false, revision: snapshot.revision + 1, bands: Object.freeze([]) });
    }
    const previous = received.get(band.y);
    if (previous && previous.rows === band.rows && previous.rgbaBase64 === band.rgba.toString('base64')) return;
    received.set(band.y, Object.freeze({ y: band.y, rows: band.rows, rgbaBase64: band.rgba.toString('base64') }));
    const bands = [...received.values()].sort((left, right) => left.y - right.y);
    const receivedRows = bands.reduce((total, value) => total + value.rows, 0);
    snapshot = Object.freeze({ ...snapshot, receivedRows, complete: receivedRows === band.height, revision: snapshot.revision + 1, bands: Object.freeze(bands) });
  };
  socket.on('message', accept);
  socket.on('error', () => undefined);
  socket.bind(port, '::');

  return {
    role: options.role,
    async send(width, height, rgba) {
      if (closed || options.role !== 'A') throw new Error('image_send_forbidden');
      validateRaster(width, height, rgba);
      const transferId = randomBytes(8);
      const transferIdHex = transferId.toString('hex');
      // Role A exposes only that the fixed raster has entered the FIPS data
      // plane. This lets the UI reveal the source image at the same authority
      // boundary as transmission rather than at the earlier acoustic-link
      // boundary.
      snapshot = Object.freeze({
        transferId: transferIdHex,
        width,
        height,
        receivedRows: 0,
        complete: false,
        revision: snapshot.revision + 1,
        bands: Object.freeze([]),
      });
      let bands = 0;
      for (let y = 0; y < height;) {
        let rows = Math.min(IMAGE_BAND_TARGET_ROWS, height - y);
        let frame: Buffer | undefined;
        while (rows > 0) {
          const body = rgba.subarray(y * width * 4, (y + rows) * width * 4);
          try {
            frame = encodeImageBand({ transferId, width, height, y, rows, rgba: body });
            break;
          } catch (error) {
            if (!(error instanceof Error) || error.message !== 'image_band_compressed_oversize' || rows === 1) throw error;
            rows -= 1;
          }
        }
        if (!frame) throw new Error('image_band_payload_invalid');
        await sendDatagram(socket, frame, port, options.peerIpv6);
        bands += 1;
        y += rows;
      }
      snapshot = Object.freeze({
        ...snapshot,
        receivedRows: height,
        complete: true,
        revision: snapshot.revision + 1,
      });
      return { transferId: transferIdHex, bands };
    },
    status: () => snapshot,
    close: () => new Promise((resolve) => {
      if (closed) { resolve(); return; }
      closed = true;
      socket.close(() => resolve());
    }),
  };
}
