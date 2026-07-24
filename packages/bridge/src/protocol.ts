/** The fixed, little-endian v1 envelope shared by browser and local bridge. */
export const FWAV_MAGIC = 'FWAV';
export const FWAV_VERSION = 1;
export const HEADER_BYTES = 32;
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_PAYLOAD_BYTES = MAX_MESSAGE_BYTES - HEADER_BYTES;
/** PCM carries its signal timeline here; FWAV sequence remains transport anti-replay only. */
export const PCM_SAMPLE_INDEX_BYTES = 8;
/** Exact fixed-geometry Cyrinx playback; the browser adds the documented local guard tail. */
export const CYRINX_PCM_PLAYBACK_FLAG = 0x0001;
/** RESET acknowledgements are bridge-originated and must never be echoed back as requests. */
export const RESET_ACK_FLAG = 0x0001;

/**
 * Source-authored scheduling metadata for complete opaque FIPS packets.
 *
 * These values mirror Rust `TrafficClass` exactly.  They are local FWAV
 * metadata, never inferred from or embedded in the encrypted FIPS payload.
 */
export enum FipsTrafficClass {
  Control = 1,
  Heartbeat = 2,
  Ordinary = 3,
}

export enum MessageType {
  HELLO = 1,
  AUDIO_SETTINGS = 2,
  PCM_CAPTURE = 3,
  PCM_PLAYBACK = 4,
  QUALIFICATION_CASE = 5,
  QUALIFICATION_RESULT = 6,
  ERROR = 7,
  RESET = 8,
  /** One complete opaque FIPS transport packet; codec and waveform-neutral. */
  FIPS_PACKET = 9,
  /** Bridge-only current-epoch browser state for the local FIPS worker. */
  BROWSER_ARM = 10,
  /** Bridge-only disarm event; emitted on browser disconnect/reset. */
  BROWSER_DISARM = 11,
  /** Browser projection of a current committed acoustic session plus heartbeat. */
  ACOUSTIC_READY = 12,
  /** Browser projection that the current acoustic session is no longer usable. */
  ACOUSTIC_DISARM = 13,
}

export enum PcmEncoding {
  NONE = 0,
  FLOAT32_LE = 1,
}

export interface FwavFrame {
  type: MessageType;
  flags?: number;
  /** Present only on FIPS_PACKET; encoded at FWAV byte 6. */
  trafficClass?: FipsTrafficClass;
  epoch: number;
  sequence: bigint;
  sampleRate?: number;
  channels?: number;
  encoding?: PcmEncoding;
  payload: Buffer;
}

export function encodePcmPayload(firstSampleIndex: bigint, samples: Buffer): Buffer {
  if (firstSampleIndex < 0n || firstSampleIndex > 0xffff_ffff_ffff_ffffn) fail('PCM first sample index is out of range');
  if (!Buffer.isBuffer(samples)) fail('PCM samples must be binary');
  const payload = Buffer.alloc(PCM_SAMPLE_INDEX_BYTES + samples.byteLength);
  payload.writeBigUInt64LE(firstSampleIndex, 0); samples.copy(payload, PCM_SAMPLE_INDEX_BYTES); return payload;
}
export function decodePcmPayload(payload: Buffer, channels: number): { firstSampleIndex: bigint; samples: Buffer } {
  if (!Buffer.isBuffer(payload)) fail('PCM payload must be binary');
  if (!Number.isInteger(channels) || channels <= 0 || channels > 0xffff) fail('PCM channel count is out of range');
  if (payload.byteLength <= PCM_SAMPLE_INDEX_BYTES || (payload.byteLength - PCM_SAMPLE_INDEX_BYTES) % (Float32Array.BYTES_PER_ELEMENT * channels) !== 0) fail('PCM payload is not sample-index aligned');
  return { firstSampleIndex: payload.readBigUInt64LE(0), samples: Buffer.from(payload.subarray(PCM_SAMPLE_INDEX_BYTES)) };
}

/** Tracks one accepted stream epoch so RESET makes late frames harmless. */
export class EpochTracker {
  #epoch = 0;
  #lastSequence = -1n;

