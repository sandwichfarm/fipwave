import { describe, expect, it } from 'vitest';

import {
  decodeFrame,
  encodeFrame,
  MAX_MESSAGE_BYTES,
  MessageType,
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
      payload: Buffer.alloc(3),
    })).toThrow('aligned');
    expect(() => encodeFrame({
      type: MessageType.PCM_PLAYBACK,
      epoch: 1,
      sequence: 0n,
      sampleRate: 0,
      channels: 1,
      encoding: PcmEncoding.FLOAT32_LE,
      payload: Buffer.alloc(4),
    })).toThrow('sample rate');
    expect(() => encodeFrame({
      type: MessageType.HELLO,
      epoch: 1,
      sequence: 0n,
      payload: Buffer.alloc(MAX_MESSAGE_BYTES),
    })).toThrow('256 KiB');
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
