import { decodeFas1, digestSettings, encodeFas1, Fas1UnitType, resolveAcousticProfile, type AcousticSettings, type DirectionalSettings } from './acoustic-protocol.js';

export type AcousticRole = 'A' | 'B';
export type AcousticSessionState = 'Idle' | 'Listening' | 'HelloSent' | 'HelloAckSent' | 'CapsSent' | 'CalibratingAToB' | 'CalibratingBToA' | 'Committing' | 'AwaitingHeartbeat' | 'Ready' | 'Error';

export interface AcousticModem {
  send(unit: Uint8Array): void | Promise<void>;
  onUnit(handler: (unit: Uint8Array) => void): () => void;
}

export interface AcousticClock { now(): number; }
export interface AcousticTimers { setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>; clearTimeout(handle: ReturnType<typeof setTimeout>): void; }
export interface AcousticCapabilityRange { readonly minPayloadBytes: number; readonly maxPayloadBytes: number; }
export interface AcousticCandidate extends DirectionalSettings { readonly id: string; }
export interface AcousticProbe { readonly direction: 'AtoB' | 'BtoA'; readonly candidateIndex: number; readonly probeIndex: number; readonly candidate: AcousticCandidate; }
export interface AcousticProbeObservation { readonly received: boolean; readonly bytePerfect: boolean; readonly corrupt: boolean; readonly missing: boolean; readonly duplicate: boolean; readonly discontinuity: boolean; readonly latencyMs: number; readonly signalDb: number; readonly clipping: boolean; readonly confidence: number; }
export interface AcousticProbeLedgerEntry extends AcousticProbe { readonly observation: AcousticProbeObservation; }
export interface AcousticSessionOptions {
  readonly role: AcousticRole;
  readonly identity: string;
  readonly expectedPeer: string;
  readonly modem: AcousticModem;
  readonly clock: AcousticClock;
  readonly timers: AcousticTimers;
  readonly nonce: () => Uint8Array;
  readonly profiles: readonly string[];
  readonly ranges: AcousticCapabilityRange;
  readonly candidates: readonly AcousticCandidate[];
  readonly calibration: Readonly<{ probesPerDirection: number; maxCandidates: number; deadlineMs: number }>;
  readonly measureProbe: (probe: AcousticProbe) => AcousticProbeObservation;
}

export interface AcousticSessionSnapshot {
  readonly state: AcousticSessionState;
  readonly role: AcousticRole;
  readonly epoch: number;
  readonly sessionId?: bigint;
  readonly turnOwner?: AcousticRole;
  readonly ready: boolean;
  readonly reason?: string;
  readonly ledger: readonly AcousticProbeLedgerEntry[];
  readonly settings?: AcousticSettings;
  readonly settingsDigest?: Uint8Array;
}

interface Handshake { readonly role: AcousticRole; readonly identity: string; readonly expectedPeer: string; readonly nonce: Uint8Array; readonly echoedNonce?: Uint8Array; readonly profiles: readonly string[]; readonly ranges: AcousticCapabilityRange; readonly epoch: number; readonly sessionId?: bigint; }

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_IDENTITY_BYTES = 96;
const MAX_PROFILES = 3;
const MAX_PROFILE_BYTES = 48;
const PROBE_DIRECTION_A_TO_B = 1;
const PROBE_DIRECTION_B_TO_A = 2;
const OBS_RECEIVED = 1;
const OBS_BYTE_PERFECT = 2;
const OBS_CORRUPT = 4;
const OBS_MISSING = 8;
const OBS_DUPLICATE = 16;
const OBS_DISCONTINUITY = 32;
const OBS_CLIPPING = 64;

