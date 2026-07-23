import { createHash } from 'node:crypto';

import { CYRINX_PROFILE, runPinnedCommand, type PinnedCommandRunner } from './codecs/command.js';
import {
  CYRINX_PCM_PLAYBACK_FLAG,
  decodeFrame,
  decodePcmPayload,
  encodeFrame,
  encodePcmPayload,
  MessageType,
  PcmEncoding,
} from './protocol.js';
import type { LiteralDirection } from './report.js';

export const CYRINX_FRAME_SAMPLES = 62_464;
export const CYRINX_GUARD_SAMPLES = 14_400;
export const CYRINX_CAPTURE_WINDOW_SAMPLES = 131_072;
export const CYRINX_SAMPLE_RATE = 48_000;
const PCM_BYTES = CYRINX_FRAME_SAMPLES * Float32Array.BYTES_PER_ELEMENT;
const METADATA_BYTES = 256;

export type CyrinxCaseMode = 'transmit' | 'listen';
export interface CyrinxCase { id: string; direction: LiteralDirection; payload: Uint8Array; digest: string; }
export interface CyrinxResult {
  epoch: number;
  direction: LiteralDirection;
  caseId: string;
  digest: string | null;
  acquisitionMs: number;
  airtimeMs: number;
  complete: boolean;
  corrupt: boolean;
  missing: number;
  duplicates: number;
  deliveryCount: number;
  bytePerfect: boolean;
  coldAcquired: boolean;
  queues: {
    captureHighWaterBytes: number;
    captureHighWaterMs: number;
    playbackHighWaterBytes: number;
    playbackHighWaterMs: number;
    discontinuities: number;
  };
}
export interface CyrinxWorkerOptions { executable: string; run?: PinnedCommandRunner; now?: () => number; }

interface ActiveCase {
  epoch: number;
  generation: number;
  mode: CyrinxCaseMode;
  value: CyrinxCase;
  metadata: Buffer;
  startedAt: number;
  abort: AbortController;
  chunks: Buffer[];
  samples: number;
  decoded: boolean;
  nextSampleIndex: bigint;
  pendingBytes: number;
  pendingHighWaterBytes: number;
  pendingHighWaterMs: number;
}

function metadata(input: CyrinxCase, epoch: number): Buffer {
  if (input.payload.byteLength > 1_536 || !/^[a-f0-9]{64}$/i.test(input.digest) || !/^[A-Za-z0-9._-]{1,64}$/.test(input.id) || (input.direction !== 'A → B' && input.direction !== 'B → A') || !Number.isInteger(epoch) || epoch <= 0 || epoch > 0xffff_ffff) {
    throw new Error('cyrinx case metadata is invalid');
  }
  const output = Buffer.alloc(METADATA_BYTES);
  output.write('CYRX', 0, 'ascii');
  output.writeUInt8(1, 4);
  output.writeUInt32LE(epoch, 5);
  output.writeUInt8(input.direction === 'A → B' ? 0 : 1, 9);
  output.write(input.id, 11, 'utf8');
  output.writeUInt32LE(input.payload.byteLength, 75);
  Buffer.from(input.digest, 'hex').copy(output, 79);
  return output;
}

function encodeRequest(meta: Buffer, payload: Uint8Array): Buffer {
  const output = Buffer.alloc(4 + meta.byteLength + payload.byteLength);
  output.writeUInt32LE(payload.byteLength, 0);
  meta.copy(output, 4);
  Buffer.from(payload).copy(output, 4 + meta.byteLength);
  return output;
}

function finiteFloat32(samples: Buffer): boolean {
  for (let offset = 0; offset < samples.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
    if (!Number.isFinite(samples.readFloatLE(offset))) return false;
  }
  return true;
}

/**
 * Owns exactly one physical Cyrinx role at a time.
 *
 * A transmitter can only encode/play; its local microphone is ignored. A
 * listener can only capture/decode; it never creates local playback. Native
 * work is generation-scoped and abortable so RESET makes late completion inert.
 */
export class CyrinxBatchWorker {
  #active: ActiveCase | undefined;
  #generation = 0;
  #epoch: number | undefined;
  #outboundSequence = 0n;
  #playbackSampleIndex = 0n;
  #lastCaptureSequence = -1n;
  #delivered = new Set<string>();

