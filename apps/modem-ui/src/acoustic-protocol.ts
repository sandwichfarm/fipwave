/**
 * FAS1 is the bounded binary envelope used only between the acoustic modem
 * and the session layer. It is deliberately independent of FWAV and FQT1.
 */
export const FAS1_MAGIC = 'FAS1';
export const FAS1_VERSION = 1;
export const FAS1_HEADER_BYTES = 36;
export const FAS1_MAX_BODY_BYTES = 217;
export const FAS1_MAX_UNIT_BYTES = FAS1_HEADER_BYTES + FAS1_MAX_BODY_BYTES;
export const FAS1_MAX_PACKET_BYTES = 1357;
export const FAS1_MAX_FRAGMENTS = 16;

export enum Fas1UnitType {
  Hello = 1,
  HelloAck = 2,
  Caps = 3,
  Probe = 4,
  Report = 5,
  Commit = 6,
  CommitAck = 7,
  Data = 8,
  TurnEnd = 9,
  Ack = 10,
  Heartbeat = 11,
  Reset = 12,
}

export interface Fas1Unit {
  type: Fas1UnitType;
  flags: number;
  sessionId: bigint;
  sequence: number;
  packetId: number;
  fragmentIndex: number;
  fragmentCount: number;
  packetLength: number;
  body: Uint8Array;
}

export interface FragmentPacketInput {
  packet: Uint8Array;
  sessionId: bigint;
  sequenceStart: number;
  packetId: number;
  /** Directional body bound selected during calibration and committed by both peers. */
  payloadBytes?: number;
}

/** A profile name is negotiable only when this exact executable modem path exists. */
export interface AcousticProfile {
  readonly id: 'quiet-audible-7k-v1';
  readonly codec: 'quiet';
  readonly modemProfile: 'audible-7k-channel-0';
  readonly transmitImplementation: 'quiet-client';
  readonly receiveImplementation: 'quiet-client';
}

export interface DirectionalSettings {
  readonly profileId: string;
  readonly payloadBytes: number;
  readonly repetition: number;
  readonly guardMs: number;
  readonly playbackGain: number;
  readonly ackTimeoutMs: number;
}

export interface AcousticSettings {
  readonly aToB: DirectionalSettings;
  readonly bToA: DirectionalSettings;
}

const UINT32_MAX = 0xffff_ffff;
const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const BODYLESS_TYPES = new Set<Fas1UnitType>([
  Fas1UnitType.TurnEnd,
  Fas1UnitType.Ack,
  Fas1UnitType.Heartbeat,
  Fas1UnitType.Reset,
]);
const CRC32C_TABLE = createCrc32cTable();
const SETTINGS_VERSION = 1;
const encoder = new TextEncoder();

export const ACOUSTIC_PROFILES: readonly AcousticProfile[] = Object.freeze([
  Object.freeze({
    id: 'quiet-audible-7k-v1' as const,
    codec: 'quiet' as const,
    modemProfile: 'audible-7k-channel-0' as const,
    transmitImplementation: 'quiet-client' as const,
    receiveImplementation: 'quiet-client' as const,
  }),
]);

function fail(message: string): never {
  throw new Error(`FAS1 ${message}`);
}

function isUnitType(value: number): value is Fas1UnitType {
  return Number.isInteger(value) && value >= Fas1UnitType.Hello && value <= Fas1UnitType.Reset;
}

function assertInteger(value: number, maximum: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(`${name} is out of range`);
}

function assertSessionId(value: bigint): void {
  if (typeof value !== 'bigint' || value < 0n || value > UINT64_MAX) fail('session ID is out of range');
}

function assertBody(body: Uint8Array): void {
  if (!(body instanceof Uint8Array)) fail('body must be binary');
  if (body.byteLength > FAS1_MAX_BODY_BYTES) fail('body exceeds the 217-byte limit');
}

function exactObject(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') fail(`${name} is invalid`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) fail(`${name} has an unsupported field`);
  return record;
}

