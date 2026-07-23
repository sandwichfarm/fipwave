import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  CYRINX_CAPTURE_WINDOW_SAMPLES,
  CYRINX_FRAME_SAMPLES,
  CYRINX_GUARD_SAMPLES,
  CyrinxBatchWorker,
  type CyrinxCase,
} from '../packages/bridge/src/cyrinx-worker.js';
import { NativeCommandCodecAdapter, runPinnedCommand, type PinnedCommandRunner } from '../packages/bridge/src/codecs/command.js';
import {
  CYRINX_PCM_PLAYBACK_FLAG,
  decodeFrame,
  decodePcmPayload,
  encodeFrame,
  encodePcmPayload,
  MessageType,
  PcmEncoding,
} from '../packages/bridge/src/protocol.js';

const payload = new Uint8Array(256).fill(7);
const digest = createHash('sha256').update(payload).digest('hex');
const qualificationCase: CyrinxCase = { id: 'a-to-b-256-01', direction: 'A → B', payload, digest };
const secondCase: CyrinxCase = { ...qualificationCase, id: 'a-to-b-256-02' };
const EPOCH = 4;
const BATCH_SAMPLES = 2_048;
const BATCH_COUNT = CYRINX_CAPTURE_WINDOW_SAMPLES / BATCH_SAMPLES;

function caseMetadata(value = qualificationCase, epoch = EPOCH): Buffer {
  const output = Buffer.alloc(256);
  output.write('CYRX', 0, 'ascii');
  output.writeUInt8(1, 4);
  output.writeUInt32LE(epoch, 5);
  output.writeUInt8(value.direction === 'A → B' ? 0 : 1, 9);
  output.write(value.id, 11, 'utf8');
  output.writeUInt32LE(value.payload.byteLength, 75);
  Buffer.from(value.digest, 'hex').copy(output, 79);
  return output;
}

function decoded(value = qualificationCase, epoch = EPOCH, edit?: (output: Buffer) => void): Buffer {
  const output = Buffer.alloc(289 + value.payload.byteLength);
  output.write('CYRR', 0, 'ascii');
  output.writeUInt8(1, 4);
  output.writeUInt32LE(value.payload.byteLength, 5);
  output.writeUInt32LE(7, 9);
  output.writeUInt32LE(7, 13);
  output.writeUInt32LE(0, 17);
  output.writeUInt32LE(1_302, 21);
  output.writeDoubleLE(0.01, 25);
  caseMetadata(value, epoch).copy(output, 33);
  Buffer.from(value.payload).copy(output, 289);
  edit?.(output);
  return output;
}

function capture(options: {
  epoch?: number;
  sequence: bigint;
  firstSampleIndex: bigint;
  samples?: number;
  sampleRate?: number;
  channels?: number;
  type?: MessageType;
  flags?: number;
  nan?: boolean;
}): Buffer {
  const channels = options.channels ?? 1;
  const samples = Buffer.alloc((options.samples ?? BATCH_SAMPLES) * channels * Float32Array.BYTES_PER_ELEMENT);
  if (options.nan) samples.writeFloatLE(Number.NaN, 0);
  return encodeFrame({
    type: options.type ?? MessageType.PCM_CAPTURE,
    flags: options.flags ?? 0,
    epoch: options.epoch ?? EPOCH,
    sequence: options.sequence,
    sampleRate: options.sampleRate ?? 48_000,
    channels,
    encoding: PcmEncoding.FLOAT32_LE,
    payload: encodePcmPayload(options.firstSampleIndex, samples),
  });
}

async function feedWindow(worker: CyrinxBatchWorker, sequenceStart = 1n) {
  for (let index = 0; index < BATCH_COUNT - 1; index += 1) {
    expect(await worker.receiveCapture(capture({
      sequence: sequenceStart + BigInt(index),
      firstSampleIndex: BigInt(index * BATCH_SAMPLES),
    }))).toBeUndefined();
  }
  return worker.receiveCapture(capture({
    sequence: sequenceStart + BigInt(BATCH_COUNT - 1),
    firstSampleIndex: BigInt((BATCH_COUNT - 1) * BATCH_SAMPLES),
  }));
}

function encodeRunner(): PinnedCommandRunner {
  return vi.fn(async ({ command }) => {
    if (command !== 'encode') throw new Error('unexpected command');
    return { exitCode: 0, stdout: Buffer.alloc(CYRINX_FRAME_SAMPLES * 4), stderr: '', timedOut: false };
  });
}

