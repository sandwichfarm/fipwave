import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { randomBytes } from 'node:crypto';

export const IMAGE_TRANSFER_PORT = 45_910;
export const IMAGE_MAX_WIDTH = 96;
export const IMAGE_MAX_HEIGHT = 96;
export const IMAGE_MAX_BYTES = IMAGE_MAX_WIDTH * IMAGE_MAX_HEIGHT * 4;
export const IMAGE_BAND_MAX_BYTES = 1_024;
const HEADER_BYTES = 32;
const MAGIC = Buffer.from('FIMG');

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
  if (input.rgba.byteLength !== input.width * input.rows * 4 || input.rgba.byteLength > IMAGE_BAND_MAX_BYTES) throw new Error('image_band_payload_invalid');
  const frame = Buffer.alloc(HEADER_BYTES + input.rgba.byteLength);
  MAGIC.copy(frame, 0); frame[4] = 1; frame[5] = 1;
  input.transferId.copy(frame, 8);
  frame.writeUInt16LE(input.width, 16); frame.writeUInt16LE(input.height, 18);
  frame.writeUInt16LE(input.y, 20); frame.writeUInt16LE(input.rows, 22);
  frame.writeUInt32LE(input.rgba.byteLength, 24);
  input.rgba.copy(frame, HEADER_BYTES);
  return frame;
}

export function decodeImageBand(frame: Buffer): DecodedBand {
  if (frame.byteLength <= HEADER_BYTES || frame.byteLength > HEADER_BYTES + IMAGE_BAND_MAX_BYTES) throw new Error('image_frame_size_invalid');
  if (!frame.subarray(0, 4).equals(MAGIC) || frame[4] !== 1 || frame[5] !== 1 || frame.readUInt16LE(6) !== 0 || frame.readUInt32LE(28) !== 0) throw new Error('image_frame_header_invalid');
  const width = frame.readUInt16LE(16); const height = frame.readUInt16LE(18);
  const y = frame.readUInt16LE(20); const rows = frame.readUInt16LE(22);
  const rgba = frame.subarray(HEADER_BYTES);
  if (frame.readUInt32LE(24) !== rgba.byteLength) throw new Error('image_frame_length_invalid');
  integer(width, 1, IMAGE_MAX_WIDTH, 'image_width_invalid');
  integer(height, 1, IMAGE_MAX_HEIGHT, 'image_height_invalid');
  integer(y, 0, height - 1, 'image_band_y_invalid');
  integer(rows, 1, height - y, 'image_band_rows_invalid');
  if (rgba.byteLength !== width * rows * 4) throw new Error('image_band_payload_invalid');
  return { transferId: frame.subarray(8, 16).toString('hex'), width, height, y, rows, rgba: Buffer.from(rgba) };
}

function emptySnapshot(): ImageTransferSnapshot {
  return Object.freeze({ transferId: null, width: 0, height: 0, receivedRows: 0, complete: false, revision: 0, bands: Object.freeze([]) });
}

function sendDatagram(socket: Socket, frame: Buffer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => socket.send(frame, port, host, (error) => error ? reject(error) : resolve()));
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
      const rowsPerBand = Math.max(1, Math.floor(IMAGE_BAND_MAX_BYTES / (width * 4)));
      let bands = 0;
      for (let y = 0; y < height; y += rowsPerBand) {
        const rows = Math.min(rowsPerBand, height - y);
        const body = rgba.subarray(y * width * 4, (y + rows) * width * 4);
        await sendDatagram(socket, encodeImageBand({ transferId, width, height, y, rows, rgba: body }), port, options.peerIpv6);
        bands += 1;
      }
      return { transferId: transferId.toString('hex'), bands };
    },
    status: () => snapshot,
    close: () => new Promise((resolve) => {
      if (closed) { resolve(); return; }
      closed = true;
      socket.close(() => resolve());
    }),
  };
}