function validateUnit(input: Fas1Unit): void {
  if (!input || typeof input !== 'object') fail('unit is invalid');
  if (!isUnitType(input.type)) fail('type is unsupported');
  assertInteger(input.flags, 0, 'flags');
  assertSessionId(input.sessionId);
  assertInteger(input.sequence, UINT32_MAX, 'sequence');
  assertInteger(input.packetId, UINT32_MAX, 'packet ID');
  assertInteger(input.fragmentIndex, 0xffff, 'fragment index');
  assertInteger(input.fragmentCount, 0xffff, 'fragment count');
  assertInteger(input.packetLength, 0xffff, 'packet length');
  assertBody(input.body);

  if (input.type === Fas1UnitType.Data) {
    if (input.sessionId === 0n) fail('DATA requires an active session');
    if (input.packetId === 0) fail('DATA requires a packet ID');
    if (input.fragmentCount < 1 || input.fragmentCount > FAS1_MAX_FRAGMENTS) fail('DATA fragment count is invalid');
    if (input.fragmentIndex >= input.fragmentCount) fail('DATA fragment index is invalid');
    if (input.packetLength < 1 || input.packetLength > FAS1_MAX_PACKET_BYTES) fail('DATA packet length is invalid');
    if (input.body.byteLength < 1) fail('DATA body must not be empty');
    if (input.body.byteLength > input.packetLength) fail('DATA body exceeds declared packet length');
    return;
  }

  if (input.type !== Fas1UnitType.Hello && input.sessionId === 0n) fail('only bootstrap HELLO may use session zero');
  // ACK binds its bitmap (sequence) to the complete packet it acknowledges.
  // Every other control unit has zero packet geometry.
  if ((input.type !== Fas1UnitType.Ack && input.packetId !== 0) || input.fragmentIndex !== 0 || input.fragmentCount !== 0 || input.packetLength !== 0) {
    fail('control packet geometry must be zero');
  }
  if (input.type === Fas1UnitType.Ack && input.packetId === 0) fail('ACK requires a packet ID');
  if (BODYLESS_TYPES.has(input.type)) {
    if (input.body.byteLength !== 0) fail('bodyless control unit has a body');
  } else if (input.body.byteLength === 0) {
    fail('control unit body must not be empty');
  }
}

function createCrc32cTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? (value >>> 1) ^ 0x82f6_3b78 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
}

/** CRC-32C (Castagnoli), initialized and finalized with all bits set. */
export function crc32c(bytes: Uint8Array): number {
  if (!(bytes instanceof Uint8Array)) fail('CRC input must be binary');
  let value = 0xffff_ffff;
  for (const byte of bytes) value = CRC32C_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffff_ffff) >>> 0;
}

export function resolveAcousticProfile(profileId: string): AcousticProfile {
  if (typeof profileId !== 'string') fail('profile ID is invalid');
  const profile = ACOUSTIC_PROFILES.find((entry) => entry.id === profileId);
  if (!profile || profile.transmitImplementation !== profile.receiveImplementation) fail('profile ID is unsupported');
  return profile;
}

function canonicalizeDirection(value: unknown): Uint8Array {
  const direction = exactObject(value, ['profileId', 'payloadBytes', 'repetition', 'guardMs', 'playbackGain', 'ackTimeoutMs'], 'directional settings');
  const profileId = direction.profileId;
  if (typeof profileId !== 'string') fail('profile ID is invalid');
  resolveAcousticProfile(profileId);
  const profileBytes = encoder.encode(profileId);
  if (profileBytes.byteLength < 1 || profileBytes.byteLength > 63) fail('profile ID length is invalid');
  assertInteger(direction.payloadBytes as number, FAS1_MAX_BODY_BYTES, 'payload bytes');
  if ((direction.payloadBytes as number) < 1) fail('payload bytes are invalid');
  assertInteger(direction.repetition as number, 3, 'repetition');
  if ((direction.repetition as number) < 1) fail('repetition is invalid');
  assertInteger(direction.guardMs as number, 5_000, 'guard milliseconds');
  if ((direction.guardMs as number) < 1) fail('guard milliseconds are invalid');
  const playbackGain = direction.playbackGain;
  if (typeof playbackGain !== 'number' || !Number.isSafeInteger(playbackGain * 1_000) || playbackGain < 1 || playbackGain > 2) fail('playback gain is invalid');
  assertInteger(direction.ackTimeoutMs as number, 15_000, 'ack timeout');
  if ((direction.ackTimeoutMs as number) < 4_000) fail('ack timeout is invalid');
  const output = new Uint8Array(1 + profileBytes.byteLength + 2 + 1 + 2 + 2 + 2);
  const view = new DataView(output.buffer);
  output[0] = profileBytes.byteLength;
  output.set(profileBytes, 1);
  let offset = 1 + profileBytes.byteLength;
  view.setUint16(offset, direction.payloadBytes as number, true); offset += 2;
  view.setUint8(offset, direction.repetition as number); offset += 1;
  view.setUint16(offset, direction.guardMs as number, true); offset += 2;
  view.setUint16(offset, Math.round(playbackGain * 1_000), true); offset += 2;
  view.setUint16(offset, direction.ackTimeoutMs as number, true);
  return output;
}

