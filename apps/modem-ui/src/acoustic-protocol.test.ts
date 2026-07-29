import { describe, expect, it } from 'vitest';

import {
  ACOUSTIC_PROFILES,
  canonicalizeSettings,
  createParityUnits,
  FAS1_HEADER_BYTES,
  FAS1_MAX_BODY_BYTES,
  FAS1_MAX_PACKET_BYTES,
  FAS1_MAX_UNIT_BYTES,
  Fas1Sender,
  Fas1UnitType,
  crc32c,
  decodeFas1,
  digestSettings,
  encodeFas1,
  fragmentPacket,
  recoverFragmentWithParity,
  reassemblePacket,
  resolveAcousticProfile,
} from './acoustic-protocol.js';

const SESSION = 0x1020_3040_5060_7080n;

function validUnit(type: Fas1UnitType) {
  const bodyless = [Fas1UnitType.TurnEnd, Fas1UnitType.Ack, Fas1UnitType.Heartbeat, Fas1UnitType.Reset].includes(type);
  return {
    type,
    flags: Fas1Sender.A,
    sessionId: type === Fas1UnitType.Hello ? 0n : SESSION,
    sequence: 7,
    packetId: type === Fas1UnitType.Data || type === Fas1UnitType.Parity || type === Fas1UnitType.Ack ? 99 : 0,
    fragmentIndex: 0,
    fragmentCount: type === Fas1UnitType.Data || type === Fas1UnitType.Parity ? 1 : 0,
    packetLength: type === Fas1UnitType.Data || type === Fas1UnitType.Parity ? 1 : 0,
    body: bodyless ? new Uint8Array() : Uint8Array.of(type),
  };
}

function mutate(frame: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = frame.slice();
  copy[offset] = value;
  return copy;
}

