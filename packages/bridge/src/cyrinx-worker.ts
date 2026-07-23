import { createHash } from 'node:crypto';

import { CYRINX_PROFILE, type CyrinxCommand, type PinnedCommandRunner } from './codecs/command.js';
import { decodeFrame, decodePcmPayload, encodeFrame, encodePcmPayload, MessageType, PcmEncoding, type FwavFrame } from './protocol.js';
import type { LiteralDirection } from './report.js';

const FRAME_SAMPLES = 62_464;
const PCM_BYTES = FRAME_SAMPLES * 4;
const CAPTURE_WINDOW_SAMPLES = 131_072;
const METADATA_BYTES = 256;

export interface CyrinxCase { id: string; direction: LiteralDirection; payload: Uint8Array; digest: string; }
export interface CyrinxResult { caseId: string; digest: string | null; acquisitionMs: number; airtimeMs: number; complete: boolean; corrupt: boolean; missing: number; duplicates: number; deliveryCount: number; bytePerfect: boolean; coldAcquired: boolean; queues: { captureHighWaterBytes: number; captureHighWaterMs: number; playbackHighWaterBytes: number; playbackHighWaterMs: number; discontinuities: number }; }
export interface CyrinxWorkerOptions { executable: string; run: PinnedCommandRunner; now?: () => number; }

function metadata(input: CyrinxCase, epoch: number): Buffer {
  if (input.payload.byteLength > 1536 || !/^[a-f0-9]{64}$/i.test(input.digest) || !/^[A-Za-z0-9._-]{1,64}$/.test(input.id)) throw new Error('cyrinx case metadata is invalid');
  const output = Buffer.alloc(METADATA_BYTES); output.write('CYRX', 0, 'ascii'); output.writeUInt8(1, 4); output.writeUInt32LE(epoch, 5); output.writeUInt8(input.direction === 'A → B' ? 0 : 1, 9); output.write(input.id, 11, 'utf8'); output.writeUInt32LE(input.payload.byteLength, 75); Buffer.from(input.digest, 'hex').copy(output, 79); return output;
}
function request(meta: Buffer, payload: Uint8Array): Buffer { const output = Buffer.alloc(4 + meta.byteLength + payload.byteLength); output.writeUInt32LE(payload.byteLength, 0); meta.copy(output, 4); Buffer.from(payload).copy(output, 260); return output; }

/** One case, one native child command at a time; capture aggregation never becomes a bridge queue. */
export class CyrinxBatchWorker {
  #active: { epoch: number; generation: number; value: CyrinxCase; metadata: Buffer; startedAt: number; chunks: Buffer[]; samples: number; decoded: boolean; captureHighWaterBytes: number; lastSequence: bigint; nextSampleIndex: bigint } | undefined;
  #generation = 0;
  #sequence = 0n;
  #delivered = new Set<string>();
  constructor(private readonly options: CyrinxWorkerOptions) {}

  async begin(value: CyrinxCase, epoch: number): Promise<Buffer> {
    if (this.#active) throw new Error('cyrinx worker already owns a case');
    const meta = metadata(value, epoch); const generation = ++this.#generation; const startedAt = (this.options.now ?? Date.now)();
    const identity = `${epoch}\u0000${value.direction}\u0000${value.id}`; if (this.#delivered.has(identity)) throw new Error('cyrinx_duplicate_case');
    this.#active = { epoch, generation, value, metadata: meta, startedAt, chunks: [], samples: 0, decoded: false, captureHighWaterBytes: 0, lastSequence: -1n, nextSampleIndex: 0n };
    const response = await this.options.run({ executable: this.options.executable, command: 'encode', payload: request(meta, value.payload) });
    if (!this.#active || this.#active.generation !== generation || response.timedOut || response.exitCode !== 0 || response.stdout.byteLength !== PCM_BYTES) { this.clear(); throw new Error('cyrinx_encode_failed'); }
    return encodeFrame({ type: MessageType.PCM_PLAYBACK, flags: 1, epoch, sequence: this.nextSequence(), sampleRate: 48_000, channels: 1, encoding: PcmEncoding.FLOAT32_LE, payload: encodePcmPayload(0n, Buffer.from(response.stdout)) });
  }

  async receiveCapture(encoded: Buffer): Promise<CyrinxResult | undefined> {
    const active = this.#active; if (!active || active.decoded) return undefined;
    const frame = decodeFrame(encoded); if (frame.type !== MessageType.PCM_CAPTURE || frame.epoch !== active.epoch || frame.channels !== 1 || frame.sampleRate !== 48_000 || frame.sequence <= active.lastSequence) return this.reject('cyrinx_capture_invalid');
    const pcm = decodePcmPayload(frame.payload, 1); const samples = pcm.samples.byteLength / 4;
    if (pcm.firstSampleIndex !== active.nextSampleIndex || active.samples + samples > CAPTURE_WINDOW_SAMPLES) return this.reject('cyrinx_capture_discontinuity');
    active.lastSequence = frame.sequence; active.nextSampleIndex += BigInt(samples); active.chunks.push(pcm.samples); active.samples += samples; active.captureHighWaterBytes = Math.max(active.captureHighWaterBytes, frame.payload.byteLength + 32);
    if (active.samples < CAPTURE_WINDOW_SAMPLES) return undefined;
    active.decoded = true; const generation = active.generation; const response = await this.options.run({ executable: this.options.executable, command: 'decode', payload: Buffer.concat(active.chunks) });
    if (!this.#active || this.#active.generation !== generation) return undefined;
    if (response.timedOut || response.exitCode !== 0) return this.reject(response.timedOut ? 'cyrinx_process_timeout' : 'cyrinx_decode_failed');
    const body = Buffer.from(response.stdout); const bytes = active.value.payload.byteLength;
    if (body.byteLength !== 289 + bytes || body.toString('ascii', 0, 4) !== 'CYRR' || body.readUInt8(4) !== 1 || body.readUInt32LE(5) !== bytes || body.readUInt32LE(9) !== 7 || body.readUInt32LE(13) !== 7 || !body.subarray(33, 289).equals(active.metadata) || !body.subarray(289).equals(Buffer.from(active.value.payload))) return this.reject('cyrinx_native_result_invalid');
    const digest = createHash('sha256').update(body.subarray(289)).digest('hex'); const now = (this.options.now ?? Date.now)(); const result: CyrinxResult = { caseId: active.value.id, digest, acquisitionMs: Math.max(0, now - active.startedAt), airtimeMs: body.readUInt32LE(21), complete: digest === active.value.digest, corrupt: digest !== active.value.digest, missing: 0, duplicates: 0, deliveryCount: 1, bytePerfect: digest === active.value.digest, coldAcquired: true, queues: { captureHighWaterBytes: active.captureHighWaterBytes, captureHighWaterMs: active.captureHighWaterBytes / 192, playbackHighWaterBytes: PCM_BYTES, playbackHighWaterMs: FRAME_SAMPLES / 48, discontinuities: 0 } };
    this.#delivered.add(`${active.epoch}\u0000${active.value.direction}\u0000${active.value.id}`);
    this.clear(); return result;
  }
  reset(): void { this.clear(); }
  private nextSequence(): bigint { const value = this.#sequence; this.#sequence += 1n; return value; }
  private clear(): void { this.#generation += 1; this.#active = undefined; }
  private reject(reason: string): never { this.clear(); throw new Error(reason); }
}

export const CYRINX_WORKER_PROFILE = CYRINX_PROFILE;