function invalid(message: string): never { throw new Error(`acoustic session ${message}`); }
function validInteger(value: number, minimum: number, maximum: number): boolean { return Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function equal(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  let mismatch = 0;
  for (let index = 0; index < left.byteLength; index += 1) mismatch |= left[index]! ^ right[index]!;
  return mismatch === 0;
}
function nonZero(value: Uint8Array): boolean { return value.some((byte) => byte !== 0); }
function roleByte(role: AcousticRole): number { return role === 'A' ? 1 : 2; }
function parseRole(value: number): AcousticRole { if (value === 1) return 'A'; if (value === 2) return 'B'; return invalid('role is invalid'); }
function complement(role: AcousticRole): AcousticRole { return role === 'A' ? 'B' : 'A'; }
function toSessionId(nonce: Uint8Array): bigint {
  if (nonce.byteLength !== 16) invalid('nonce must be 128 bits');
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  const id = view.getBigUint64(0, true) ^ view.getBigUint64(8, true);
  return id === 0n ? 1n : id;
}
function sameProfiles(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function validRange(value: AcousticCapabilityRange): boolean { return validInteger(value.minPayloadBytes, 1, 217) && validInteger(value.maxPayloadBytes, value.minPayloadBytes, 217); }

/** Compact strict control payload: never exposes a permissive JSON parsing boundary to acoustic input. */
function encodeHandshake(value: Handshake): Uint8Array {
  if (!value.identity || !value.expectedPeer || value.identity === value.expectedPeer || value.nonce.byteLength !== 16 || !nonZero(value.nonce) || !validRange(value.ranges) || value.profiles.length < 1 || value.profiles.length > MAX_PROFILES || !validInteger(value.epoch, 0, 0xffff_ffff)) invalid('handshake is invalid');
  const identity = encoder.encode(value.identity); const expected = encoder.encode(value.expectedPeer);
  if (identity.byteLength > MAX_IDENTITY_BYTES || expected.byteLength > MAX_IDENTITY_BYTES) invalid('identity is invalid');
  const profiles = value.profiles.map((profile) => encoder.encode(profile));
  if (profiles.some((profile) => profile.byteLength < 1 || profile.byteLength > MAX_PROFILE_BYTES)) invalid('profile set is invalid');
  const output = new Uint8Array(1 + 1 + 1 + identity.byteLength + 1 + expected.byteLength + 16 + 1 + profiles.reduce((sum, profile) => sum + 1 + profile.byteLength, 0) + 4 + 4 + 4 + (value.echoedNonce ? 16 : 0) + (value.sessionId === undefined ? 0 : 8));
  const view = new DataView(output.buffer); let offset = 0;
  output[offset++] = 1; output[offset++] = roleByte(value.role);
  output[offset++] = identity.byteLength; output.set(identity, offset); offset += identity.byteLength;
  output[offset++] = expected.byteLength; output.set(expected, offset); offset += expected.byteLength;
  output.set(value.nonce, offset); offset += 16;
  output[offset++] = profiles.length;
  for (const profile of profiles) { output[offset++] = profile.byteLength; output.set(profile, offset); offset += profile.byteLength; }
  view.setUint16(offset, value.ranges.minPayloadBytes, true); offset += 2;
  view.setUint16(offset, value.ranges.maxPayloadBytes, true); offset += 2;
  view.setUint32(offset, value.epoch, true); offset += 4;
  output[offset++] = value.echoedNonce ? 1 : 0;
  if (value.echoedNonce) { if (value.echoedNonce.byteLength !== 16) invalid('echo nonce is invalid'); output.set(value.echoedNonce, offset); offset += 16; }
  output[offset++] = value.sessionId === undefined ? 0 : 1;
  if (value.sessionId !== undefined) { view.setBigUint64(offset, value.sessionId, true); offset += 8; }
  return output.slice(0, offset);
}

function decodeHandshake(input: Uint8Array): Handshake {
  try {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength); let offset = 0;
    const byte = (): number => { if (offset >= input.byteLength) invalid('handshake is truncated'); return input[offset++]!; };
    const text = (): string => { const length = byte(); if (length < 1 || length > MAX_IDENTITY_BYTES || offset + length > input.byteLength) invalid('handshake identity is invalid'); const value = decoder.decode(input.slice(offset, offset + length)); offset += length; return value; };
    if (byte() !== 1) invalid('handshake version is invalid');
    const role = parseRole(byte()); const identity = text(); const expectedPeer = text();
    if (offset + 16 > input.byteLength) invalid('handshake nonce is invalid'); const nonce = input.slice(offset, offset + 16); offset += 16;
    const profileCount = byte(); if (profileCount < 1 || profileCount > MAX_PROFILES) invalid('handshake profile count is invalid');
    const profiles: string[] = [];
    for (let index = 0; index < profileCount; index += 1) { const length = byte(); if (length < 1 || length > MAX_PROFILE_BYTES || offset + length > input.byteLength) invalid('handshake profile is invalid'); profiles.push(decoder.decode(input.slice(offset, offset + length))); offset += length; }
    if (offset + 9 > input.byteLength) invalid('handshake range is invalid');
    const ranges = { minPayloadBytes: view.getUint16(offset, true), maxPayloadBytes: view.getUint16(offset + 2, true) }; offset += 4;
    const epoch = view.getUint32(offset, true); offset += 4;
    const echo = byte(); let echoedNonce: Uint8Array | undefined;
    if (echo === 1) { if (offset + 16 > input.byteLength) invalid('handshake echo nonce is invalid'); echoedNonce = input.slice(offset, offset + 16); offset += 16; } else if (echo !== 0) invalid('handshake echo flag is invalid');
    const hasSessionId = byte(); let sessionId: bigint | undefined;
    if (hasSessionId === 1) { if (offset + 8 !== input.byteLength) invalid('handshake session ID is invalid'); sessionId = view.getBigUint64(offset, true); offset += 8; if (sessionId === 0n) invalid('handshake session ID is invalid'); } else if (hasSessionId !== 0 || offset !== input.byteLength) invalid('handshake trailing data is invalid');
    if (!identity || !expectedPeer || identity === expectedPeer || !nonZero(nonce) || !validRange(ranges)) invalid('handshake binding is invalid');
    return {
      role, identity, expectedPeer, nonce, profiles, ranges, epoch,
      ...(echoedNonce ? { echoedNonce } : {}),
      ...(sessionId === undefined ? {} : { sessionId }),
    };
  } catch { invalid('handshake is invalid'); }
}

/**
 * Pure, injected acoustic session authority. The fixture modem is a test seam
 * only; physical delivery remains owned by the browser modem in later plans.
 */
export class AcousticSession {
  #state: AcousticSessionState;
  #epoch = 0;
  #sessionId: bigint | undefined;
  #localNonce: Uint8Array | undefined;
  #peerNonce: Uint8Array | undefined;
  #sequence = 1;
  #unsubscribe: () => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #reason: string | undefined;
  #ledger: AcousticProbeLedgerEntry[] = [];
  #sentProbes: Record<'AtoB' | 'BtoA', number> = { AtoB: 0, BtoA: 0 };
  #receivedReports: Record<'AtoB' | 'BtoA', number> = { AtoB: 0, BtoA: 0 };
  #receivedProbes: Record<'AtoB' | 'BtoA', number> = { AtoB: 0, BtoA: 0 };
  #selected: Partial<Record<'AtoB' | 'BtoA', AcousticCandidate>> = {};
  #settings: AcousticSettings | undefined;
  #settingsDigest: Uint8Array | undefined;
  #work: Promise<void> = Promise.resolve();

  constructor(private readonly options: AcousticSessionOptions) {
    if (!options.identity || !options.expectedPeer || options.identity === options.expectedPeer || !validRange(options.ranges) || options.profiles.length < 1 || options.profiles.length > MAX_PROFILES || options.candidates.length < 1 || options.candidates.length > options.calibration.maxCandidates || !validInteger(options.calibration.probesPerDirection, 1, 4) || !validInteger(options.calibration.deadlineMs, 1, 120_000) || typeof options.measureProbe !== 'function') invalid('options are invalid');
    for (const profile of options.profiles) resolveAcousticProfile(profile);
    for (const candidate of options.candidates) {
      if (!candidate.id || candidate.playbackGain < 1 || candidate.playbackGain > 2 || !validInteger(candidate.payloadBytes, options.ranges.minPayloadBytes, options.ranges.maxPayloadBytes) || !validInteger(candidate.repetition, 1, 3) || !validInteger(candidate.guardMs, 1, 5_000) || !validInteger(candidate.ackTimeoutMs, 4_000, 15_000)) invalid('candidate is invalid');
      resolveAcousticProfile(candidate.profileId);
    }
    this.#state = options.role === 'A' ? 'Idle' : 'Listening';
    this.#unsubscribe = options.modem.onUnit((unit) => this.receive(unit));
  }

  get snapshot(): AcousticSessionSnapshot {
    const turnOwner = this.#state === 'CalibratingAToB' ? 'A' : this.#state === 'CalibratingBToA' ? 'B' : undefined;
    return Object.freeze({
      state: this.#state, role: this.options.role, epoch: this.#epoch, ready: this.#state === 'Ready', ledger: this.#ledger.map((entry) => ({ ...entry, candidate: { ...entry.candidate }, observation: { ...entry.observation } })),
      ...(this.#sessionId === undefined ? {} : { sessionId: this.#sessionId }),
      ...(turnOwner === undefined ? {} : { turnOwner }),
      ...(this.#reason === undefined ? {} : { reason: this.#reason }),
      ...(this.#settings === undefined ? {} : { settings: { aToB: { ...this.#settings.aToB }, bToA: { ...this.#settings.bToA } } }),
      ...(this.#settingsDigest === undefined ? {} : { settingsDigest: this.#settingsDigest.slice() }),
    });
  }

  start(): boolean {
    if (this.options.role !== 'A' || this.#state !== 'Idle') return false;
    const nonce = this.options.nonce().slice();
    if (nonce.byteLength !== 16) invalid('nonce must be 128 bits');
    this.#localNonce = nonce; this.#sessionId = toSessionId(nonce); this.#state = 'HelloSent';
    this.send(Fas1UnitType.Hello, 0n, encodeHandshake({ role: 'A', identity: this.options.identity, expectedPeer: this.options.expectedPeer, nonce, profiles: this.options.profiles, ranges: this.options.ranges, epoch: this.#epoch, sessionId: this.#sessionId }));
    return true;
  }

  reset(epoch: number): void {
    if (!validInteger(epoch, 0, 0xffff_ffff)) invalid('epoch is invalid');
    if (this.#timer !== undefined) this.options.timers.clearTimeout(this.#timer);
    this.#timer = undefined; this.#epoch = epoch; this.#sessionId = undefined; this.#localNonce = undefined; this.#peerNonce = undefined; this.#sequence = 1; this.#reason = undefined; this.#ledger = []; this.#sentProbes = { AtoB: 0, BtoA: 0 }; this.#receivedReports = { AtoB: 0, BtoA: 0 }; this.#receivedProbes = { AtoB: 0, BtoA: 0 }; this.#selected = {}; this.#settings = undefined; this.#settingsDigest = undefined; this.#work = Promise.resolve(); this.#state = this.options.role === 'A' ? 'Idle' : 'Listening';
  }

  dispose(): void { this.reset(this.#epoch); this.#unsubscribe(); }
  async settle(): Promise<void> { let current: Promise<void>; do { current = this.#work; await current; } while (current !== this.#work); }
  heartbeat(): boolean { if (!this.#sessionId || (this.#state !== 'AwaitingHeartbeat' && this.#state !== 'Ready')) return false; this.send(Fas1UnitType.Heartbeat, this.#sessionId, new Uint8Array()); return true; }

  receive(raw: Uint8Array): void {
    let unit;
    try { unit = decodeFas1(raw); } catch { return; }
    try {
      if (unit.type === Fas1UnitType.Hello) this.onHello(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.HelloAck) this.onHelloAck(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.Caps) this.onCaps(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.Probe) this.onProbe(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.Report) this.onReport(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.Commit) this.onCommit(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.CommitAck) this.onCommitAck(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.Heartbeat) this.onHeartbeat(unit.sessionId);
    } catch { /* Ambient/malformed units never mutate a legal state. */ }
  }

  private onHello(headerSessionId: bigint, body: Uint8Array): void {
    if (this.options.role !== 'B' || this.#state !== 'Listening' || headerSessionId !== 0n) return;
    const hello = decodeHandshake(body);
    if (hello.role !== 'A' || hello.identity !== this.options.expectedPeer || hello.expectedPeer !== this.options.identity || hello.epoch !== this.#epoch || !hello.sessionId || !sameProfiles(hello.profiles, this.options.profiles) || !this.mutualRange(hello.ranges)) return;
    const localNonce = this.options.nonce().slice(); if (localNonce.byteLength !== 16) invalid('nonce must be 128 bits');
    this.#sessionId = hello.sessionId; this.#peerNonce = hello.nonce; this.#localNonce = localNonce; this.#state = 'HelloAckSent';
    this.send(Fas1UnitType.HelloAck, hello.sessionId, encodeHandshake({ role: 'B', identity: this.options.identity, expectedPeer: this.options.expectedPeer, nonce: localNonce, echoedNonce: hello.nonce, profiles: this.options.profiles, ranges: this.options.ranges, epoch: this.#epoch }));
  }

  private onHelloAck(sessionId: bigint, body: Uint8Array): void {
    if (this.options.role !== 'A' || this.#state !== 'HelloSent' || sessionId !== this.#sessionId || !this.#localNonce) return;
    const ack = decodeHandshake(body);
    if (ack.role !== 'B' || ack.identity !== this.options.expectedPeer || ack.expectedPeer !== this.options.identity || ack.epoch !== this.#epoch || !equal(ack.echoedNonce, this.#localNonce) || !sameProfiles(ack.profiles, this.options.profiles) || !this.mutualRange(ack.ranges)) return;
    this.#peerNonce = ack.nonce; this.#state = 'CapsSent';
    this.send(Fas1UnitType.Caps, sessionId, this.capsBody());
  }

  private onCaps(sessionId: bigint, body: Uint8Array): void {
    const expectedA = this.options.role === 'A' ? this.#localNonce : this.#peerNonce;
    const expectedB = this.options.role === 'B' ? this.#localNonce : this.#peerNonce;
    if (sessionId !== this.#sessionId || !expectedA || !expectedB || body.byteLength !== 32 || !equal(body.slice(0, 16), expectedA) || !equal(body.slice(16), expectedB)) return;
    if (this.options.role === 'B' && this.#state === 'HelloAckSent') {
      this.#state = 'CalibratingAToB'; this.armDeadline(); this.send(Fas1UnitType.Caps, sessionId, this.capsBody()); return;
    }
    if (this.options.role === 'A' && this.#state === 'CapsSent') { this.#state = 'CalibratingAToB'; this.armDeadline(); this.driveProbe('AtoB'); }
  }

  private capsBody(): Uint8Array {
    const body = new Uint8Array(32);
    const aNonce = this.options.role === 'A' ? this.#localNonce! : this.#peerNonce!;
    const bNonce = this.options.role === 'B' ? this.#localNonce! : this.#peerNonce!;
    body.set(aNonce, 0); body.set(bNonce, 16);
    return body;
  }
  private armDeadline(): void {
    if (this.#timer !== undefined) return;
    const epoch = this.#epoch;
    this.#timer = this.options.timers.setTimeout(() => {
      if (epoch === this.#epoch && (this.#state === 'CalibratingAToB' || this.#state === 'CalibratingBToA')) this.fail('acoustic_calibration_deadline');
    }, this.options.calibration.deadlineMs);
  }
  private directionByte(direction: 'AtoB' | 'BtoA'): number { return direction === 'AtoB' ? PROBE_DIRECTION_A_TO_B : PROBE_DIRECTION_B_TO_A; }
  private parseDirection(value: number): 'AtoB' | 'BtoA' { if (value === PROBE_DIRECTION_A_TO_B) return 'AtoB'; if (value === PROBE_DIRECTION_B_TO_A) return 'BtoA'; return invalid('probe direction is invalid'); }
  private expectedSender(direction: 'AtoB' | 'BtoA'): AcousticRole { return direction === 'AtoB' ? 'A' : 'B'; }
  private stateFor(direction: 'AtoB' | 'BtoA'): AcousticSessionState { return direction === 'AtoB' ? 'CalibratingAToB' : 'CalibratingBToA'; }
  private probeFor(direction: 'AtoB' | 'BtoA', ordinal: number): AcousticProbe {
    const candidateIndex = Math.floor(ordinal / this.options.calibration.probesPerDirection);
    const probeIndex = ordinal % this.options.calibration.probesPerDirection;
    const candidate = this.options.candidates[candidateIndex];
    if (!candidate) invalid('probe candidate is invalid');
    return { direction, candidateIndex, probeIndex, candidate };
  }
  private normalizeObservation(value: AcousticProbeObservation): AcousticProbeObservation {
    if (!value || typeof value !== 'object' || typeof value.received !== 'boolean' || typeof value.bytePerfect !== 'boolean' || typeof value.corrupt !== 'boolean' || typeof value.missing !== 'boolean' || typeof value.duplicate !== 'boolean' || typeof value.discontinuity !== 'boolean' || typeof value.clipping !== 'boolean' || !validInteger(value.latencyMs, 0, 65_535) || !Number.isFinite(value.signalDb) || value.signalDb < -200 || value.signalDb > 0 || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) invalid('probe observation is invalid');
    return { ...value };
  }
  private encodeReport(probe: AcousticProbe, observation: AcousticProbeObservation): Uint8Array {
    let flags = (observation.received ? OBS_RECEIVED : 0) | (observation.bytePerfect ? OBS_BYTE_PERFECT : 0) | (observation.corrupt ? OBS_CORRUPT : 0) | (observation.missing ? OBS_MISSING : 0) | (observation.duplicate ? OBS_DUPLICATE : 0) | (observation.discontinuity ? OBS_DISCONTINUITY : 0) | (observation.clipping ? OBS_CLIPPING : 0);
    const body = new Uint8Array(10); const view = new DataView(body.buffer);
    body[0] = this.directionByte(probe.direction); body[1] = probe.candidateIndex; body[2] = probe.probeIndex; body[3] = flags;
    view.setUint16(4, observation.latencyMs, true); view.setInt16(6, Math.round(observation.signalDb * 10), true); view.setUint16(8, Math.round(observation.confidence * 1_000), true);
    return body;
  }
  private decodeReport(body: Uint8Array): { probe: AcousticProbe; observation: AcousticProbeObservation } {
    if (body.byteLength !== 10) invalid('report body is invalid');
    const direction = this.parseDirection(body[0]!); const candidateIndex = body[1]!; const probeIndex = body[2]!; const flags = body[3]!;
    if ((flags & ~127) !== 0 || candidateIndex >= this.options.candidates.length || probeIndex >= this.options.calibration.probesPerDirection) invalid('report geometry is invalid');
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const candidate = this.options.candidates[candidateIndex]!;
    return { probe: { direction, candidateIndex, probeIndex, candidate }, observation: this.normalizeObservation({ received: (flags & OBS_RECEIVED) !== 0, bytePerfect: (flags & OBS_BYTE_PERFECT) !== 0, corrupt: (flags & OBS_CORRUPT) !== 0, missing: (flags & OBS_MISSING) !== 0, duplicate: (flags & OBS_DUPLICATE) !== 0, discontinuity: (flags & OBS_DISCONTINUITY) !== 0, clipping: (flags & OBS_CLIPPING) !== 0, latencyMs: view.getUint16(4, true), signalDb: view.getInt16(6, true) / 10, confidence: view.getUint16(8, true) / 1_000 }) };
  }
  private onProbe(sessionId: bigint, body: Uint8Array): void {
    if (sessionId !== this.#sessionId || body.byteLength !== 3) return;
    const direction = this.parseDirection(body[0]!); const ordinal = this.#receivedProbes[direction];
    if (this.#state !== this.stateFor(direction) || this.options.role === this.expectedSender(direction) || body[1] !== Math.floor(ordinal / this.options.calibration.probesPerDirection) || body[2] !== ordinal % this.options.calibration.probesPerDirection) return;
    const probe = this.probeFor(direction, ordinal); const observation = this.normalizeObservation(this.options.measureProbe(probe));
    this.#receivedProbes[direction] += 1; this.#ledger.push({ ...probe, observation }); this.send(Fas1UnitType.Report, sessionId, this.encodeReport(probe, observation)); this.completeDirection(direction);
  }
  private onReport(sessionId: bigint, body: Uint8Array): void {
    if (sessionId !== this.#sessionId) return;
    const { probe, observation } = this.decodeReport(body); const ordinal = this.#receivedReports[probe.direction];
    if (this.#state !== this.stateFor(probe.direction) || this.options.role !== this.expectedSender(probe.direction) || probe.candidateIndex !== Math.floor(ordinal / this.options.calibration.probesPerDirection) || probe.probeIndex !== ordinal % this.options.calibration.probesPerDirection) return;
    this.#receivedReports[probe.direction] += 1; this.#ledger.push({ ...probe, observation });
    if (!this.completeDirection(probe.direction)) this.driveProbe(probe.direction);
  }
  private completeDirection(direction: 'AtoB' | 'BtoA'): boolean {
    const expected = this.options.candidates.length * this.options.calibration.probesPerDirection;
    const entries = this.#ledger.filter((entry) => entry.direction === direction);
    if (entries.length < expected || this.#selected[direction]) return false;
    const selected = this.select(direction, entries);
    if (!selected) { this.fail('acoustic_calibration_no_safe_candidate'); return true; }
    this.#selected[direction] = selected;
    if (direction === 'AtoB') {
      this.#state = 'CalibratingBToA';
      if (this.options.role === 'B') this.driveProbe('BtoA');
    } else {
      this.#state = 'Committing';
      if (this.options.role === 'B') this.queueCommit();
    }
    return true;
  }
  private select(direction: 'AtoB' | 'BtoA', entries: readonly AcousticProbeLedgerEntry[]): AcousticCandidate | undefined {
    const ranked = this.options.candidates.map((candidate, candidateIndex) => {
      const observations = entries.filter((entry) => entry.candidateIndex === candidateIndex).map((entry) => entry.observation);
      const safe = observations.length === this.options.calibration.probesPerDirection && observations.every((entry) => entry.received && entry.bytePerfect && !entry.corrupt && !entry.missing && !entry.clipping && entry.confidence >= 0.5);
      const latency = observations.reduce((sum, entry) => sum + entry.latencyMs, 0) / Math.max(1, observations.length);
      return { candidate, safe, latency };
    }).filter((entry) => entry.safe);
    ranked.sort((left, right) => left.latency - right.latency || left.candidate.playbackGain - right.candidate.playbackGain || right.candidate.payloadBytes - left.candidate.payloadBytes || left.candidate.id.localeCompare(right.candidate.id));
    return ranked[0]?.candidate;
  }
  private driveProbe(direction: 'AtoB' | 'BtoA'): void {
    if (this.options.role !== this.expectedSender(direction) || this.#state !== this.stateFor(direction) || !this.#sessionId) return;
    const ordinal = this.#sentProbes[direction]; const total = this.options.candidates.length * this.options.calibration.probesPerDirection;
    if (ordinal >= total) return;
    const probe = this.probeFor(direction, ordinal); this.#sentProbes[direction] += 1;
    this.send(Fas1UnitType.Probe, this.#sessionId, new Uint8Array([this.directionByte(direction), probe.candidateIndex, probe.probeIndex]));
  }
  private queueCommit(): void {
    this.#work = this.#work.then(async () => {
      if (this.#state !== 'Committing' || !this.#sessionId || !this.#selected.AtoB || !this.#selected.BtoA) return;
      this.#settings = { aToB: this.toSettings(this.#selected.AtoB), bToA: this.toSettings(this.#selected.BtoA) };
      this.#settingsDigest = await digestSettings(this.#settings);
      this.send(Fas1UnitType.Commit, this.#sessionId, this.#settingsDigest);
    }).catch(() => this.fail('acoustic_commit_failed'));
  }
  private onCommit(sessionId: bigint, body: Uint8Array): void {
    if (this.options.role !== 'A' || this.#state !== 'Committing' || sessionId !== this.#sessionId || body.byteLength !== 32 || !this.#selected.AtoB || !this.#selected.BtoA) return;
    const received = body.slice();
    this.#work = this.#work.then(async () => {
      if (this.#state !== 'Committing' || !this.#sessionId) return;
      this.#settings = { aToB: this.toSettings(this.#selected.AtoB!), bToA: this.toSettings(this.#selected.BtoA!) };
      const digest = await digestSettings(this.#settings);
      if (!equal(received, digest)) { this.fail('acoustic_commit_digest_mismatch'); return; }
      this.#settingsDigest = digest; this.#state = 'AwaitingHeartbeat'; this.send(Fas1UnitType.CommitAck, this.#sessionId, digest);
    }).catch(() => this.fail('acoustic_commit_failed'));
  }
  private onCommitAck(sessionId: bigint, body: Uint8Array): void {
    if (this.options.role !== 'B' || this.#state !== 'Committing' || sessionId !== this.#sessionId || !equal(body, this.#settingsDigest)) return;
    this.#state = 'AwaitingHeartbeat';
  }
  private onHeartbeat(sessionId: bigint): void {
    if (sessionId !== this.#sessionId || (this.#state !== 'AwaitingHeartbeat' && this.#state !== 'Ready')) return;
    const reply = this.#state === 'AwaitingHeartbeat'; this.#state = 'Ready';
    if (reply) this.heartbeat();
  }
  private toSettings(candidate: AcousticCandidate): DirectionalSettings { return { profileId: candidate.profileId, payloadBytes: candidate.payloadBytes, repetition: candidate.repetition, guardMs: candidate.guardMs, playbackGain: candidate.playbackGain, ackTimeoutMs: candidate.ackTimeoutMs }; }
  private fail(reason: string): void { if (this.#timer !== undefined) this.options.timers.clearTimeout(this.#timer); this.#timer = undefined; this.#state = 'Error'; this.#reason = reason; }
  private mutualRange(peer: AcousticCapabilityRange): boolean { return peer.minPayloadBytes <= this.options.ranges.maxPayloadBytes && peer.maxPayloadBytes >= this.options.ranges.minPayloadBytes; }
  private send(type: Fas1UnitType, sessionId: bigint, body: Uint8Array): void { const raw = encodeFas1({ type, flags: 0, sessionId, sequence: this.#sequence++, packetId: 0, fragmentIndex: 0, fragmentCount: 0, packetLength: 0, body }); void this.options.modem.send(raw); }
}