/** Stable binary commitment: version, A→B record, then B→A record. */
export function canonicalizeSettings(value: AcousticSettings): Uint8Array {
  const settings = exactObject(value, ['aToB', 'bToA'], 'settings');
  if (!('aToB' in settings) || !('bToA' in settings)) fail('settings directions are required');
  const aToB = canonicalizeDirection(settings.aToB);
  const bToA = canonicalizeDirection(settings.bToA);
  const output = new Uint8Array(1 + aToB.byteLength + bToA.byteLength);
  output[0] = SETTINGS_VERSION;
  output.set(aToB, 1);
  output.set(bToA, 1 + aToB.byteLength);
  return output;
}

/** SHA-256 detects directional settings disagreement; it is not peer authentication. */
export async function digestSettings(value: AcousticSettings): Promise<Uint8Array> {
  const canonical = canonicalizeSettings(value);
  if (!globalThis.crypto?.subtle) fail('Web Crypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', canonical.slice().buffer);
  return new Uint8Array(digest);
}

function crcProtectedBytes(header: Uint8Array, body: Uint8Array): Uint8Array {
  const protectedBytes = new Uint8Array(32 + body.byteLength);
  protectedBytes.set(header.subarray(0, 32));
  protectedBytes.set(body, 32);
  return protectedBytes;
}

export function encodeFas1(input: Fas1Unit): Uint8Array {
  validateUnit(input);
  const output = new Uint8Array(FAS1_HEADER_BYTES + input.body.byteLength);
  const view = new DataView(output.buffer);
  output.set([0x46, 0x41, 0x53, 0x31], 0);
  view.setUint8(4, FAS1_VERSION);
  view.setUint8(5, input.type);
  view.setUint16(6, input.flags, true);
  view.setBigUint64(8, input.sessionId, true);
  view.setUint32(16, input.sequence, true);
  view.setUint32(20, input.packetId, true);
  view.setUint16(24, input.fragmentIndex, true);
  view.setUint16(26, input.fragmentCount, true);
  view.setUint16(28, input.packetLength, true);
  view.setUint16(30, input.body.byteLength, true);
  output.set(input.body, FAS1_HEADER_BYTES);
  view.setUint32(32, crc32c(crcProtectedBytes(output, input.body)), true);
  return output;
}

/**
 * Fully validates raw bytes before slicing the body or returning a unit. This
 * keeps ambient modem output from changing caller-visible session state.
 */
export function decodeFas1(input: Uint8Array): Fas1Unit {
  if (!(input instanceof Uint8Array)) fail('input must be binary');
  if (input.byteLength < FAS1_HEADER_BYTES || input.byteLength > FAS1_MAX_UNIT_BYTES) fail('unit length is invalid');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (input[0] !== 0x46 || input[1] !== 0x41 || input[2] !== 0x53 || input[3] !== 0x31) fail('magic is invalid');
  if (view.getUint8(4) !== FAS1_VERSION) fail('version is unsupported');
  const typeValue = view.getUint8(5);
  if (!isUnitType(typeValue)) fail('type is unsupported');
  const flags = view.getUint16(6, true);
  if (flags !== 0) fail('flags are unsupported');
  const bodyLength = view.getUint16(30, true);
  if (bodyLength > FAS1_MAX_BODY_BYTES || input.byteLength !== FAS1_HEADER_BYTES + bodyLength) fail('declared body length is invalid');
  const expectedCrc = view.getUint32(32, true);
  if (crc32c(crcProtectedBytes(input, input.subarray(FAS1_HEADER_BYTES))) !== expectedCrc) fail('CRC-32C is invalid');

  const unit: Fas1Unit = {
    type: typeValue,
    flags,
    sessionId: view.getBigUint64(8, true),
    sequence: view.getUint32(16, true),
    packetId: view.getUint32(20, true),
    fragmentIndex: view.getUint16(24, true),
    fragmentCount: view.getUint16(26, true),
    packetLength: view.getUint16(28, true),
    body: input.slice(FAS1_HEADER_BYTES),
  };
  validateUnit(unit);
  return unit;
}