  constructor(private readonly options: CyrinxWorkerOptions) {
    if (!options.executable) throw new Error('cyrinx executable is required');
  }

  async begin(value: CyrinxCase, epoch: number, mode: CyrinxCaseMode): Promise<Buffer | undefined> {
    if (mode !== 'transmit' && mode !== 'listen') throw new Error('cyrinx case mode is invalid');
    if (this.#active) throw new Error('cyrinx worker already owns a case');
    if (this.#epoch !== undefined && this.#epoch !== epoch) throw new Error('cyrinx reset is required before changing epoch');
    const meta = metadata(value, epoch);
    const identity = this.identity(value, epoch);
    if (this.#delivered.has(identity)) throw new Error('cyrinx_duplicate_case');
    this.#epoch = epoch;
    const generation = ++this.#generation;
    const active: ActiveCase = {
      epoch,
      generation,
      mode,
      value,
      metadata: meta,
      startedAt: (this.options.now ?? Date.now)(),
      abort: new AbortController(),
      chunks: [],
      samples: 0,
      decoded: false,
      nextSampleIndex: 0n,
      pendingBytes: 0,
      pendingHighWaterBytes: 0,
      pendingHighWaterMs: 0,
    };
    this.#active = active;
    if (mode === 'listen') return undefined;

    let response;
    try {
      response = await (this.options.run ?? runPinnedCommand)({
        executable: this.options.executable,
        command: 'encode',
        payload: encodeRequest(meta, value.payload),
        signal: active.abort.signal,
      });
    } catch {
      if (!this.isCurrent(generation)) throw new Error('cyrinx_operation_cancelled');
      return this.reject(responseReason('encode'));
    }
    if (!this.isCurrent(generation)) throw new Error('cyrinx_operation_cancelled');
    if (response.timedOut) return this.reject('cyrinx_process_timeout');
    if (response.exitCode !== 0 || response.stdout.byteLength !== PCM_BYTES) return this.reject('cyrinx_encode_failed');

    const firstSampleIndex = this.#playbackSampleIndex;
    const frame = encodeFrame({
      type: MessageType.PCM_PLAYBACK,
      flags: CYRINX_PCM_PLAYBACK_FLAG,
      epoch,
      sequence: this.#outboundSequence,
      sampleRate: CYRINX_SAMPLE_RATE,
      channels: 1,
      encoding: PcmEncoding.FLOAT32_LE,
      payload: encodePcmPayload(firstSampleIndex, Buffer.from(response.stdout)),
    });
    this.#outboundSequence += 1n;
    this.#playbackSampleIndex += BigInt(CYRINX_FRAME_SAMPLES + CYRINX_GUARD_SAMPLES);
    this.#delivered.add(identity);
    this.clearActive(false);
    return frame;
  }

  async receiveCapture(encoded: Buffer): Promise<CyrinxResult | undefined> {
    const active = this.#active;
    if (!active || active.mode !== 'listen' || active.decoded) return undefined;
    active.pendingBytes += encoded.byteLength;
    active.pendingHighWaterBytes = Math.max(active.pendingHighWaterBytes, active.pendingBytes);

    let frame;
    try {
      frame = decodeFrame(encoded);
    } catch {
      return this.reject('cyrinx_capture_invalid');
    }
    if (
      frame.type !== MessageType.PCM_CAPTURE
      || frame.flags !== 0
      || frame.epoch !== active.epoch
      || frame.channels !== 1
      || frame.sampleRate !== CYRINX_SAMPLE_RATE
      || frame.encoding !== PcmEncoding.FLOAT32_LE
    ) return this.reject('cyrinx_capture_invalid');
    if (frame.sequence <= this.#lastCaptureSequence) return this.reject('cyrinx_capture_replay');

    let pcm;
    try {
      pcm = decodePcmPayload(frame.payload, 1);
    } catch {
      return this.reject('cyrinx_capture_invalid');
    }
    const sampleCount = pcm.samples.byteLength / Float32Array.BYTES_PER_ELEMENT;
    if (sampleCount <= 0 || !finiteFloat32(pcm.samples)) return this.reject('cyrinx_capture_invalid');
    if (pcm.firstSampleIndex !== active.nextSampleIndex) return this.reject('cyrinx_capture_discontinuity');
    if (active.samples + sampleCount > CYRINX_CAPTURE_WINDOW_SAMPLES) return this.reject('cyrinx_capture_overflow');

    this.#lastCaptureSequence = frame.sequence;
    active.nextSampleIndex += BigInt(sampleCount);
    active.chunks.push(pcm.samples);
    active.samples += sampleCount;
    active.pendingHighWaterMs = Math.max(active.pendingHighWaterMs, sampleCount / CYRINX_SAMPLE_RATE * 1_000);
    active.pendingBytes -= encoded.byteLength;
    if (active.samples < CYRINX_CAPTURE_WINDOW_SAMPLES) return undefined;

    active.decoded = true;
    const generation = active.generation;
    let response;
    try {
      response = await (this.options.run ?? runPinnedCommand)({
        executable: this.options.executable,
        command: 'decode',
        payload: Buffer.concat(active.chunks, CYRINX_CAPTURE_WINDOW_SAMPLES * Float32Array.BYTES_PER_ELEMENT),
        signal: active.abort.signal,
      });
    } catch {
      if (!this.isCurrent(generation)) return undefined;
      return this.reject('cyrinx_decode_failed');
    }
    if (!this.isCurrent(generation)) return undefined;
    if (response.timedOut) return this.reject('cyrinx_process_timeout');
    if (response.exitCode !== 0) return this.reject('cyrinx_decode_failed');

    const body = Buffer.from(response.stdout);
    const bytes = active.value.payload.byteLength;
    if (
      body.byteLength !== 289 + bytes
      || body.toString('ascii', 0, 4) !== 'CYRR'
      || body.readUInt8(4) !== 1
      || body.readUInt32LE(5) !== bytes
      || body.readUInt32LE(9) !== 7
      || body.readUInt32LE(13) !== 7
      || !Number.isFinite(body.readDoubleLE(25))
      || !body.subarray(33, 289).equals(active.metadata)
      || !body.subarray(289).equals(Buffer.from(active.value.payload))
    ) return this.reject('cyrinx_native_result_invalid');

    const digest = createHash('sha256').update(body.subarray(289)).digest('hex');
    const now = (this.options.now ?? Date.now)();
    const result: CyrinxResult = {
      epoch: active.epoch,
      direction: active.value.direction,
      caseId: active.value.id,
      digest,
      acquisitionMs: Math.max(0, now - active.startedAt),
      airtimeMs: body.readUInt32LE(21),
      complete: digest === active.value.digest,
      corrupt: digest !== active.value.digest,
      missing: 0,
      duplicates: 0,
      deliveryCount: 1,
      bytePerfect: digest === active.value.digest,
      coldAcquired: true,
      queues: {
        captureHighWaterBytes: active.pendingHighWaterBytes,
        captureHighWaterMs: active.pendingHighWaterMs,
        playbackHighWaterBytes: 0,
        playbackHighWaterMs: 0,
        discontinuities: 0,
      },
    };
    this.#delivered.add(this.identity(active.value, active.epoch));
    this.clearActive(false);
    return result;
  }

  reset(): void {
    this.clearActive(true);
    this.#epoch = undefined;
    this.#outboundSequence = 0n;
    this.#playbackSampleIndex = 0n;
    this.#lastCaptureSequence = -1n;
    this.#delivered.clear();
  }

  private identity(value: CyrinxCase, epoch: number): string {
    return `${epoch}\u0000${value.direction}\u0000${value.id}`;
  }

  private isCurrent(generation: number): boolean {
    return this.#active?.generation === generation;
  }

  private clearActive(abort: boolean): void {
    const active = this.#active;
    this.#active = undefined;
    this.#generation += 1;
    if (abort) active?.abort.abort();
  }

  private reject(reason: string): never {
    this.clearActive(true);
    throw new Error(reason);
  }
}

function responseReason(command: 'encode' | 'decode'): string {
  return command === 'encode' ? 'cyrinx_encode_failed' : 'cyrinx_decode_failed';
}

export const CYRINX_WORKER_PROFILE = CYRINX_PROFILE;
