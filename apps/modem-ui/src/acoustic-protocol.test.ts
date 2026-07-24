import { describe, expect, it } from 'vitest';

import {
  FAS1_HEADER_BYTES,
  FAS1_MAX_BODY_BYTES,
  FAS1_MAX_PACKET_BYTES,
  FAS1_MAX_UNIT_BYTES,
  Fas1UnitType,
  crc32c,
  decodeFas1,
  encodeFas1,
  fragmentPacket,
  reassemblePacket,
} from './acoustic-protocol.js';

const SESSION = 0x1020_3040_5060_7080n;

function validUnit(type: Fas1UnitType) {
  const bodyless = [Fas1UnitType.TurnEnd, Fas1UnitType.Ack, Fas1UnitType.Heartbeat, Fas1UnitType.Reset].includes(type);
  return {
    type,
    flags: 0,
    sessionId: type === Fas1UnitType.Hello ? 0n : SESSION,
    sequence: 7,
    packetId: type === Fas1UnitType.Data ? 99 : 0,
    fragmentIndex: 0,
    fragmentCount: type === Fas1UnitType.Data ? 1 : 0,
    packetLength: type === Fas1UnitType.Data ? 1 : 0,
    body: bodyless ? new Uint8Array() : Uint8Array.of(type),
  };
}

function mutate(frame: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = frame.slice();
  copy[offset] = value;
  return copy;
}

describe('FAS1 binary protocol', () => {
  it('uses the exact Quiet-safe geometry and CRC-32C implementation', () => {
    expect(FAS1_HEADER_BYTES).toBe(36);
    expect(FAS1_MAX_BODY_BYTES).toBe(217);
    expect(FAS1_MAX_UNIT_BYTES).toBe(253);
    expect(FAS1_MAX_PACKET_BYTES).toBe(1357);
    expect(crc32c(new TextEncoder().encode('123456789'))).toBe(0xe306_9283);
  });

  it('round-trips every documented unit type with exact little-endian fields', () => {
    for (const type of Object.values(Fas1UnitType).filter((value): value is Fas1UnitType => typeof value === 'number')) {
      const source = validUnit(type);
      const encoded = encodeFas1(source);
      expect(encoded).toHaveLength(FAS1_HEADER_BYTES + source.body.byteLength);
      expect([...encoded.slice(0, 4)]).toEqual([0x46, 0x41, 0x53, 0x31]);
      expect(new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength).getBigUint64(8, true)).toBe(source.sessionId);
      expect(decodeFas1(encoded)).toEqual(source);
    }
  });

  it('rejects hostile header mutations without exposing partial data', () => {
    const encoded = encodeFas1(validUnit(Fas1UnitType.Data));
    const malformed = [
      mutate(encoded, 0, 0),
      mutate(encoded, 4, 2),
      mutate(encoded, 5, 0xff),
      mutate(encoded, 6, 1),
      mutate(encoded, 16, 0),
      mutate(encoded, 20, 0),
      mutate(encoded, 24, 1),
      mutate(encoded, 26, 0),
      mutate(encoded, 28, 0),
      mutate(encoded, 30, 2),
      mutate(encoded, 32, encoded[32]! ^ 0xff),
    ];
    for (const frame of malformed) expect(() => decodeFas1(frame)).toThrow();
    expect(() => decodeFas1(new Uint8Array())).toThrow();
    expect(() => decodeFas1(new Uint8Array(FAS1_MAX_UNIT_BYTES + 1))).toThrow();
  });

  it('enforces type-specific empty body and session rules', () => {
    expect(() => encodeFas1({ ...validUnit(Fas1UnitType.Hello), body: new Uint8Array() })).toThrow();
    expect(() => encodeFas1({ ...validUnit(Fas1UnitType.Caps), sessionId: 0n })).toThrow();
    expect(() => encodeFas1({ ...validUnit(Fas1UnitType.Ack), body: Uint8Array.of(1) })).toThrow();
    expect(() => encodeFas1({ ...validUnit(Fas1UnitType.Data), body: new Uint8Array() })).toThrow();
  });

  it('accepts exact maximum body/unit and rejects every one-over boundary', () => {
    const maximum = { ...validUnit(Fas1UnitType.Data), packetLength: FAS1_MAX_BODY_BYTES, body: new Uint8Array(FAS1_MAX_BODY_BYTES) };
    expect(encodeFas1(maximum)).toHaveLength(FAS1_MAX_UNIT_BYTES);
    expect(() => encodeFas1({ ...maximum, body: new Uint8Array(FAS1_MAX_BODY_BYTES + 1) })).toThrow();
    expect(() => encodeFas1({ ...maximum, packetLength: FAS1_MAX_PACKET_BYTES + 1 })).toThrow();
    expect(() => encodeFas1({ ...maximum, sequence: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  });

  it('fragments and exactly reassembles a complete 1357-byte packet in seven maximum-body DATA units', () => {
    const packet = new Uint8Array(FAS1_MAX_PACKET_BYTES).map((_, index) => index & 0xff);
    const fragments = fragmentPacket({ packet, sessionId: SESSION, sequenceStart: 100, packetId: 42 });
    expect(fragments).toHaveLength(7);
    expect(fragments.every((fragment) => fragment.body.byteLength <= FAS1_MAX_BODY_BYTES)).toBe(true);
    expect(fragments.map((fragment) => fragment.fragmentIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(reassemblePacket(fragments)).toEqual(packet);
  });

  it('rejects packet and fragment geometry at zero, one-over, and unsafe boundaries', () => {
    expect(() => fragmentPacket({ packet: new Uint8Array(), sessionId: SESSION, sequenceStart: 0, packetId: 1 })).toThrow();
    expect(() => fragmentPacket({ packet: new Uint8Array(FAS1_MAX_PACKET_BYTES + 1), sessionId: SESSION, sequenceStart: 0, packetId: 1 })).toThrow();
    expect(() => fragmentPacket({ packet: Uint8Array.of(1), sessionId: SESSION, sequenceStart: 0xffff_ffff, packetId: 1 })).toThrow();
    expect(() => encodeFas1({ ...validUnit(Fas1UnitType.Data), fragmentCount: 17 })).toThrow();
    expect(() => encodeFas1({ ...validUnit(Fas1UnitType.Data), fragmentIndex: 1, fragmentCount: 1 })).toThrow();
    expect(() => reassemblePacket([validUnit(Fas1UnitType.Data) as never])).toThrow();
  });
});