export function fragmentPacket(input: FragmentPacketInput): Fas1Unit[] {
  if (!input || !(input.packet instanceof Uint8Array)) fail('packet must be binary');
  if (input.packet.byteLength < 1 || input.packet.byteLength > FAS1_MAX_PACKET_BYTES) fail('packet length is invalid');
  assertSessionId(input.sessionId);
  if (input.sessionId === 0n) fail('packet requires an active session');
  assertInteger(input.sequenceStart, UINT32_MAX, 'sequence start');
  assertInteger(input.packetId, UINT32_MAX, 'packet ID');
  if (input.packetId === 0) fail('packet requires a packet ID');
  const payloadBytes = input.payloadBytes ?? FAS1_MAX_BODY_BYTES;
  assertInteger(payloadBytes, FAS1_MAX_BODY_BYTES, 'payload bytes');
  if (payloadBytes < 1) fail('payload bytes are invalid');
  const fragmentCount = Math.ceil(input.packet.byteLength / payloadBytes);
  if (!Number.isSafeInteger(fragmentCount) || fragmentCount < 1 || fragmentCount > FAS1_MAX_FRAGMENTS) fail('fragment count is invalid');
  if (input.sequenceStart > UINT32_MAX - (fragmentCount - 1)) fail('sequence range overflows');
  return Array.from({ length: fragmentCount }, (_, fragmentIndex) => ({
    type: Fas1UnitType.Data,
    flags: 0,
    sessionId: input.sessionId,
    sequence: input.sequenceStart + fragmentIndex,
    packetId: input.packetId,
    fragmentIndex,
    fragmentCount,
    packetLength: input.packet.byteLength,
    body: input.packet.slice(fragmentIndex * payloadBytes, (fragmentIndex + 1) * payloadBytes),
  }));
}

/** Strict pure helper for deterministic geometry tests and later reassembly. */
export function reassemblePacket(fragments: readonly Fas1Unit[], payloadBytes = FAS1_MAX_BODY_BYTES): Uint8Array {
  if (!Array.isArray(fragments) || fragments.length < 1 || fragments.length > FAS1_MAX_FRAGMENTS) fail('fragment collection is invalid');
  const first = fragments[0]!;
  assertInteger(payloadBytes, FAS1_MAX_BODY_BYTES, 'payload bytes');
  if (payloadBytes < 1) fail('payload bytes are invalid');
  validateUnit(first);
  const expectedCount = Math.ceil(first.packetLength / payloadBytes);
  if (first.type !== Fas1UnitType.Data || first.fragmentCount !== fragments.length || first.fragmentCount !== expectedCount) fail('fragment collection geometry is invalid');
  const byIndex = new Map<number, Fas1Unit>();
  for (const fragment of fragments) {
    validateUnit(fragment);
    if (fragment.type !== Fas1UnitType.Data || fragment.sessionId !== first.sessionId || fragment.packetId !== first.packetId || fragment.packetLength !== first.packetLength || fragment.fragmentCount !== first.fragmentCount) fail('fragment collection does not match');
    const expectedLength = fragment.fragmentIndex === expectedCount - 1
      ? first.packetLength - payloadBytes * (expectedCount - 1)
      : payloadBytes;
    if (fragment.body.byteLength !== expectedLength) fail('fragment collection body geometry is invalid');
    if (byIndex.has(fragment.fragmentIndex)) fail('fragment collection has a duplicate index');
    byIndex.set(fragment.fragmentIndex, fragment);
  }
  const output = new Uint8Array(first.packetLength);
  let offset = 0;
  for (let index = 0; index < first.fragmentCount; index += 1) {
    const fragment = byIndex.get(index);
    if (!fragment || fragment.body.byteLength > output.byteLength - offset) fail('fragment collection is incomplete or overflows');
    output.set(fragment.body, offset);
    offset += fragment.body.byteLength;
  }
  if (offset !== output.byteLength) fail('fragment collection declared length is invalid');
  return output;
}