function resign(frame: Uint8Array): Uint8Array {
  const copy = frame.slice();
  const body = copy.subarray(FAS1_HEADER_BYTES);
  const protectedBytes = new Uint8Array(32 + body.byteLength);
  protectedBytes.set(copy.subarray(0, 32));
  protectedBytes.set(body, 32);
  new DataView(copy.buffer, copy.byteOffset, copy.byteLength).setUint32(32, crc32c(protectedBytes), true);
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
    const encoded = encodeFas1({ ...validUnit(Fas1UnitType.Data), sessionId: 1n });
    const malformed = [
      resign(mutate(encoded, 0, 0)),
      resign(mutate(encoded, 4, 2)),
      resign(mutate(encoded, 5, 0xff)),
      resign(mutate(encoded, 6, 3)),
      resign(mutate(encoded, 8, 0)),
      resign(mutate(encoded, 20, 0)),
      resign(mutate(encoded, 24, 1)),
      resign(mutate(encoded, 26, 0)),
      resign(mutate(encoded, 28, 0)),
      resign(mutate(encoded, 30, 2)),
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
    const fragments = fragmentPacket({ packet, sessionId: SESSION, sequenceStart: 100, packetId: 42, sender: Fas1Sender.A });
    expect(fragments).toHaveLength(7);
    expect(fragments.every((fragment) => fragment.body.byteLength <= FAS1_MAX_BODY_BYTES)).toBe(true);
    expect(fragments.map((fragment) => fragment.fragmentIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(reassemblePacket(fragments)).toEqual(packet);
  });

  it('rejects packet and fragment geometry at zero, one-over, and unsafe boundaries', () => {
    expect(() => fragmentPacket({ packet: new Uint8Array(), sessionId: SESSION, sequenceStart: 0, packetId: 1, sender: Fas1Sender.A })).toThrow();
    expect(() => fragmentPacket({ packet: new Uint8Array(FAS1_MAX_PACKET_BYTES + 1), sessionId: SESSION, sequenceStart: 0, packetId: 1, sender: Fas1Sender.A })).toThrow();
    expect(() => fragmentPacket({ packet: Uint8Array.of(1), sessionId: SESSION, sequenceStart: 0x1_0000_0000, packetId: 1, sender: Fas1Sender.A })).toThrow();
    expect(() => encodeFas1({ ...validUnit(Fas1UnitType.Data), fragmentCount: 17 })).toThrow();
    expect(() => encodeFas1({ ...validUnit(Fas1UnitType.Data), fragmentIndex: 1, fragmentCount: 1 })).toThrow();
    const fragments = fragmentPacket({ packet: new Uint8Array(218), sessionId: SESSION, sequenceStart: 0, packetId: 1, sender: Fas1Sender.A });
    expect(() => reassemblePacket([fragments[0]!, fragments[0]!])).toThrow();
  });

  it('enforces the committed 96-byte canonical DATA geometry before reassembly', () => {
    const packet = new Uint8Array(FAS1_MAX_PACKET_BYTES).fill(7);
    const fragments = fragmentPacket({ packet, sessionId: SESSION, sequenceStart: 0, packetId: 9, sender: Fas1Sender.A, payloadBytes: 96 });
    expect(fragments).toHaveLength(15);
    expect(fragments.slice(0, -1).every((fragment) => fragment.body.byteLength === 96)).toBe(true);
    expect(fragments.at(-1)?.body.byteLength).toBe(13);
    expect(reassemblePacket(fragments, 96)).toEqual(packet);
    const nonCanonical = fragments.map((fragment) => ({ ...fragment, body: fragment.body.slice() }));
    nonCanonical[0] = { ...nonCanonical[0]!, body: nonCanonical[0]!.body.slice(0, 95) };
    nonCanonical[1] = { ...nonCanonical[1]!, body: Uint8Array.of(7, ...nonCanonical[1]!.body) };
    expect(() => reassemblePacket(nonCanonical, 96)).toThrow();
  });

  it('recovers exactly one erased DATA frame per XOR parity group, including the short final fragment', () => {
    const packet = Uint8Array.from({ length: FAS1_MAX_PACKET_BYTES }, (_, index) => (index * 17) & 0xff);
    const fragments = fragmentPacket({ packet, sessionId: SESSION, sequenceStart: 20, packetId: 77, sender: Fas1Sender.A, payloadBytes: 96 });
    const parity = createParityUnits(fragments, 96);
    expect(parity).toHaveLength(4);
    expect(parity.every((unit) => unit.type === Fas1UnitType.Parity)).toBe(true);

    const withoutSecond = fragments.filter((fragment) => fragment.fragmentIndex !== 1);
    const recoveredSecond = recoverFragmentWithParity(withoutSecond, parity[0]!, 96);
    expect(recoveredSecond).toEqual(fragments[1]);
    expect(reassemblePacket([...withoutSecond, recoveredSecond!], 96)).toEqual(packet);

    const withoutFinal = fragments.filter((fragment) => fragment.fragmentIndex !== fragments.length - 1);
    const recoveredFinal = recoverFragmentWithParity(withoutFinal, parity.at(-1)!, 96);
    expect(recoveredFinal?.body).toHaveLength(13);
    expect(reassemblePacket([...withoutFinal, recoveredFinal!], 96)).toEqual(packet);
  });

  it('fails closed when parity geometry is malformed or a group has more than one erasure', () => {
    const fragments = fragmentPacket({ packet: new Uint8Array(385).fill(0xa5), sessionId: SESSION, sequenceStart: 0, packetId: 4, sender: Fas1Sender.A, payloadBytes: 96 });
    const parity = createParityUnits(fragments, 96);
    expect(recoverFragmentWithParity(fragments, parity[0]!, 96)).toBeUndefined();
    expect(recoverFragmentWithParity(fragments.filter((fragment) => fragment.fragmentIndex !== 1 && fragment.fragmentIndex !== 2), parity[0]!, 96)).toBeUndefined();
    expect(() => encodeFas1({ ...parity[0]!, fragmentIndex: 1 })).toThrow();
    expect(() => recoverFragmentWithParity(fragments, { ...parity[0]!, body: parity[0]!.body.slice(0, -1) }, 96)).toThrow();
  });

  it('serializes directional settings in one canonical A-to-B then B-to-A order', async () => {
    const aToB = { profileId: 'quiet-audible-7k-v1', payloadBytes: 96, repetition: 1, guardMs: 750, playbackGain: 1, ackTimeoutMs: 4_000 };
    const bToA = { profileId: 'quiet-audible-7k-v1', payloadBytes: 217, repetition: 1, guardMs: 750, playbackGain: 2, ackTimeoutMs: 15_000 };
    const canonical = canonicalizeSettings({ aToB, bToA });
    expect(canonical).toEqual(canonicalizeSettings({ aToB, bToA }));
    expect(canonical).not.toEqual(canonicalizeSettings({ aToB: bToA, bToA: aToB }));
    const digest = await digestSettings({ aToB, bToA });
    expect(digest).toHaveLength(32);
    expect(digest).toEqual(await digestSettings({ aToB, bToA }));
  });

  it('uses one exact mutually executable Quiet profile and rejects synthetic frequency controls', () => {
    const profile = resolveAcousticProfile('quiet-audible-7k-v1');
    expect(ACOUSTIC_PROFILES).toContainEqual(profile);
    expect(profile).toMatchObject({ codec: 'quiet', modemProfile: 'audible-7k-channel-0', transmitImplementation: 'quiet-client', receiveImplementation: 'quiet-client' });
    expect(() => resolveAcousticProfile('quiet-audible-7k-v2')).toThrow();
    expect(() => canonicalizeSettings({
      aToB: { profileId: 'quiet-audible-7k-v1', payloadBytes: 96, repetition: 1, guardMs: 750, playbackGain: 1, ackTimeoutMs: 4_000, frequencyHz: 7_000 },
      bToA: { profileId: 'quiet-audible-7k-v1', payloadBytes: 96, repetition: 1, guardMs: 750, playbackGain: 1, ackTimeoutMs: 4_000 },
    } as never)).toThrow();
    expect(() => canonicalizeSettings({
      aToB: { profileId: 'quiet-audible-7k-v1', payloadBytes: 96, repetition: 1, guardMs: 750, playbackGain: 2.001, ackTimeoutMs: 4_000 },
      bToA: { profileId: 'quiet-audible-7k-v1', payloadBytes: 96, repetition: 1, guardMs: 750, playbackGain: 1, ackTimeoutMs: 4_000 },
    })).toThrow();
  });
});