  get epoch(): number { return this.#epoch; }

  reset(): number {
    if (this.#epoch === 0xffff_ffff) fail('epoch cannot be incremented');
    this.#epoch += 1;
    this.#lastSequence = -1n;
    return this.#epoch;
  }

  accept(frame: FwavFrame): void {
    if (frame.epoch !== this.#epoch) fail('frame belongs to a stale epoch');
    if (frame.sequence <= this.#lastSequence) fail('sequence is duplicate or stale');
    this.#lastSequence = frame.sequence;
  }
}

function fail(message: string): never {
  throw new Error(`FWAV ${message}`);
}

function isMessageType(value: number): value is MessageType {
  return value >= MessageType.HELLO && value <= MessageType.ACOUSTIC_DISARM;
}

/** Runtime guard shared by the bridge and browser packet boundary. */
export function isFipsTrafficClass(value: number): value is FipsTrafficClass {
  return value === FipsTrafficClass.Control
    || value === FipsTrafficClass.Heartbeat
    || value === FipsTrafficClass.Ordinary;
}

function validateInteger(value: number, name: string, maximum: number): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    fail(`${name} is out of range`);
  }
}

function validateFrame(frame: FwavFrame): Required<Pick<FwavFrame, 'flags' | 'sampleRate' | 'channels' | 'encoding'>> & FwavFrame {
  if (!isMessageType(frame.type)) fail('message type is unsupported');
  validateInteger(frame.flags ?? 0, 'flags', 0xffff);
  validateInteger(frame.epoch, 'epoch', 0xffff_ffff);
  if (frame.sequence < 0n || frame.sequence > 0xffff_ffff_ffff_ffffn) fail('sequence is out of range');
  if (!Buffer.isBuffer(frame.payload)) fail('payload must be binary');
  if (frame.payload.byteLength > MAX_PAYLOAD_BYTES) fail('message exceeds the 256 KiB cap');

  const sampleRate = frame.sampleRate ?? 0;
  const channels = frame.channels ?? 0;
  const encoding = frame.encoding ?? PcmEncoding.NONE;
  const isFipsPacket = frame.type === MessageType.FIPS_PACKET;
  const isAcousticReadinessControl = frame.type === MessageType.ACOUSTIC_READY
    || frame.type === MessageType.ACOUSTIC_DISARM;
  const trafficClass = frame.trafficClass ?? FipsTrafficClass.Ordinary;
  if (isFipsPacket) {
    if ((frame.flags ?? 0) !== 0) fail('FIPS packet must not declare flags');
    if (!isFipsTrafficClass(trafficClass)) fail('traffic class is unsupported');
  } else if (frame.trafficClass !== undefined) {
    fail('traffic class is only valid for FIPS packets');
  }
  if (isAcousticReadinessControl
    && ((frame.flags ?? 0) !== 0 || frame.sequence !== 0n || frame.payload.byteLength !== 0)) {
    fail('acoustic readiness control must have zero flags, sequence, and payload');
  }
  validateInteger(sampleRate, 'sample rate', 0xffff_ffff);
  validateInteger(channels, 'channel count', 0xffff);
  validateInteger(encoding, 'encoding', 0xffff);
  const isPcm = frame.type === MessageType.PCM_CAPTURE || frame.type === MessageType.PCM_PLAYBACK;
  if (isPcm) {
    if (sampleRate === 0) fail('sample rate must be declared for PCM');
    if (channels === 0) fail('channel count must be declared for PCM');
    if (encoding !== PcmEncoding.FLOAT32_LE) fail('PCM encoding is unsupported');
    decodePcmPayload(frame.payload, channels);
  } else if (sampleRate !== 0 || channels !== 0 || encoding !== PcmEncoding.NONE) {
    fail('non-PCM messages must not declare PCM format');
  }
  return {
    ...frame,
    ...(isFipsPacket ? { trafficClass } : {}),
    flags: frame.flags ?? 0,
    sampleRate,
    channels,
    encoding,
  };
}

export function encodeFrame(frame: FwavFrame): Buffer {
  const valid = validateFrame(frame);
  const output = Buffer.alloc(HEADER_BYTES + valid.payload.byteLength);
  output.write(FWAV_MAGIC, 0, 'ascii');
  output.writeUInt8(FWAV_VERSION, 4);
  output.writeUInt8(valid.type, 5);
  if (valid.type === MessageType.FIPS_PACKET) {
    output.writeUInt8(valid.trafficClass!, 6);
    output.writeUInt8(0, 7);
  } else {
    output.writeUInt16LE(valid.flags, 6);
  }
  output.writeUInt32LE(valid.payload.byteLength, 8);
  output.writeUInt32LE(valid.epoch, 12);
  output.writeBigUInt64LE(valid.sequence, 16);
  output.writeUInt32LE(valid.sampleRate, 24);
  output.writeUInt16LE(valid.channels, 28);
  output.writeUInt16LE(valid.encoding, 30);
  valid.payload.copy(output, HEADER_BYTES);
  return output;
}

export function decodeFrame(input: Buffer): FwavFrame {
  if (!Buffer.isBuffer(input)) fail('input must be binary');
  if (input.byteLength < HEADER_BYTES) fail('message is shorter than the 32-byte header');
  if (input.byteLength > MAX_MESSAGE_BYTES) fail('message exceeds the 256 KiB cap');
  if (input.toString('ascii', 0, 4) !== FWAV_MAGIC) fail('magic is invalid');
  if (input.readUInt8(4) !== FWAV_VERSION) fail('version is unsupported');
  const type = input.readUInt8(5);
  if (!isMessageType(type)) fail('message type is unsupported');
  const payloadLength = input.readUInt32LE(8);
  if (payloadLength > MAX_PAYLOAD_BYTES || input.byteLength !== HEADER_BYTES + payloadLength) fail('declared payload length does not match message');
  const trafficClass = type === MessageType.FIPS_PACKET ? input.readUInt8(6) : undefined;
  const flags = type === MessageType.FIPS_PACKET ? input.readUInt8(7) << 8 : input.readUInt16LE(6);
  return validateFrame({
    type,
    flags,
    ...(trafficClass === undefined ? {} : { trafficClass }),
    epoch: input.readUInt32LE(12),
    sequence: input.readBigUInt64LE(16),
    sampleRate: input.readUInt32LE(24),
    channels: input.readUInt16LE(28),
    encoding: input.readUInt16LE(30) as PcmEncoding,
    payload: Buffer.from(input.subarray(HEADER_BYTES)),
  });
}
