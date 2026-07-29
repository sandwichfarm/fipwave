import { createHash } from 'node:crypto';

import { runPinnedCommand, type PinnedCommandRunner } from './codecs/command.js';
import { CYRINX_SAMPLE_RATE } from './cyrinx-worker.js';
import { CYRINX_CONTROL_PCM_PLAYBACK_FLAG, decodeFrame, decodePcmPayload, encodeFrame, encodePcmPayload, MessageType, PcmEncoding } from './protocol.js';

const METADATA_BYTES = 256;
/** QPSK n_sym=6 control profile: 512 PHY bytes in a 597 ms waveform. */
export const CYRINX_CONTROL_FRAME_SAMPLES = 28_672;
/**
 * The largest rolling microphone history retained for one control frame. The
 * decoder is tried before this limit, so this is a skew bound rather than a
 * mandatory wait before a peer can answer.
 */
export const CYRINX_CONTROL_CAPTURE_WINDOW_SAMPLES = 61_440;
/** Earliest capture history that can contain a full frame after measured startup skew. */
export const CYRINX_CONTROL_INITIAL_DECODE_SAMPLES = 53_248;
const CONTROL_DECODE_STRIDE_SAMPLES = 4_096;
const CONTROL_APPLICATION_MAX = 256;
const PCM_BYTES = CYRINX_CONTROL_FRAME_SAMPLES * Float32Array.BYTES_PER_ELEMENT;

export interface CyrinxPacketTransportOptions {
  executable: string;
  run?: PinnedCommandRunner;
  /** Opt-in development capture hook; production callers leave this unset. */
  onCapture?: (capture: Uint8Array, epoch: number) => void | Promise<void>;
}

/**
 * Packet-oriented Cyrinx seam. Unlike qualification, the receiver learns the
 * authenticated application length and digest from the modem frame itself, so
 * it can carry opaque FIPS packets rather than a predeclared corpus case.
 */
export class CyrinxPacketTransport {
  #sequence = 0n;
  #capture: { epoch: number; nextSampleIndex: bigint; chunks: Buffer[]; samples: number; lastDecodeSamples: number } | undefined;

  constructor(private readonly options: CyrinxPacketTransportOptions) {
    if (!options.executable) throw new Error('cyrinx transport executable is required');
  }

  async encode(packet: Uint8Array, epoch: number): Promise<Buffer> {
    if (!(packet instanceof Uint8Array) || packet.byteLength < 1 || packet.byteLength > CONTROL_APPLICATION_MAX || !Number.isInteger(epoch) || epoch < 1 || epoch > 0xffff_ffff) throw new Error('cyrinx transport packet is invalid');
    const metadata = this.metadata(packet, epoch);
    const request = Buffer.alloc(4 + METADATA_BYTES + packet.byteLength);
    request.writeUInt32LE(packet.byteLength, 0); metadata.copy(request, 4); Buffer.from(packet).copy(request, 4 + METADATA_BYTES);
    const response = await (this.options.run ?? runPinnedCommand)({ executable: this.options.executable, command: 'encode-control', payload: request });
    if (response.timedOut || response.exitCode !== 0 || response.stdout.byteLength !== PCM_BYTES) throw new Error('cyrinx transport encode failed');
    return encodeFrame({
      type: MessageType.PCM_PLAYBACK,
      flags: CYRINX_CONTROL_PCM_PLAYBACK_FLAG,
      epoch,
      sequence: this.#sequence++,
      sampleRate: CYRINX_SAMPLE_RATE,
      channels: 1,
      encoding: PcmEncoding.FLOAT32_LE,
      payload: encodePcmPayload(0n, Buffer.from(response.stdout)),
    });
  }

  beginReceive(epoch: number): void {
    if (!Number.isInteger(epoch) || epoch < 1 || epoch > 0xffff_ffff) throw new Error('cyrinx transport epoch is invalid');
    this.#capture = { epoch, nextSampleIndex: 0n, chunks: [], samples: 0, lastDecodeSamples: 0 };
  }

