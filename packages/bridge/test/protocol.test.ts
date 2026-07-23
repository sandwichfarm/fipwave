import { describe, expect, it } from 'vitest';

import {
  decodePcmPayload,
  decodeFrame,
  encodePcmPayload,
  encodeFrame,
  MAX_MESSAGE_BYTES,
  MessageType,
  PCM_SAMPLE_INDEX_BYTES,
  PcmEncoding,
  EpochTracker,
} from '../src/protocol.js';

describe('FWAV v1', () => {
  it('round-trips a qualification case byte-for-byte', () => {
    const payload = Buffer.alloc(256, 0xa5);
    const decoded = decodeFrame(encodeFrame({
      type: MessageType.QUALIFICATION_CASE,
      epoch: 9,
      sequence: 12n,
      payload,
    }));

    expect(decoded).toMatchObject({
      type: MessageType.QUALIFICATION_CASE,
      epoch: 9,
      sequence: 12n,
    });
    expect(decoded.payload.equals(payload)).toBe(true);
  });

  it.each([
    ['wrong magic', (frame: Buffer) => frame.write('NOPE', 0, 'ascii')],
    ['wrong version', (frame: Buffer) => frame.writeUInt8(2, 4)],
    ['unknown type', (frame: Buffer) => frame.writeUInt8(99, 5)],
    ['wrong length', (frame: Buffer) => frame.writeUInt32LE(1, 8)],
  ])('rejects %s', (_name, edit) => {
    const frame = encodeFrame({ type: MessageType.HELLO, epoch: 1, sequence: 0n, payload: Buffer.from('ok') });
    edit(frame);
    expect(() => decodeFrame(frame)).toThrow();
  });

  it('validates PCM declarations and the message cap before processing payloads', () => {
    expect(() => encodeFrame({
      type: MessageType.PCM_CAPTURE,
      epoch: 1,
      sequence: 0n,
      sampleRate: 48_000,
      channels: 1,
      encoding: PcmEncoding.FLOAT32_LE,
      payload: Buffer.alloc(PCM_SAMPLE_INDEX_BYTES + 3),
    })).toThrow('aligned');
    expect(() => encodeFrame({
      type: MessageType.PCM_PLAYBACK,
      epoch: 1,
      sequence: 0n,
      sampleRate: 0,
      channels: 1,
      encoding: PcmEncoding.FLOAT32_LE,
      payload: encodePcmPayload(0n, Buffer.alloc(4)),
    })).toThrow('sample rate');
    expect(() => encodeFrame({
      type: MessageType.HELLO,
      epoch: 1,
      sequence: 0n,
      payload: Buffer.alloc(MAX_MESSAGE_BYTES),
    })).toThrow('256 KiB');
  });

  it('round-trips transport sequence independently from the exact PCM sample index', () => {
    const samples = Buffer.alloc(8);
    samples.writeFloatLE(0.25, 0);
    samples.writeFloatLE(-0.5, 4);
    const decoded = decodeFrame(encodeFrame({
      type: MessageType.PCM_CAPTURE,
      epoch: 7,
      sequence: 91n,
      sampleRate: 48_000,
      channels: 1,
      encoding: PcmEncoding.FLOAT32_LE,
      payload: encodePcmPayload(131_072n, samples),
    }));
    const pcm = decodePcmPayload(decoded.payload, decoded.channels!);

    expect(decoded.sequence).toBe(91n);
    expect(pcm.firstSampleIndex).toBe(131_072n);
    expect(pcm.samples.equals(samples)).toBe(true);
  });

  it('rejects missing, malformed, or out-of-range PCM sample indices', () => {
    expect(() => decodePcmPayload(Buffer.alloc(PCM_SAMPLE_INDEX_BYTES), 1)).toThrow('sample-index');
    expect(() => decodePcmPayload(Buffer.alloc(PCM_SAMPLE_INDEX_BYTES + 4), 0)).toThrow('channel');
    expect(() => encodePcmPayload(-1n, Buffer.alloc(4))).toThrow('sample index');
    expect(() => encodePcmPayload(0x1_0000_0000_0000_0000n, Buffer.alloc(4))).toThrow('sample index');
  });

  it('increments epoch on reset and rejects stale or duplicate frames', () => {
    const tracker = new EpochTracker();
    const frame = { type: MessageType.HELLO, epoch: 0, sequence: 1n, payload: Buffer.alloc(0) };
    tracker.accept(frame);
    expect(() => tracker.accept(frame)).toThrow('duplicate');
    tracker.reset();
    expect(() => tracker.accept(frame)).toThrow('stale epoch');
  });
});