function listenRunner(value = qualificationCase, epoch = EPOCH): PinnedCommandRunner {
  return vi.fn(async ({ command, payload: input }) => {
    if (command !== 'decode') throw new Error('unexpected command');
    expect(input.byteLength).toBe(CYRINX_CAPTURE_WINDOW_SAMPLES * 4);
    return { exitCode: 0, stdout: decoded(value, epoch), stderr: '', timedOut: false };
  });
}

describe('bounded Cyrinx worker', () => {
  it('separates transmit playback from listen capture and reports only independent receiver evidence', async () => {
    const transmitterRun = encodeRunner();
    const transmitter = new CyrinxBatchWorker({ executable: '/pinned/cyrinx', run: transmitterRun });
    const playback = await transmitter.begin(qualificationCase, EPOCH, 'transmit');
    expect(playback).toBeInstanceOf(Buffer);
    const frame = decodeFrame(playback!);
    const pcm = decodePcmPayload(frame.payload, frame.channels!);
    expect(frame).toMatchObject({
      type: MessageType.PCM_PLAYBACK,
      flags: CYRINX_PCM_PLAYBACK_FLAG,
      epoch: EPOCH,
      sequence: 0n,
      sampleRate: 48_000,
      channels: 1,
    });
    expect(pcm.firstSampleIndex).toBe(0n);
    expect(pcm.samples.byteLength).toBe(CYRINX_FRAME_SAMPLES * 4);
    expect(playback!.byteLength).toBe(249_896);
    expect(await transmitter.receiveCapture(capture({ sequence: 1n, firstSampleIndex: 0n }))).toBeUndefined();
    expect(transmitterRun).toHaveBeenCalledTimes(1);

    const receiverRun = listenRunner();
    let physicalNow = 1_000;
    const receiver = new CyrinxBatchWorker({ executable: '/pinned/cyrinx', run: receiverRun, now: () => physicalNow });
    expect(await receiver.begin(qualificationCase, EPOCH, 'listen')).toBeUndefined();
    physicalNow = 3_875;
    const result = await feedWindow(receiver);
    expect(result).toMatchObject({
      epoch: EPOCH,
      direction: 'A → B',
      caseId: qualificationCase.id,
      complete: true,
      deliveryCount: 1,
      acquisitionMs: 2_875,
      coldAcquired: true,
      airtimeMs: 1_302,
      queues: {
        captureHighWaterBytes: 8_232,
        captureHighWaterMs: BATCH_SAMPLES / 48,
        playbackHighWaterBytes: 0,
        playbackHighWaterMs: 0,
        discontinuities: 0,
      },
    });
    expect(receiverRun).toHaveBeenCalledTimes(1);
  });

  it('keeps digital native acquisition diagnostic and never asserts physical cold or audio evidence', async () => {
    const run: PinnedCommandRunner = vi.fn(async ({ command }) => {
      if (command === 'encode') return { exitCode: 0, stdout: Buffer.alloc(CYRINX_FRAME_SAMPLES * 4), stderr: '', timedOut: false };
      return {
        exitCode: 0,
        stdout: decoded(qualificationCase, EPOCH, (body) => body.writeUInt32LE(321, 17)),
        stderr: '',
        timedOut: false,
      };
    });
    const adapter = new NativeCommandCodecAdapter({ executable: '/pinned/cyrinx', runner: run });

    const result = await adapter.qualify(
      { ...qualificationCase, size: 256 },
      { epoch: EPOCH, evidenceClass: 'Open air', nowMs: 0 },
    );

    expect(result).toMatchObject({
      complete: true,
      bytePerfect: true,
      acquisitionMs: 321,
      coldAcquired: false,
      audioPassed: false,
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('uses a continuous playback timeline including the local guard across cases', async () => {
    const worker = new CyrinxBatchWorker({ executable: '/pinned/cyrinx', run: encodeRunner() });
    const first = decodePcmPayload(decodeFrame((await worker.begin(qualificationCase, EPOCH, 'transmit'))!).payload, 1);
    const secondFrame = decodeFrame((await worker.begin(secondCase, EPOCH, 'transmit'))!);
    const second = decodePcmPayload(secondFrame.payload, 1);

    expect(first.firstSampleIndex).toBe(0n);
    expect(second.firstSampleIndex).toBe(BigInt(CYRINX_FRAME_SAMPLES + CYRINX_GUARD_SAMPLES));
    expect(secondFrame.sequence).toBe(1n);
  });

  it('requires an exact 131072-sample relative-zero capture window and keeps pending queue evidence separate from decode memory', async () => {
    const run = listenRunner();
    const worker = new CyrinxBatchWorker({ executable: '/pinned/cyrinx', run });
    await worker.begin(qualificationCase, EPOCH, 'listen');
    for (let index = 0; index < BATCH_COUNT - 1; index += 1) {
      await worker.receiveCapture(capture({ sequence: BigInt(index + 10), firstSampleIndex: BigInt(index * BATCH_SAMPLES) }));
    }
    expect(run).not.toHaveBeenCalled();

    const result = await worker.receiveCapture(capture({
      sequence: BigInt(BATCH_COUNT + 9),
      firstSampleIndex: BigInt((BATCH_COUNT - 1) * BATCH_SAMPLES),
    }));
    expect(run).toHaveBeenCalledOnce();
    expect(result!.queues.captureHighWaterBytes).toBeLessThan(256 * 1_024);
    expect(result!.queues.captureHighWaterBytes).not.toBe(CYRINX_CAPTURE_WINDOW_SAMPLES * 4);
  });

  it.each([
    ['stale epoch', () => capture({ epoch: EPOCH + 1, sequence: 1n, firstSampleIndex: 0n }), 'capture_invalid'],
    ['wrong message type', () => capture({ type: MessageType.PCM_PLAYBACK, sequence: 1n, firstSampleIndex: 0n }), 'capture_invalid'],
    ['nonzero flags', () => capture({ flags: 1, sequence: 1n, firstSampleIndex: 0n }), 'capture_invalid'],
    ['wrong sample rate', () => capture({ sampleRate: 44_100, sequence: 1n, firstSampleIndex: 0n }), 'capture_invalid'],
    ['stereo capture', () => capture({ channels: 2, sequence: 1n, firstSampleIndex: 0n }), 'capture_invalid'],
    ['non-finite PCM', () => capture({ nan: true, sequence: 1n, firstSampleIndex: 0n }), 'capture_invalid'],
    ['nonzero relative origin', () => capture({ sequence: 1n, firstSampleIndex: 2_048n }), 'capture_discontinuity'],
  ])('rejects and clears %s', async (_name, frame, reason) => {
    const worker = new CyrinxBatchWorker({ executable: '/pinned/cyrinx', run: listenRunner() });
    await worker.begin(qualificationCase, EPOCH, 'listen');
    await expect(worker.receiveCapture(frame())).rejects.toThrow(reason);
    await expect(worker.begin(secondCase, EPOCH, 'listen')).resolves.toBeUndefined();
  });

  it('rejects transport replay, sample gaps, and capture overflow with distinct reasons', async () => {
    const replay = new CyrinxBatchWorker({ executable: '/pinned/cyrinx', run: listenRunner() });
    await replay.begin(qualificationCase, EPOCH, 'listen');
    await replay.receiveCapture(capture({ sequence: 1n, firstSampleIndex: 0n }));
    await expect(replay.receiveCapture(capture({ sequence: 1n, firstSampleIndex: 2_048n }))).rejects.toThrow('cyrinx_capture_replay');

    const gap = new CyrinxBatchWorker({ executable: '/pinned/cyrinx', run: listenRunner() });
    await gap.begin(qualificationCase, EPOCH, 'listen');
    await gap.receiveCapture(capture({ sequence: 1n, firstSampleIndex: 0n }));
    await expect(gap.receiveCapture(capture({ sequence: 2n, firstSampleIndex: 4_096n }))).rejects.toThrow('cyrinx_capture_discontinuity');

    const overflow = new CyrinxBatchWorker({ executable: '/pinned/cyrinx', run: listenRunner() });
    await overflow.begin(qualificationCase, EPOCH, 'listen');
    for (let index = 0; index < BATCH_COUNT - 1; index += 1) {
      await overflow.receiveCapture(capture({ sequence: BigInt(index + 1), firstSampleIndex: BigInt(index * BATCH_SAMPLES) }));
    }
    await expect(overflow.receiveCapture(capture({
      sequence: BigInt(BATCH_COUNT),
      firstSampleIndex: BigInt((BATCH_COUNT - 1) * BATCH_SAMPLES),
      samples: BATCH_SAMPLES + 1,
    }))).rejects.toThrow('cyrinx_capture_overflow');
  });

  it.each([
    ['timeout', { exitCode: 1, timedOut: true, stdout: Buffer.alloc(0) }, 'cyrinx_process_timeout'],
    ['nonzero exit', { exitCode: 9, timedOut: false, stdout: Buffer.alloc(0) }, 'cyrinx_decode_failed'],
    ['malformed output', { exitCode: 0, timedOut: false, stdout: Buffer.from('bad') }, 'cyrinx_native_result_invalid'],
    ['invalid block count', { exitCode: 0, timedOut: false, stdout: decoded(qualificationCase, EPOCH, (body) => body.writeUInt32LE(6, 9)) }, 'cyrinx_native_result_invalid'],
    ['non-finite EVM', { exitCode: 0, timedOut: false, stdout: decoded(qualificationCase, EPOCH, (body) => body.writeDoubleLE(Number.NaN, 25)) }, 'cyrinx_native_result_invalid'],
  ])('rejects native decode %s', async (_name, response, reason) => {
    const worker = new CyrinxBatchWorker({
      executable: '/pinned/cyrinx',
      run: async () => ({ ...response, stderr: '' }),
    });
    await worker.begin(qualificationCase, EPOCH, 'listen');
    await expect(feedWindow(worker)).rejects.toThrow(reason);
  });

  it.each([
    ['timeout', { exitCode: 1, timedOut: true, stdout: Buffer.alloc(0) }, 'cyrinx_process_timeout'],
    ['nonzero exit', { exitCode: 7, timedOut: false, stdout: Buffer.alloc(0) }, 'cyrinx_encode_failed'],
    ['wrong geometry', { exitCode: 0, timedOut: false, stdout: Buffer.alloc(4) }, 'cyrinx_encode_failed'],
  ])('rejects native encode %s', async (_name, response, reason) => {
    const worker = new CyrinxBatchWorker({
      executable: '/pinned/cyrinx',
      run: async () => ({ ...response, stderr: '' }),
    });
    await expect(worker.begin(qualificationCase, EPOCH, 'transmit')).rejects.toThrow(reason);
  });

  it('aborts native work on reset and suppresses a late same-generation result', async () => {
    let resolveDecode!: (value: Awaited<ReturnType<PinnedCommandRunner>>) => void;
    let decodeSignal: AbortSignal | undefined;
    const run: PinnedCommandRunner = vi.fn(({ signal }) => {
      decodeSignal = signal;
      return new Promise<Awaited<ReturnType<PinnedCommandRunner>>>((resolve) => { resolveDecode = resolve; });
    });
    const worker = new CyrinxBatchWorker({ executable: '/pinned/cyrinx', run });
    await worker.begin(qualificationCase, EPOCH, 'listen');
    const pending = feedWindow(worker);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

    worker.reset();
    expect(decodeSignal?.aborted).toBe(true);
    resolveDecode({ exitCode: 0, timedOut: false, stderr: '', stdout: decoded() });
    await expect(pending).resolves.toBeUndefined();
  });

  it('aborts an in-flight transmitter encode and emits no late playback', async () => {
    let resolveEncode!: (value: Awaited<ReturnType<PinnedCommandRunner>>) => void;
    let encodeSignal: AbortSignal | undefined;
    const run: PinnedCommandRunner = ({ signal }) => {
      encodeSignal = signal;
      return new Promise((resolve) => { resolveEncode = resolve; });
    };
    const worker = new CyrinxBatchWorker({ executable: '/pinned/cyrinx', run });
    const pending = worker.begin(qualificationCase, EPOCH, 'transmit');
    await vi.waitFor(() => expect(encodeSignal).toBeDefined());

    worker.reset();
    expect(encodeSignal?.aborted).toBe(true);
    resolveEncode({ exitCode: 0, timedOut: false, stderr: '', stdout: Buffer.alloc(CYRINX_FRAME_SAMPLES * 4) });
    await expect(pending).rejects.toThrow('cyrinx_operation_cancelled');
  });

  it('deduplicates a delivered case but permits the next case with lifetime-global transport sequence', async () => {
    let decodedCase = qualificationCase;
    const run: PinnedCommandRunner = vi.fn(async () => ({ exitCode: 0, stdout: decoded(decodedCase), stderr: '', timedOut: false }));
    const worker = new CyrinxBatchWorker({ executable: '/pinned/cyrinx', run });
    await worker.begin(qualificationCase, EPOCH, 'listen');
    await feedWindow(worker);
    await expect(worker.begin(qualificationCase, EPOCH, 'listen')).rejects.toThrow('cyrinx_duplicate_case');

    decodedCase = secondCase;
    await worker.begin(secondCase, EPOCH, 'listen');
    await expect(feedWindow(worker, BigInt(BATCH_COUNT + 1))).resolves.toMatchObject({ caseId: secondCase.id });
  });
});

describe('pinned native process cancellation', () => {
  it('kills an in-flight child through AbortSignal', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-abort-'));
    const executable = path.join(directory, 'hang.mjs');
    await writeFile(executable, '#!/usr/bin/env node\nsetInterval(() => undefined, 1000);\n', 'utf8');
    await chmod(executable, 0o700);
    const controller = new AbortController();
    try {
      const pending = runPinnedCommand({ executable, command: 'decode', payload: Buffer.alloc(4), timeoutMs: 30_000, signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toThrow('aborted');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