  /** True only while one complete, contiguous browser capture window is owned. */
  get receiving(): boolean { return this.#capture !== undefined; }

  async receiveCapture(encoded: Buffer): Promise<Uint8Array | undefined> {
    const active = this.#capture;
    if (!active) return undefined;
    const frame = decodeFrame(encoded);
    if (frame.type !== MessageType.PCM_CAPTURE || frame.flags !== 0 || frame.epoch !== active.epoch || frame.sampleRate !== CYRINX_SAMPLE_RATE || frame.channels !== 1 || frame.encoding !== PcmEncoding.FLOAT32_LE) throw new Error('cyrinx transport capture is invalid');
    const pcm = decodePcmPayload(frame.payload, 1);
    const count = pcm.samples.byteLength / Float32Array.BYTES_PER_ELEMENT;
    // Native decoding is asynchronous while microphone batches continue to
    // arrive. When a successful decode re-arms the browser, already-buffered
    // batches from the previous generation can arrive before its new zero
    // origin. They are stale audio, not a protocol violation.
    if (active.samples === 0 && pcm.firstSampleIndex !== 0n) return undefined;
    if (count < 1 || pcm.firstSampleIndex !== active.nextSampleIndex || active.samples + count > CYRINX_CONTROL_CAPTURE_WINDOW_SAMPLES) throw new Error('cyrinx transport capture geometry is invalid');
    active.chunks.push(pcm.samples); active.samples += count; active.nextSampleIndex += BigInt(count);
    const readyToDecode = active.samples >= CYRINX_CONTROL_INITIAL_DECODE_SAMPLES
      && (active.samples === CYRINX_CONTROL_CAPTURE_WINDOW_SAMPLES || active.samples - active.lastDecodeSamples >= CONTROL_DECODE_STRIDE_SAMPLES);
    if (!readyToDecode) return undefined;
    active.lastDecodeSamples = active.samples;
    const capture = Buffer.concat(active.chunks, active.samples * Float32Array.BYTES_PER_ELEMENT);
    await this.options.onCapture?.(capture, active.epoch);
    const response = await (this.options.run ?? runPinnedCommand)({ executable: this.options.executable, command: 'decode-control', payload: capture });
    // A valid microphone window with no modem preamble is ordinary while the
    // peer is silent. It is not a malformed bridge frame and must not tear
    // down the browser's only route to a later retry.
    if (response.timedOut || response.exitCode !== 0 || response.stdout.byteLength < 289) {
      if (active.samples === CYRINX_CONTROL_CAPTURE_WINDOW_SAMPLES) this.#capture = undefined;
      return undefined;
    }
    const body = Buffer.from(response.stdout);
    const bytes = body.readUInt32LE(5);
    const metadata = body.subarray(33, 289);
    const packet = body.subarray(289);
    if (body.toString('ascii', 0, 4) !== 'CYRR' || body.readUInt8(4) !== 1 || bytes !== packet.byteLength || packet.byteLength < 1 || packet.byteLength > CONTROL_APPLICATION_MAX || metadata.toString('ascii', 0, 4) !== 'CYRX' || metadata.readUInt8(4) !== 1 || metadata.readUInt32LE(5) !== active.epoch || metadata.readUInt32LE(75) !== packet.byteLength || !createHash('sha256').update(packet).digest().equals(metadata.subarray(79, 111))) {
      if (active.samples === CYRINX_CONTROL_CAPTURE_WINDOW_SAMPLES) this.#capture = undefined;
      return undefined;
    }
    this.#capture = undefined;
    return new Uint8Array(packet);
  }

  reset(): void { this.#capture = undefined; this.#sequence = 0n; }

  private metadata(packet: Uint8Array, epoch: number): Buffer {
    const metadata = Buffer.alloc(METADATA_BYTES);
    metadata.write('CYRX', 0, 'ascii'); metadata.writeUInt8(1, 4); metadata.writeUInt32LE(epoch, 5); metadata.writeUInt8(0, 9); metadata.write('fips-packet', 11, 'utf8'); metadata.writeUInt32LE(packet.byteLength, 75); createHash('sha256').update(packet).digest().copy(metadata, 79);
    return metadata;
  }
}
