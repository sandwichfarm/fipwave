import { createParityUnits, decodeFas1, digestSettings, encodeFas1, FAS1_PARITY_GROUP_SIZE, Fas1Sender, Fas1UnitType, fragmentPacket, reassemblePacket, recoverFragmentWithParity, resolveAcousticProfile, type AcousticSettings, type DirectionalSettings, type Fas1Unit } from './acoustic-protocol.js';

export type AcousticRole = 'A' | 'B';
export type AcousticSessionState = 'Idle' | 'Listening' | 'HelloSent' | 'HelloAckSent' | 'CapsSent' | 'CalibratingAToB' | 'CalibratingBToA' | 'Committing' | 'AwaitingHeartbeat' | 'Ready' | 'Degraded' | 'Recovering' | 'Error';
export type AcousticTrafficClass = 'control' | 'heartbeat' | 'ordinary';
export type AcousticTransmitMode = 'ceremony' | 'data';
export interface AcousticQueueResult { readonly accepted: boolean; readonly reason?: string; readonly packetId?: number; }
export interface AcousticDeliveryResult { readonly delivered: boolean; readonly reason?: string; readonly packetId?: number; }

export interface AcousticModem {
  send(unit: Uint8Array, mode?: AcousticTransmitMode): void | Promise<void>;
  onUnit(handler: (unit: Uint8Array) => void): () => void;
  /** Applies the candidate before its numbered probe or subsequent transmit. */
  applyCandidate?(candidate: AcousticCandidate): void;
}

export interface AcousticClock { now(): number; }
export interface AcousticTimers { setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>; clearTimeout(handle: ReturnType<typeof setTimeout>): void; }
export interface AcousticCapabilityRange { readonly minPayloadBytes: number; readonly maxPayloadBytes: number; }
export interface AcousticCandidate extends DirectionalSettings { readonly id: string; }
export interface AcousticProbe { readonly direction: 'AtoB' | 'BtoA'; readonly candidateIndex: number; readonly probeIndex: number; readonly candidate: AcousticCandidate; }
export interface AcousticProbeObservation { readonly received: boolean; readonly bytePerfect: boolean; readonly corrupt: boolean; readonly missing: boolean; readonly duplicate: boolean; readonly discontinuity: boolean; /** Undefined means the browser cannot measure one-way latency. */ readonly latencyMs: number | undefined; /** Undefined means the codec exposes no calibrated signal meter. */ readonly signalDb: number | undefined; /** Undefined means the browser has no clipping meter. */ readonly clipping: boolean | undefined; readonly confidence: number; }
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
  /** Use the prequalified fixed candidate first; retry failures enter full calibration. */
  readonly fastBootstrap?: boolean;
  readonly measureProbe: (probe: AcousticProbe) => AcousticProbeObservation;
  readonly onPacket?: (packet: Uint8Array, result: AcousticDeliveryResult) => void;
  /** Called after an asynchronous fast bootstrap makes the packet boundary usable. */
  readonly onReady?: () => void;
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
  /** Local monotonic/clock evidence of the accepted current-session heartbeat. */
  readonly lastHeartbeatAtMs?: number;
  readonly counters: Readonly<{ retries: number; dropped: number; duplicates: number; queuedPackets: number; queuedBytes: number; deliveredPackets: number; deliveredBytesTx: number; deliveredBytesRx: number; parityFramesTx: number; parityFramesRx: number; recoveredFragments: number; warmResumes: number; }>;
}

interface PendingPacket { readonly packetId: number; readonly packet: Uint8Array; readonly fragments: readonly Fas1Unit[]; readonly parity: readonly Fas1Unit[]; readonly trafficClass: AcousticTrafficClass; readonly fastControl: boolean; readonly fastAckFor?: number; readonly expiresAt: number; attempts: number; acknowledged: number; paritySent: number; }
interface InboundAssembly { readonly packetId: number; readonly fragmentCount: number; readonly packetLength: number; readonly fragments: Map<number, Fas1Unit>; readonly parity: Map<number, Fas1Unit>; readonly expiresAt: number; }

interface Handshake { readonly role: AcousticRole; readonly identity: string; readonly expectedPeer: string; readonly nonce: Uint8Array; readonly echoedNonce?: Uint8Array; readonly profiles: readonly string[]; readonly ranges: AcousticCapabilityRange; readonly epoch: number; readonly sessionId?: bigint; readonly fastBootstrap: boolean; }

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
const MAX_QUEUED_PACKETS = 16;
const MAX_DELIVERED_IDS = 32;
// A complete FIPS packet can span several audible modem frames, and several
// complete packets may be queued for the progressive image. Keep the bound
// finite while allowing that legitimate slow-link work to finish.
const MAX_PACKET_AGE_MS = 600_000;
const MAX_ATTEMPTS = 3;
const WINDOW_SIZE = 8;
/** Marks a one-fragment bootstrap-control DATA frame without changing its CRC-bound payload. */
const FAST_CONTROL_SEQUENCE_FLAG = 0x8000_0000;
const FAST_CONTROL_SEQUENCE_MAX = FAST_CONTROL_SEQUENCE_FLAG - 1;
// A local FIPS response normally appears within one event-loop turn of a
// received Noise handshake message. Give it a tiny chance to carry the FAS1
// acknowledgement, but retain an ordinary ACK when it does not.
const FAST_ACK_COALESCE_MS = 75;
const HANDSHAKE_RETRY_MS = 2_500;
// A control waveform is 597 ms and the first browser/native encode can add
// nearly another half second. Retrying at 400 ms lets a sender decode its own
// retry before its peer's first acknowledgement reaches it.
const FAST_HANDSHAKE_RETRY_MS = 1_800;
const FAST_HANDSHAKE_ATTEMPTS = 2;
const PROBE_RETRY_MS = 1_500;
const COMMIT_RETRY_MS = 2_000;
const CEREMONY_TYPES = new Set([
  Fas1UnitType.Hello,
  Fas1UnitType.HelloAck,
  Fas1UnitType.Caps,
  Fas1UnitType.Commit,
  Fas1UnitType.CommitAck,
  Fas1UnitType.Reset,
]);

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
function senderFlag(role: AcousticRole): Fas1Sender { return role === 'A' ? Fas1Sender.A : Fas1Sender.B; }
function toSessionId(nonce: Uint8Array): bigint {
  if (nonce.byteLength !== 16) invalid('nonce must be 128 bits');
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  const id = view.getBigUint64(0, true) ^ view.getBigUint64(8, true);
  return id === 0n ? 1n : id;
}
function sameProfiles(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function validRange(value: AcousticCapabilityRange): boolean { return validInteger(value.minPayloadBytes, 1, 217) && validInteger(value.maxPayloadBytes, value.minPayloadBytes, 217); }
function sameDirectionalSettings(left: DirectionalSettings, right: DirectionalSettings): boolean {
  return left.profileId === right.profileId
    && left.payloadBytes === right.payloadBytes
    && left.repetition === right.repetition
    && left.guardMs === right.guardMs
    && left.playbackGain === right.playbackGain
    && left.ackTimeoutMs === right.ackTimeoutMs;
}
function copySettings(settings: AcousticSettings): AcousticSettings {
  return { aToB: { ...settings.aToB }, bToA: { ...settings.bToA } };
}

/** Compact strict control payload: never exposes a permissive JSON parsing boundary to acoustic input. */
function encodeHandshake(value: Handshake): Uint8Array {
  if (!value.identity || !value.expectedPeer || value.identity === value.expectedPeer || value.nonce.byteLength !== 16 || !nonZero(value.nonce) || !validRange(value.ranges) || value.profiles.length < 1 || value.profiles.length > MAX_PROFILES || !validInteger(value.epoch, 0, 0xffff_ffff)) invalid('handshake is invalid');
  const identity = encoder.encode(value.identity); const expected = encoder.encode(value.expectedPeer);
  if (identity.byteLength > MAX_IDENTITY_BYTES || expected.byteLength > MAX_IDENTITY_BYTES) invalid('identity is invalid');
  const profiles = value.profiles.map((profile) => encoder.encode(profile));
  if (profiles.some((profile) => profile.byteLength < 1 || profile.byteLength > MAX_PROFILE_BYTES)) invalid('profile set is invalid');
  const output = new Uint8Array(1 + 1 + 1 + 1 + identity.byteLength + 1 + expected.byteLength + 16 + 1 + profiles.reduce((sum, profile) => sum + 1 + profile.byteLength, 0) + 4 + 4 + 4 + (value.echoedNonce ? 16 : 0) + (value.sessionId === undefined ? 0 : 8));
  const view = new DataView(output.buffer); let offset = 0;
  output[offset++] = 2; output[offset++] = roleByte(value.role); output[offset++] = value.fastBootstrap ? 1 : 0;
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
    if (byte() !== 2) invalid('handshake version is invalid');
    const role = parseRole(byte()); const fastFlag = byte(); if (fastFlag !== 0 && fastFlag !== 1) invalid('handshake fast bootstrap flag is invalid'); const identity = text(); const expectedPeer = text();
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
      role, identity, expectedPeer, nonce, profiles, ranges, epoch, fastBootstrap: fastFlag === 1,
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
  #handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  #fastAckTimer: ReturnType<typeof setTimeout> | undefined;
  #pendingFastAck: number | undefined;
  #handshakeAttempts = 0;
  #probeTimer: ReturnType<typeof setTimeout> | undefined;
  #probeRetry: { direction: 'AtoB' | 'BtoA'; ordinal: number; attempts: number } | undefined;
  #lastProbeReport: Partial<Record<'AtoB' | 'BtoA', { ordinal: number; body: Uint8Array }>> = {};
  #commitTimer: ReturnType<typeof setTimeout> | undefined;
  #commitAttempts = 0;
  #reason: string | undefined;
  #ledger: AcousticProbeLedgerEntry[] = [];
  #sentProbes: Record<'AtoB' | 'BtoA', number> = { AtoB: 0, BtoA: 0 };
  #receivedReports: Record<'AtoB' | 'BtoA', number> = { AtoB: 0, BtoA: 0 };
  #receivedProbes: Record<'AtoB' | 'BtoA', number> = { AtoB: 0, BtoA: 0 };
  #selected: Partial<Record<'AtoB' | 'BtoA', AcousticCandidate>> = {};
  #settings: AcousticSettings | undefined;
  #settingsDigest: Uint8Array | undefined;
  #lastHeartbeatAtMs: number | undefined;
  #work: Promise<void> = Promise.resolve();
  #turnOwner: AcousticRole | undefined;
  #packetId = 1;
  #queues: Record<AcousticTrafficClass, PendingPacket[]> = { control: [], heartbeat: [], ordinary: [] };
  #active: PendingPacket | undefined;
  #inbound: InboundAssembly | undefined;
  #lastAck: { packetId: number; bitmap: number } | undefined;
  #delivered = new Map<number, number>();
  #deliveryTimer: ReturnType<typeof setTimeout> | undefined;
  #heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  #heartbeatDeadline: ReturnType<typeof setTimeout> | undefined;
  #heartbeatTimerGeneration = 0;
  /** A one-bit highest-priority control queue; only the current turn owner drains it. */
  #heartbeatDue = false;
  #generation = 0;
  #awaitingAck = false;
  #recoveryAttempts = 0;
  #retiredSessionIds = new Set<bigint>();
  #provenSettings: AcousticSettings | undefined;
  #provenDigest: Uint8Array | undefined;
  #peerResumeDigest: Uint8Array | undefined;
  #resuming = false;
  #fastBootstrapActive = false;
  #counters = {
    retries: 0,
    dropped: 0,
    duplicates: 0,
    deliveredPackets: 0,
    deliveredBytesTx: 0,
    deliveredBytesRx: 0,
    parityFramesTx: 0,
    parityFramesRx: 0,
    recoveredFragments: 0,
    warmResumes: 0,
  };

  constructor(private readonly options: AcousticSessionOptions) {
    if (!options.identity || !options.expectedPeer || options.identity === options.expectedPeer || !validRange(options.ranges) || options.profiles.length < 1 || options.profiles.length > MAX_PROFILES || options.candidates.length < 1 || options.candidates.length > options.calibration.maxCandidates || !validInteger(options.calibration.probesPerDirection, 1, 4) || !validInteger(options.calibration.deadlineMs, 1, 120_000) || typeof options.measureProbe !== 'function') invalid('options are invalid');
    for (const profile of options.profiles) resolveAcousticProfile(profile);
    for (const candidate of options.candidates) {
      if (!candidate.id || candidate.playbackGain < 1 || candidate.playbackGain > 2 || !validInteger(candidate.payloadBytes, options.ranges.minPayloadBytes, options.ranges.maxPayloadBytes) || !validInteger(candidate.repetition, 1, 3) || !validInteger(candidate.guardMs, 1, 5_000) || !validInteger(candidate.ackTimeoutMs, 4_000, 15_000)) invalid('candidate is invalid');
      resolveAcousticProfile(candidate.profileId);
    }
    this.#fastBootstrapActive = options.fastBootstrap === true;
    this.#state = options.role === 'A' ? 'Idle' : 'Listening';
    this.#unsubscribe = options.modem.onUnit((unit) => this.receive(unit));
  }

  get snapshot(): AcousticSessionSnapshot {
    const turnOwner = this.#state === 'CalibratingAToB' ? 'A' : this.#state === 'CalibratingBToA' ? 'B' : this.#turnOwner;
    return Object.freeze({
      state: this.#state, role: this.options.role, epoch: this.#epoch, ready: this.#state === 'Ready', ledger: this.#ledger.map((entry) => ({ ...entry, candidate: { ...entry.candidate }, observation: { ...entry.observation } })),
      ...(this.#sessionId === undefined ? {} : { sessionId: this.#sessionId }),
      ...(turnOwner === undefined ? {} : { turnOwner }),
      ...(this.#reason === undefined ? {} : { reason: this.#reason }),
      ...(this.#settings === undefined ? {} : { settings: { aToB: { ...this.#settings.aToB }, bToA: { ...this.#settings.bToA } } }),
      ...(this.#settingsDigest === undefined ? {} : { settingsDigest: this.#settingsDigest.slice() }),
      ...(this.#lastHeartbeatAtMs === undefined ? {} : { lastHeartbeatAtMs: this.#lastHeartbeatAtMs }),
      counters: Object.freeze({ ...this.#counters, queuedPackets: this.queueLength(), queuedBytes: this.queueBytes() }),
    });
  }

  enqueuePacket(packet: Uint8Array, trafficClass: AcousticTrafficClass = 'ordinary'): AcousticQueueResult {
    this.expireWork();
    if (this.#state !== 'Ready' || !this.#sessionId) return { accepted: false, reason: 'acoustic_not_ready' };
    if (!(packet instanceof Uint8Array) || packet.byteLength < 1 || packet.byteLength > 1_357) return { accepted: false, reason: 'acoustic_packet_bounds' };
    if (!['control', 'heartbeat', 'ordinary'].includes(trafficClass)) return { accepted: false, reason: 'acoustic_class_invalid' };
    // FIPS can retry the same handshake/heartbeat datagram before its first
    // acoustic copy has crossed the room. Coalesce only copies that are still
    // active or queued; accepting them as the same pending delivery prevents
    // transport-level retries from filling the much slower acoustic queue.
    const duplicatePending = [
      ...(this.#active ? [this.#active] : []),
      ...this.#queues.control,
      ...this.#queues.heartbeat,
      ...this.#queues.ordinary,
    ].find((entry) => entry.trafficClass === trafficClass && equal(entry.packet, packet));
    if (duplicatePending) {
      this.#counters.duplicates += 1;
      return { accepted: true, packetId: duplicatePending.packetId };
    }
    if (this.queueLength() + (this.#active ? 1 : 0) >= MAX_QUEUED_PACKETS) return { accepted: false, reason: 'acoustic_queue_full' };
    const packetId = this.nextPacketId();
    const copied = packet.slice();
    const fragments = fragmentPacket({ sessionId: this.#sessionId, sequenceStart: this.#sequence, packetId, packet: copied, sender: senderFlag(this.options.role), payloadBytes: this.outboundSettings().payloadBytes });
    // FIPS's opening XK messages are one control fragment. They already have
    // FIPS-level retransmission, while FAS1 still binds every frame with its
    // CRC and retains a local ACK/retry. Mark only these startup controls so
    // the receiver can hand the acoustic turn directly to its ACK instead of
    // spending two extra, empty TURN_END waveforms per handshake message.
    const fastControl = this.#fastBootstrapActive && trafficClass === 'control' && fragments.length === 1 && this.#sequence <= FAST_CONTROL_SEQUENCE_MAX;
    const fastAckFor = fastControl ? this.#pendingFastAck : undefined;
    const markedFragments = fastControl
      ? fragments.map((fragment) => ({ ...fragment, sequence: (FAST_CONTROL_SEQUENCE_FLAG | (fastAckFor ?? 0)) >>> 0 }))
      : fragments;
    const parity = fastControl ? [] : createParityUnits(markedFragments, this.outboundSettings().payloadBytes);
    const pending: PendingPacket = {
      packetId,
      packet: copied,
      fragments: markedFragments,
      parity,
      trafficClass,
      fastControl,
      ...(fastAckFor === undefined ? {} : { fastAckFor }),
      expiresAt: this.options.clock.now() + MAX_PACKET_AGE_MS,
      attempts: 0,
      acknowledged: 0,
      paritySent: 0,
    };
    this.#sequence += pending.fragments.length + pending.parity.length;
    this.#queues[trafficClass].push(pending);
    this.driveTurn();
    return { accepted: true, packetId };
  }

  start(): boolean {
    if (this.options.role !== 'A' || this.#state !== 'Idle') return false;
    const nonce = this.options.nonce().slice();
    if (nonce.byteLength !== 16) invalid('nonce must be 128 bits');
    this.#localNonce = nonce; this.#sessionId = toSessionId(nonce); this.#state = 'HelloSent';
    if (this.#fastBootstrapActive) this.options.modem.applyCandidate?.(this.fastestCandidate());
    const completion = this.send(Fas1UnitType.Hello, 0n, encodeHandshake({ role: 'A', identity: this.options.identity, expectedPeer: this.options.expectedPeer, nonce, profiles: this.options.profiles, ranges: this.options.ranges, epoch: this.#epoch, sessionId: this.#sessionId, fastBootstrap: this.#fastBootstrapActive }));
    this.continueHandshakeAfterPlayback(completion, 'HelloSent');
    return true;
  }

  reset(epoch: number): void {
    if (!validInteger(epoch, 0, 0xffff_ffff)) invalid('epoch is invalid');
    const sameEpoch = epoch === this.#epoch;
    if (!sameEpoch) {
      this.#retiredSessionIds.clear();
      this.#provenSettings = undefined;
      this.#provenDigest = undefined;
    }
    else if (this.#sessionId !== undefined) {
      this.#retiredSessionIds.add(this.#sessionId);
      while (this.#retiredSessionIds.size > 8) this.#retiredSessionIds.delete(this.#retiredSessionIds.values().next().value!);
    }
    if (this.#timer !== undefined) this.options.timers.clearTimeout(this.#timer);
    this.clearFastAck();
    this.clearHandshakeRetry();
    this.clearProbeRetry();
    this.clearCommitRetry();
    if (this.#deliveryTimer !== undefined) this.options.timers.clearTimeout(this.#deliveryTimer);
    this.clearHeartbeatTimers(); this.#generation += 1;
    this.#timer = undefined; this.#deliveryTimer = undefined; this.#epoch = epoch; this.#sessionId = undefined; this.#localNonce = undefined; this.#peerNonce = undefined; this.#sequence = 1; this.#reason = undefined; this.#ledger = []; this.#sentProbes = { AtoB: 0, BtoA: 0 }; this.#receivedReports = { AtoB: 0, BtoA: 0 }; this.#receivedProbes = { AtoB: 0, BtoA: 0 }; this.#lastProbeReport = {}; this.#selected = {}; this.#settings = undefined; this.#settingsDigest = undefined; this.#peerResumeDigest = undefined; this.#resuming = false; this.#lastHeartbeatAtMs = undefined; this.#turnOwner = undefined; this.#heartbeatDue = false; this.#queues = { control: [], heartbeat: [], ordinary: [] }; this.#active = undefined; this.#inbound = undefined; this.#lastAck = undefined; this.#delivered.clear(); this.#awaitingAck = false; this.#recoveryAttempts = 0; this.#work = Promise.resolve(); this.#state = this.options.role === 'A' ? 'Idle' : 'Listening';
  }

  dispose(): void { this.reset(this.#epoch); this.#unsubscribe(); }
  async settle(): Promise<void> { let current: Promise<void>; do { current = this.#work; await current; } while (current !== this.#work); }
  /**
   * Periodic/manual liveness is control work, not an out-of-band transmission.
   * The scheduler emits it only after the local peer owns a legal data turn.
   */
  heartbeat(): boolean {
    if (!this.#sessionId || this.#state !== 'Ready') return false;
    this.#heartbeatDue = true;
    this.driveTurn();
    return true;
  }
  markHeartbeatMissed(): void {
    if (this.#state !== 'Ready' && this.#state !== 'Recovering') return;
    this.clearDeliveryTimer(); this.clearHeartbeatTimers(); this.#awaitingAck = false; this.#state = 'Degraded'; this.#reason = 'acoustic_heartbeat_missed';
    this.schedule(() => this.beginRecovery(), this.guardMs());
  }

  receive(raw: Uint8Array): void {
    let unit;
    try { unit = decodeFas1(raw); } catch { return; }
    // Laptop speakers are directly audible to their own microphones. Every
    // FAS1 unit therefore carries its CRC-bound sender role, and a session
    // accepts only its configured peer's frames. Without this check a node can
    // acknowledge its own TURN_END or heartbeat and split the token state.
    if (unit.flags !== senderFlag(complement(this.options.role))) return;
    try {
      if (unit.type === Fas1UnitType.Hello) this.onHello(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.HelloAck) this.onHelloAck(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.Caps) this.onCaps(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.Probe) this.onProbe(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.Report) this.onReport(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.Commit) this.onCommit(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.CommitAck) this.onCommitAck(unit.sessionId, unit.body);
      else if (unit.type === Fas1UnitType.Heartbeat) this.onHeartbeat(unit.sessionId);
      else if (unit.type === Fas1UnitType.Data) this.onData(unit);
      else if (unit.type === Fas1UnitType.Parity) this.onParity(unit);
      else if (unit.type === Fas1UnitType.TurnEnd) this.onTurnEnd(unit.sessionId);
      else if (unit.type === Fas1UnitType.Ack) this.onAck(unit.sessionId, unit.packetId, unit.sequence);
      else if (unit.type === Fas1UnitType.Reset) this.onReset(unit.sessionId);
      // Only a CRC-valid frame from the configured peer and current session
      // proves acoustic liveness. Queue occupancy and local playback do not:
      // either can remain non-empty forever after the peer goes silent.
      if (this.#state === 'Ready' && unit.sessionId === this.#sessionId) this.armHeartbeatTimers();
    } catch { /* Ambient/malformed units never mutate a legal state. */ }
  }

  private queueLength(): number { return this.#queues.control.length + this.#queues.heartbeat.length + this.#queues.ordinary.length; }
  private queueBytes(): number { return [...this.#queues.control, ...this.#queues.heartbeat, ...this.#queues.ordinary].reduce((total, item) => total + item.packet.byteLength, 0) + (this.#active?.packet.byteLength ?? 0); }
  private nextPacketId(): number { const value = this.#packetId; this.#packetId = this.#packetId === 0xffff_ffff ? 1 : this.#packetId + 1; return value; }
  private clearDeliveryTimer(): void { if (this.#deliveryTimer !== undefined) this.options.timers.clearTimeout(this.#deliveryTimer); this.#deliveryTimer = undefined; }
  private clearHandshakeRetry(): void {
    if (this.#handshakeTimer !== undefined) this.options.timers.clearTimeout(this.#handshakeTimer);
    this.#handshakeTimer = undefined; this.#handshakeAttempts = 0;
  }
  private clearFastAck(): void {
    if (this.#fastAckTimer !== undefined) this.options.timers.clearTimeout(this.#fastAckTimer);
    this.#fastAckTimer = undefined;
    this.#pendingFastAck = undefined;
  }
  private clearProbeRetry(): void {
    if (this.#probeTimer !== undefined) this.options.timers.clearTimeout(this.#probeTimer);
    this.#probeTimer = undefined;
    this.#probeRetry = undefined;
  }
  private clearCommitRetry(): void {
    if (this.#commitTimer !== undefined) this.options.timers.clearTimeout(this.#commitTimer);
    this.#commitTimer = undefined;
    this.#commitAttempts = 0;
  }
  private continueHandshakeAfterPlayback(completion: void | Promise<void>, expectedState: 'HelloSent' | 'HelloAckSent' | 'CapsSent'): void {
    const generation = this.#generation;
    void Promise.resolve(completion).then(
      () => {
        if (generation === this.#generation && this.#state === expectedState) this.armHandshakeRetry();
      },
      () => {
        if (generation === this.#generation && this.#state === expectedState) this.fail('acoustic_handshake_playback_failed');
      },
    );
  }
  private armCommitRetry(): void {
    if (this.options.role !== 'B' || (this.#state !== 'Committing' && this.#state !== 'AwaitingHeartbeat') || !this.#sessionId || !this.#settingsDigest || this.#commitTimer !== undefined) return;
    const epoch = this.#epoch; const sessionId = this.#sessionId; const generation = this.#generation;
    this.#commitTimer = this.options.timers.setTimeout(() => {
      this.#commitTimer = undefined;
      if (epoch !== this.#epoch || sessionId !== this.#sessionId || generation !== this.#generation || (this.#state !== 'Committing' && this.#state !== 'AwaitingHeartbeat') || !this.#settingsDigest) return;
      if (this.#resuming && this.#commitAttempts >= MAX_ATTEMPTS) {
        this.invalidateAndRestartResume();
        return;
      }
      this.#commitAttempts += 1;
      this.#counters.retries += 1;
      const completion = this.send(Fas1UnitType.Commit, sessionId, this.#settingsDigest);
      void Promise.resolve(completion).then(
        () => this.armCommitRetry(),
        () => this.fail('acoustic_commit_failed'),
      );
    }, COMMIT_RETRY_MS);
  }
  private armProbeRetry(direction: 'AtoB' | 'BtoA', ordinal: number): void {
    this.clearProbeRetry();
    this.#probeRetry = { direction, ordinal, attempts: 0 };
    const scheduleRetry = (): void => {
      const pending = this.#probeRetry;
      if (!pending || pending.direction !== direction || pending.ordinal !== ordinal || this.#state !== this.stateFor(direction) || this.options.role !== this.expectedSender(direction) || !this.#sessionId) return;
      this.#probeTimer = this.options.timers.setTimeout(() => {
        this.#probeTimer = undefined;
        const current = this.#probeRetry;
        if (!current || current.direction !== direction || current.ordinal !== ordinal || this.#state !== this.stateFor(direction) || this.options.role !== this.expectedSender(direction) || !this.#sessionId) return;
        current.attempts += 1;
        this.#counters.retries += 1;
        const probe = this.probeFor(direction, ordinal);
        this.options.modem.applyCandidate?.(probe.candidate);
        const completion = this.send(Fas1UnitType.Probe, this.#sessionId, new Uint8Array([this.directionByte(direction), probe.candidateIndex, probe.probeIndex]));
        void Promise.resolve(completion).then(
          scheduleRetry,
          () => this.fail('acoustic_probe_playback_failed'),
        );
      }, PROBE_RETRY_MS);
    };
    scheduleRetry();
  }
  private armHandshakeRetry(): void {
    if (!['HelloSent', 'HelloAckSent', 'CapsSent'].includes(this.#state) || this.#handshakeTimer !== undefined) return;
    const epoch = this.#epoch; const sessionId = this.#sessionId; const generation = this.#generation;
    this.#handshakeTimer = this.options.timers.setTimeout(() => {
      this.#handshakeTimer = undefined;
      if (epoch !== this.#epoch || sessionId !== this.#sessionId || generation !== this.#generation || !['HelloSent', 'HelloAckSent', 'CapsSent'].includes(this.#state)) return;
      if (this.#fastBootstrapActive && this.#state === 'HelloSent' && this.#handshakeAttempts >= FAST_HANDSHAKE_ATTEMPTS) {
        this.restartWithCalibration();
        return;
      }
      this.#handshakeAttempts += 1; this.#counters.retries += 1;
      const expectedState = this.#state as 'HelloSent' | 'HelloAckSent' | 'CapsSent';
      let completion: void | Promise<void>;
      if (this.#state === 'HelloSent' && this.#localNonce && this.#sessionId) {
        completion = this.send(Fas1UnitType.Hello, 0n, encodeHandshake({ role: 'A', identity: this.options.identity, expectedPeer: this.options.expectedPeer, nonce: this.#localNonce, profiles: this.options.profiles, ranges: this.options.ranges, epoch: this.#epoch, sessionId: this.#sessionId, fastBootstrap: this.#fastBootstrapActive }));
      } else if (this.#state === 'HelloAckSent' && this.#localNonce && this.#peerNonce && this.#sessionId) {
        completion = this.send(Fas1UnitType.HelloAck, this.#sessionId, encodeHandshake({ role: 'B', identity: this.options.identity, expectedPeer: this.options.expectedPeer, nonce: this.#localNonce, echoedNonce: this.#peerNonce, profiles: this.options.profiles, ranges: this.options.ranges, epoch: this.#epoch, fastBootstrap: this.#fastBootstrapActive }));
      } else if (this.#state === 'CapsSent' && this.#sessionId) {
        completion = this.send(Fas1UnitType.Caps, this.#sessionId, this.capsBody());
      } else return;
      this.continueHandshakeAfterPlayback(completion, expectedState);
    }, this.#fastBootstrapActive ? FAST_HANDSHAKE_RETRY_MS : HANDSHAKE_RETRY_MS);
  }
  private clearHeartbeatTimers(): void {
    if (this.#heartbeatTimer !== undefined) this.options.timers.clearTimeout(this.#heartbeatTimer);
    if (this.#heartbeatDeadline !== undefined) this.options.timers.clearTimeout(this.#heartbeatDeadline);
    this.#heartbeatTimer = undefined; this.#heartbeatDeadline = undefined; this.#heartbeatTimerGeneration += 1;
  }
  private armHeartbeatTimers(): void {
    if (!this.#sessionId || this.#state !== 'Ready') return;
    const epoch = this.#epoch; const sessionId = this.#sessionId; const generation = this.#generation;
    const current = () => epoch === this.#epoch && sessionId === this.#sessionId && generation === this.#generation && this.#state === 'Ready';
    const scheduleHeartbeat = (): void => {
      if (this.#heartbeatTimer !== undefined || !current()) return;
      this.#heartbeatTimer = this.options.timers.setTimeout(() => {
        this.#heartbeatTimer = undefined;
        if (!current()) return;
        this.heartbeat();
        scheduleHeartbeat();
      }, this.ackTimeoutMs());
    };
    scheduleHeartbeat();
    if (this.#heartbeatDeadline !== undefined) this.options.timers.clearTimeout(this.#heartbeatDeadline);
    const deadlineGeneration = ++this.#heartbeatTimerGeneration;
    this.#heartbeatDeadline = this.options.timers.setTimeout(() => {
      this.#heartbeatDeadline = undefined;
      if (deadlineGeneration !== this.#heartbeatTimerGeneration || !current()) return;
      this.markHeartbeatMissed();
    }, Math.max(60_000, this.ackTimeoutMs() * 4));
  }
  private outboundSettings(): DirectionalSettings { if (!this.#settings) invalid('settings are not committed'); return this.options.role === 'A' ? this.#settings.aToB : this.#settings.bToA; }
  private inboundPayloadBytes(): number { if (!this.#settings) invalid('settings are not committed'); return this.options.role === 'A' ? this.#settings.bToA.payloadBytes : this.#settings.aToB.payloadBytes; }
  private schedule(callback: () => void, delayMs: number): void {
    this.clearDeliveryTimer(); const epoch = this.#epoch; const sessionId = this.#sessionId;
    this.#deliveryTimer = this.options.timers.setTimeout(() => { this.#deliveryTimer = undefined; if (epoch !== this.#epoch || sessionId !== this.#sessionId) return; callback(); }, delayMs);
  }
  private guardMs(): number { return this.#settings ? (this.options.role === 'A' ? this.#settings.aToB.guardMs : this.#settings.bToA.guardMs) : 750; }
  private ackTimeoutMs(): number { return this.#settings ? (this.options.role === 'A' ? this.#settings.aToB.ackTimeoutMs : this.#settings.bToA.ackTimeoutMs) : 4_000; }
  private expireWork(): void {
    const now = this.options.clock.now();
    for (const priority of ['control', 'heartbeat', 'ordinary'] as const) {
      const retained = this.#queues[priority].filter((item) => {
        if (item.expiresAt >= now) return true;
        this.#counters.dropped += 1; return false;
      });
      this.#queues[priority] = retained;
    }
    if (this.#active && this.#active.expiresAt < now) { this.#active = undefined; this.#awaitingAck = false; this.#counters.dropped += 1; this.degrade('acoustic_packet_expired'); }
    if (this.#inbound && this.#inbound.expiresAt < now) { this.#inbound = undefined; this.#counters.dropped += 1; }
    for (const [packetId, expiresAt] of this.#delivered) if (expiresAt < now) this.#delivered.delete(packetId);
  }
  private dequeue(): PendingPacket | undefined { return this.#queues.control.shift() ?? this.#queues.heartbeat.shift() ?? this.#queues.ordinary.shift(); }
  private driveTurn(): void {
    this.expireWork();
    if (this.#state !== 'Ready' || !this.#sessionId || this.#turnOwner !== this.options.role || this.#awaitingAck) return;
    this.applyOutboundCandidate();
    // Real acoustic playback can exceed the heartbeat interval. Packet work is
    // itself liveness, so drain one queued FIPS packet before considering an
    // idle heartbeat; otherwise every slow turn can starve packet transit.
    this.#active ??= this.dequeue();
    if (!this.#active && this.#heartbeatDue) {
      this.#heartbeatDue = false;
      this.send(Fas1UnitType.Heartbeat, this.#sessionId, new Uint8Array());
      this.send(Fas1UnitType.TurnEnd, this.#sessionId, new Uint8Array());
      this.#turnOwner = complement(this.options.role);
      return;
    }
    if (!this.#active) {
      // A guarded empty turn keeps the deterministic token rotating.  It is
      // a scheduler operation, never a timer-side heartbeat transmission.
      this.send(Fas1UnitType.TurnEnd, this.#sessionId, new Uint8Array());
      this.#turnOwner = complement(this.options.role);
      return;
    }
    if (this.#active.attempts >= MAX_ATTEMPTS) { this.#counters.dropped += 1; this.#active = undefined; this.degrade('acoustic_retry_exhausted'); return; }
    const pending = this.#active; const missing = pending.fragments.filter((unit) => (pending.acknowledged & (1 << unit.fragmentIndex)) === 0).slice(0, WINDOW_SIZE);
    if (missing.length === 0) { this.#active = undefined; this.#turnOwner = complement(this.options.role); this.schedule(() => this.driveTurn(), this.guardMs()); return; }
    pending.attempts += 1; this.#awaitingAck = true;
    if (pending.fastAckFor !== undefined && pending.fastAckFor === this.#pendingFastAck) this.clearFastAck();
    const generation = this.#generation; const sessionId = this.#sessionId; const attempt = pending.attempts;
    const completions = missing.map((unit) => this.sendUnit(unit));
    if (!pending.fastControl) {
      const groupStarts = new Set(missing.map((unit) => unit.fragmentIndex - (unit.fragmentIndex % FAS1_PARITY_GROUP_SIZE)));
      for (const parity of pending.parity) {
        const groupBit = 1 << (parity.fragmentIndex / FAS1_PARITY_GROUP_SIZE);
        if (!groupStarts.has(parity.fragmentIndex) || (pending.paritySent & groupBit) !== 0) continue;
        pending.paritySent |= groupBit;
        completions.push(this.sendUnit(parity));
      }
    }
    if (!pending.fastControl) completions.push(this.send(Fas1UnitType.TurnEnd, this.#sessionId, new Uint8Array()));
    const armTimeout = () => {
      if (this.#generation !== generation || this.#sessionId !== sessionId || this.#state !== 'Ready' || this.#turnOwner !== this.options.role || !this.#awaitingAck || this.#active !== pending || pending.attempts !== attempt) return;
      this.schedule(() => this.onAckTimeout(pending.packetId, attempt), this.ackTimeoutMs());
    };
    const asynchronous = completions.some((completion) => completion instanceof Promise);
    if (asynchronous) void Promise.all(completions.map((completion) => Promise.resolve(completion))).then(armTimeout, () => this.degrade('acoustic_modem_playback_failed'));
    else armTimeout();
  }
  private onAckTimeout(packetId: number, attempt: number): void {
    if (!this.#active || !this.#awaitingAck || this.#active.packetId !== packetId || this.#active.attempts !== attempt) return;
    this.#awaitingAck = false; this.#counters.retries += 1; this.driveTurn();
  }
  private beginRecovery(): void {
    if (this.#state !== 'Degraded' || !this.#sessionId) return;
    if (this.#recoveryAttempts >= MAX_ATTEMPTS) { this.restartSession(); return; }
    this.#recoveryAttempts += 1; this.#counters.retries += 1;
    this.#state = 'Recovering'; this.#reason = undefined;
    const generation = this.#generation; const sessionId = this.#sessionId;
    const armTimeout = (): void => {
      if (generation !== this.#generation || sessionId !== this.#sessionId || this.#state !== 'Recovering') return;
      this.schedule(() => this.markHeartbeatMissed(), this.ackTimeoutMs());
    };
    if (this.options.role === 'A') {
      const completion = this.send(Fas1UnitType.Heartbeat, sessionId, new Uint8Array());
      if (completion instanceof Promise) {
        void completion.then(armTimeout, () => this.restartSession());
      } else {
        armTimeout();
      }
    } else armTimeout();
  }
  private restartSession(): void {
    const epoch = this.#epoch;
    const sessionId = this.#sessionId;
    const restart = (): void => {
      if (epoch !== this.#epoch || sessionId !== this.#sessionId) return;
      this.reset(epoch);
      if (this.options.role === 'A') this.start();
    };
    if (this.options.role !== 'A' || !sessionId) { restart(); return; }
    const completion = this.send(Fas1UnitType.Reset, sessionId, new Uint8Array());
    if (completion instanceof Promise) void completion.then(restart, restart);
    else restart();
  }
  private onReset(sessionId: bigint): void {
    if (sessionId !== this.#sessionId) return;
    const epoch = this.#epoch;
    this.reset(epoch);
    if (this.options.role === 'A') this.start();
  }
  private isFastControl(unit: Fas1Unit): boolean {
    return this.#fastBootstrapActive
      && unit.type === Fas1UnitType.Data
      && unit.fragmentCount === 1
      && (unit.sequence & FAST_CONTROL_SEQUENCE_FLAG) !== 0;
  }
  private fastAcknowledgement(unit: Fas1Unit): number | undefined {
    return this.isFastControl(unit) ? unit.sequence & FAST_CONTROL_SEQUENCE_MAX : undefined;
  }
  private prepareFastAcknowledgement(packetId: number): void {
    if (!this.#sessionId || packetId < 1 || packetId > FAST_CONTROL_SEQUENCE_MAX) return;
    this.#pendingFastAck = packetId;
    this.#turnOwner = this.options.role;
    if (this.#fastAckTimer !== undefined) return;
    const generation = this.#generation;
    const sessionId = this.#sessionId;
    this.#fastAckTimer = this.options.timers.setTimeout(() => {
      this.#fastAckTimer = undefined;
      if (generation !== this.#generation || sessionId !== this.#sessionId || this.#state !== 'Ready' || this.#pendingFastAck !== packetId) return;
      this.#pendingFastAck = undefined;
      this.acknowledgeFastControl(packetId, 1);
    }, FAST_ACK_COALESCE_MS);
  }
  private onData(unit: Fas1Unit): void {
    this.expireWork();
    const fastControl = this.isFastControl(unit);
    const fastAcknowledgement = this.fastAcknowledgement(unit);
    if (fastAcknowledgement && this.#active?.fastControl && this.#awaitingAck && this.#active.packetId === fastAcknowledgement) {
      this.onAck(unit.sessionId, fastAcknowledgement, (1 << this.#active.fragments.length) - 1);
    }
    const legalTurn = this.#turnOwner === complement(this.options.role)
      // If the ACK was lost, a retried fast DATA is the sender's proof that it
      // did not receive the handoff. Re-ACK it without delivering it twice.
      || (fastControl && this.#turnOwner === this.options.role);
    if (this.#state !== 'Ready' || unit.sessionId !== this.#sessionId || !legalTurn) return;
    if (fastControl && this.#turnOwner === this.options.role && this.#awaitingAck && this.#active?.fastControl) {
      // A CRC-valid peer control frame can only be emitted after that peer
      // accepted our immediately preceding fast turn. It therefore confirms
      // the lost ACK without waiting for a four-second retransmit timeout.
      const active = this.#active;
      this.#active = undefined;
      this.#awaitingAck = false;
      this.clearDeliveryTimer();
      this.#counters.deliveredBytesTx += active.packet.byteLength;
      this.#turnOwner = complement(this.options.role);
    }
    if (this.#delivered.has(unit.packetId)) {
      this.#counters.duplicates += 1;
      const bitmap = (1 << unit.fragmentCount) - 1;
      if (fastControl) this.prepareFastAcknowledgement(unit.packetId);
      else this.#lastAck = { packetId: unit.packetId, bitmap };
      return;
    }
    const expectedCount = Math.ceil(unit.packetLength / this.inboundPayloadBytes());
    const expectedLength = unit.fragmentIndex === expectedCount - 1 ? unit.packetLength - this.inboundPayloadBytes() * (expectedCount - 1) : this.inboundPayloadBytes();
    if (unit.fragmentCount !== expectedCount || unit.body.byteLength !== expectedLength) { this.#counters.dropped += 1; return; }
    const inbound = this.inboundFor(unit);
    if (!inbound) return;
    if (inbound.fragments.has(unit.fragmentIndex)) { this.#counters.duplicates += 1; }
    else inbound.fragments.set(unit.fragmentIndex, { ...unit, body: unit.body.slice() });
    if (fastControl) this.prepareFastAcknowledgement(unit.packetId);
    this.refreshInbound(inbound);
  }
  private onParity(unit: Fas1Unit): void {
    this.expireWork();
    if (this.#state !== 'Ready' || unit.sessionId !== this.#sessionId || this.#turnOwner !== complement(this.options.role)) return;
    this.#counters.parityFramesRx += 1;
    if (this.#delivered.has(unit.packetId)) {
      this.#counters.duplicates += 1;
      this.#lastAck = { packetId: unit.packetId, bitmap: (1 << unit.fragmentCount) - 1 };
      return;
    }
    const expectedCount = Math.ceil(unit.packetLength / this.inboundPayloadBytes());
    if (unit.fragmentCount !== expectedCount) { this.#counters.dropped += 1; return; }
    const inbound = this.inboundFor(unit);
    if (!inbound) return;
    if (inbound.parity.has(unit.fragmentIndex)) this.#counters.duplicates += 1;
    else {
      inbound.parity.set(unit.fragmentIndex, { ...unit, body: unit.body.slice() });
    }
    this.refreshInbound(inbound);
  }
  private inboundFor(unit: Fas1Unit): InboundAssembly | undefined {
    const existing = this.#inbound;
    if (existing && (existing.packetId !== unit.packetId || existing.fragmentCount !== unit.fragmentCount || existing.packetLength !== unit.packetLength)) {
      this.#counters.dropped += 1;
      return undefined;
    }
    if (!existing || existing.packetId !== unit.packetId) this.#lastAck = undefined;
    const inbound = existing ?? {
      packetId: unit.packetId,
      fragmentCount: unit.fragmentCount,
      packetLength: unit.packetLength,
      fragments: new Map<number, Fas1Unit>(),
      parity: new Map<number, Fas1Unit>(),
      expiresAt: this.options.clock.now() + MAX_PACKET_AGE_MS,
    };
    this.#inbound = inbound;
    return inbound;
  }
  private refreshInbound(inbound: InboundAssembly): void {
    for (const parity of inbound.parity.values()) {
      const recovered = recoverFragmentWithParity([...inbound.fragments.values()], parity, this.inboundPayloadBytes());
      if (!recovered || inbound.fragments.has(recovered.fragmentIndex)) continue;
      inbound.fragments.set(recovered.fragmentIndex, recovered);
      this.#counters.recoveredFragments += 1;
    }
    let bitmap = 0;
    for (const index of inbound.fragments.keys()) bitmap |= 1 << index;
    this.#lastAck = { packetId: inbound.packetId, bitmap };
    if (inbound.fragments.size !== inbound.fragmentCount) return;
    let packet: Uint8Array;
    try { packet = reassemblePacket([...inbound.fragments.values()], this.inboundPayloadBytes()); } catch { this.#inbound = undefined; this.#counters.dropped += 1; return; }
    if (packet.byteLength !== inbound.packetLength || this.#delivered.has(inbound.packetId)) return;
    this.#delivered.set(inbound.packetId, this.options.clock.now() + MAX_PACKET_AGE_MS);
    while (this.#delivered.size > MAX_DELIVERED_IDS) this.#delivered.delete(this.#delivered.keys().next().value!);
    this.#inbound = undefined;
    this.#counters.deliveredPackets += 1;
    this.#counters.deliveredBytesRx += packet.byteLength;
    this.options.onPacket?.(packet.slice(), { delivered: true, packetId: inbound.packetId });
  }
  private onTurnEnd(sessionId: bigint): void {
    if (this.#state !== 'Ready' || sessionId !== this.#sessionId || this.#turnOwner !== complement(this.options.role)) return;
    if (this.#inbound) this.refreshInbound(this.#inbound);
    // An ACK is meaningful only for a DATA packet.  Empty turns transfer
    // ownership without creating an unbound packet acknowledgement.
    if (this.#lastAck) {
      const ack = this.#lastAck;
      this.#lastAck = undefined;
      // ACK does not transfer the token. The sender explicitly yields after
      // receiving it, so a lost ACK cannot make both half-duplex peers believe
      // they own the next acoustic turn.
      this.#turnOwner = complement(this.options.role);
      this.sendAck(ack.packetId, ack.bitmap);
      return;
    }
    this.#turnOwner = this.options.role;
    this.schedule(() => this.driveTurn(), this.guardMs());
  }
  private acknowledgeFastControl(packetId: number, bitmap: number): void {
    if (!this.#sessionId) return;
    const generation = this.#generation;
    const sessionId = this.#sessionId;
    const completion = this.sendAck(packetId, bitmap);
    void Promise.resolve(completion).then(() => {
      if (this.#generation !== generation || this.#state !== 'Ready' || this.#sessionId !== sessionId) return;
      this.#turnOwner = this.options.role;
      // Do not emit an empty turn after the ACK. A queued FIPS response may
      // start immediately; otherwise a sender that missed the ACK can retry
      // its CRC-bound DATA and receive another ACK.
      if (this.queueLength() > 0 || this.#heartbeatDue) this.driveTurn();
    }, () => this.degrade('acoustic_modem_playback_failed'));
  }
  private sendAck(packetId: number, bitmap: number): void | Promise<void> {
    if (!this.#sessionId) return;
    const raw = encodeFas1({ type: Fas1UnitType.Ack, flags: senderFlag(this.options.role), sessionId: this.#sessionId, sequence: bitmap >>> 0, packetId, fragmentIndex: 0, fragmentCount: 0, packetLength: 0, body: new Uint8Array() });
    return this.options.modem.send(raw, 'data');
  }
  private onAck(sessionId: bigint, packetId: number, bitmap: number): void {
    if (this.#state !== 'Ready' || sessionId !== this.#sessionId || !this.#active || !this.#awaitingAck || packetId !== this.#active.packetId) return;
    const pending = this.#active; const legalMask = (1 << pending.fragments.length) - 1;
    if ((bitmap & ~legalMask) !== 0) return;
    const before = pending.acknowledged; pending.acknowledged |= bitmap;
    if (pending.acknowledged === before && pending.acknowledged !== legalMask) { this.#counters.duplicates += 1; return; }
    // A newly acknowledged fragment advances the bounded burst window. Retry
    // exhaustion applies to a stalled window, not to a large valid packet.
    if (pending.acknowledged !== before) pending.attempts = 0;
    this.#awaitingAck = false; this.clearDeliveryTimer();
    if (pending.acknowledged === legalMask) {
      this.#active = undefined;
      this.#counters.deliveredBytesTx += pending.packet.byteLength;
      if (pending.fastControl) {
        // The acknowledged fast control's ACK is also the token handoff.
        // Do not schedule an otherwise-empty TURN_END after it.
        this.#turnOwner = complement(this.options.role);
        return;
      }
      // Complete the two-step handoff: DATA/TURN_END → ACK → TURN_END. The
      // receiver remains passive until this explicit yield arrives.
      this.send(Fas1UnitType.TurnEnd, this.#sessionId, new Uint8Array());
      this.#turnOwner = complement(this.options.role);
      return;
    }
    this.#counters.retries += 1;
    this.#turnOwner = this.options.role;
    this.schedule(() => this.driveTurn(), this.guardMs());
  }
  private sendUnit(unit: Fas1Unit): void | Promise<void> {
    if (unit.type === Fas1UnitType.Parity) this.#counters.parityFramesTx += 1;
    return this.options.modem.send(encodeFas1(unit), 'data');
  }
  private degrade(reason: string): void {
    if (this.#state === 'Error' || this.#state === 'Degraded') return;
    this.clearDeliveryTimer(); this.#awaitingAck = false; this.#state = 'Degraded'; this.#reason = reason; this.schedule(() => this.beginRecovery(), this.guardMs());
  }

  private onHello(headerSessionId: bigint, body: Uint8Array): void {
    if (this.options.role !== 'B' || headerSessionId !== 0n) return;
    const hello = decodeHandshake(body);
    if (hello.role !== 'A' || hello.identity !== this.options.expectedPeer || hello.expectedPeer !== this.options.identity || hello.epoch !== this.#epoch || !hello.sessionId || !sameProfiles(hello.profiles, this.options.profiles) || !this.mutualRange(hello.ranges)) return;
    if (this.#retiredSessionIds.has(hello.sessionId)) return;
    if (this.#state !== 'Listening') {
      if (hello.sessionId === this.#sessionId) {
        if (this.#fastBootstrapActive && hello.fastBootstrap && this.#localNonce && this.#peerNonce) {
          this.send(Fas1UnitType.HelloAck, hello.sessionId, encodeHandshake({ role: 'B', identity: this.options.identity, expectedPeer: this.options.expectedPeer, nonce: this.#localNonce, echoedNonce: this.#peerNonce, profiles: this.options.profiles, ranges: this.options.ranges, epoch: this.#epoch, fastBootstrap: true }));
        }
        return;
      }
      this.reset(this.#epoch);
    }
    this.clearHandshakeRetry();
    const localNonce = this.options.nonce().slice(); if (localNonce.byteLength !== 16) invalid('nonce must be 128 bits');
    this.#sessionId = hello.sessionId; this.#peerNonce = hello.nonce; this.#localNonce = localNonce; this.#state = 'HelloAckSent';
    this.#fastBootstrapActive = this.options.fastBootstrap === true && hello.fastBootstrap;
    if (this.#fastBootstrapActive) this.prepareFastBootstrap();
    const completion = this.send(Fas1UnitType.HelloAck, hello.sessionId, encodeHandshake({ role: 'B', identity: this.options.identity, expectedPeer: this.options.expectedPeer, nonce: localNonce, echoedNonce: hello.nonce, profiles: this.options.profiles, ranges: this.options.ranges, epoch: this.#epoch, fastBootstrap: this.#fastBootstrapActive }));
    if (this.#fastBootstrapActive) this.activateFastBootstrapAfterPlayback(completion, 'HelloAckSent');
    else this.continueHandshakeAfterPlayback(completion, 'HelloAckSent');
  }

  private onHelloAck(sessionId: bigint, body: Uint8Array): void {
    if (this.options.role !== 'A' || this.#state !== 'HelloSent' || sessionId !== this.#sessionId || !this.#localNonce) return;
    const ack = decodeHandshake(body);
    if (ack.role !== 'B' || ack.identity !== this.options.expectedPeer || ack.expectedPeer !== this.options.identity || ack.epoch !== this.#epoch || ack.fastBootstrap !== this.#fastBootstrapActive || !equal(ack.echoedNonce, this.#localNonce) || !sameProfiles(ack.profiles, this.options.profiles) || !this.mutualRange(ack.ranges)) return;
    this.clearHandshakeRetry();
    this.#peerNonce = ack.nonce;
    if (this.#fastBootstrapActive) {
      this.prepareFastBootstrap();
      this.activateFastBootstrapAfterPlayback(undefined, 'HelloSent');
      return;
    }
    this.#state = 'CapsSent';
    const completion = this.send(Fas1UnitType.Caps, sessionId, this.capsBody());
    this.continueHandshakeAfterPlayback(completion, 'CapsSent');
  }

  private onCaps(sessionId: bigint, body: Uint8Array): void {
    const expectedA = this.options.role === 'A' ? this.#localNonce : this.#peerNonce;
    const expectedB = this.options.role === 'B' ? this.#localNonce : this.#peerNonce;
    if (sessionId !== this.#sessionId || !expectedA || !expectedB || (body.byteLength !== 33 && body.byteLength !== 65) || !equal(body.slice(0, 16), expectedA) || !equal(body.slice(16, 32), expectedB)) return;
    const resumeFlag = body[32]!;
    if ((resumeFlag === 0 && body.byteLength !== 33) || (resumeFlag === 1 && body.byteLength !== 65) || resumeFlag > 1) return;
    this.#peerResumeDigest = resumeFlag === 1 ? body.slice(33) : undefined;
    const canResume = this.#peerResumeDigest !== undefined && equal(this.#peerResumeDigest, this.resumeDigest());
    if (this.options.role === 'B' && this.#state === 'HelloAckSent') {
      this.clearHandshakeRetry();
      if (canResume && this.prepareResume()) {
        const completion = this.send(Fas1UnitType.Caps, sessionId, this.capsBody());
        void Promise.resolve(completion).then(() => this.queueResumeCommit(), () => this.invalidateAndRestartResume());
      } else {
        this.#state = 'CalibratingAToB';
        this.armDeadline();
        this.send(Fas1UnitType.Caps, sessionId, this.capsBody());
      }
      return;
    }
    if (this.options.role === 'B' && this.#state === 'Committing' && this.#resuming && canResume && this.#settingsDigest) {
      this.#counters.duplicates += 1;
      const completion = this.send(Fas1UnitType.Caps, sessionId, this.capsBody());
      void Promise.resolve(completion).then(() => {
        if (this.#state === 'Committing' && this.#sessionId === sessionId && this.#settingsDigest) this.send(Fas1UnitType.Commit, sessionId, this.#settingsDigest);
      });
      return;
    }
    if (this.options.role === 'B' && this.#state === 'CalibratingAToB') {
      // A remains CapsSent until it receives B's capability reply. If that
      // reply was lost, A retries its own CAPS while B has already advanced;
      // replay B's reply so both sides converge on the calibration state.
      this.#counters.duplicates += 1;
      this.send(Fas1UnitType.Caps, sessionId, this.capsBody());
      return;
    }
    if (this.options.role === 'A' && this.#state === 'CapsSent') {
      this.clearHandshakeRetry();
      if (canResume && this.prepareResume()) return;
      this.#state = 'CalibratingAToB';
      this.armDeadline();
      this.driveProbe('AtoB');
    }
  }

  private capsBody(): Uint8Array {
    const resumeDigest = this.resumeDigest();
    const body = new Uint8Array(resumeDigest ? 65 : 33);
    const aNonce = this.options.role === 'A' ? this.#localNonce! : this.#peerNonce!;
    const bNonce = this.options.role === 'B' ? this.#localNonce! : this.#peerNonce!;
    body.set(aNonce, 0); body.set(bNonce, 16);
    body[32] = resumeDigest ? 1 : 0;
    if (resumeDigest) body.set(resumeDigest, 33);
    return body;
  }
  private fastestCandidate(): AcousticCandidate {
    return [...this.options.candidates].sort((left, right) => right.payloadBytes - left.payloadBytes || left.guardMs - right.guardMs || left.playbackGain - right.playbackGain || left.id.localeCompare(right.id))[0]!;
  }
  private prepareFastBootstrap(): void {
    const candidate = this.fastestCandidate();
    this.#selected = { AtoB: candidate, BtoA: candidate };
    this.#settings = { aToB: this.toSettings(candidate), bToA: this.toSettings(candidate) };
    this.applyOutboundCandidate();
    this.#work = this.#work.then(async () => { this.#settingsDigest = await digestSettings(this.#settings!); }).catch(() => this.fail('acoustic_fast_bootstrap_failed'));
  }
  private activateFastBootstrapAfterPlayback(completion: void | Promise<void> | undefined, expectedState: 'HelloSent' | 'HelloAckSent'): void {
    const generation = this.#generation;
    this.#work = this.#work.then(async () => {
      await completion;
      if (generation !== this.#generation || this.#state !== expectedState || !this.#settings || !this.#settingsDigest) return;
      this.#state = 'Ready'; this.#lastHeartbeatAtMs = this.options.clock.now(); this.#turnOwner = 'A';
      this.#provenSettings = copySettings(this.#settings); this.#provenDigest = this.#settingsDigest.slice(); this.#resuming = false;
      this.armHeartbeatTimers();
      try { this.options.onReady?.(); } catch { /* Readiness projection cannot revoke a proven local session. */ }
    }).catch(() => this.fail('acoustic_fast_bootstrap_failed'));
  }
  private restartWithCalibration(): void {
    const epoch = this.#epoch;
    this.#fastBootstrapActive = false;
    this.reset(epoch);
    this.#fastBootstrapActive = false;
    this.start();
  }
  private resumeDigest(): Uint8Array | undefined {
    if (!this.#provenSettings || !this.#provenDigest || !this.candidateFor(this.#provenSettings.aToB) || !this.candidateFor(this.#provenSettings.bToA)) return undefined;
    return this.#provenDigest;
  }
  private candidateFor(settings: DirectionalSettings): AcousticCandidate | undefined {
    return this.options.candidates.find((candidate) => sameDirectionalSettings(candidate, settings));
  }
  private prepareResume(): boolean {
    if (!this.#provenSettings || !this.#provenDigest) return false;
    const aToB = this.candidateFor(this.#provenSettings.aToB);
    const bToA = this.candidateFor(this.#provenSettings.bToA);
    if (!aToB || !bToA) return false;
    this.#selected = { AtoB: aToB, BtoA: bToA };
    this.#settings = copySettings(this.#provenSettings);
    this.#settingsDigest = this.#provenDigest.slice();
    this.#resuming = true;
    this.#state = 'Committing';
    this.#counters.warmResumes += 1;
    this.applyOutboundCandidate();
    return true;
  }
  private queueResumeCommit(): void {
    if (this.options.role !== 'B' || !this.#resuming || this.#state !== 'Committing' || !this.#sessionId || !this.#settingsDigest) return;
    this.#work = this.#work.then(async () => {
      if (!this.#resuming || this.#state !== 'Committing' || !this.#sessionId || !this.#settingsDigest) return;
      await Promise.resolve(this.send(Fas1UnitType.Commit, this.#sessionId, this.#settingsDigest));
      this.armCommitRetry();
    }).catch(() => this.invalidateAndRestartResume());
  }
  private invalidateProvenSettings(): void {
    this.#provenSettings = undefined;
    this.#provenDigest = undefined;
    this.#peerResumeDigest = undefined;
    this.#resuming = false;
  }
  private invalidateAndRestartResume(): void {
    this.invalidateProvenSettings();
    if (this.options.role !== 'B' || !this.#sessionId) {
      this.restartSession();
      return;
    }
    const epoch = this.#epoch;
    const sessionId = this.#sessionId;
    const restart = (): void => {
      if (epoch === this.#epoch && sessionId === this.#sessionId) this.reset(epoch);
    };
    const completion = this.send(Fas1UnitType.Reset, sessionId, new Uint8Array());
    if (completion instanceof Promise) void completion.then(restart, restart);
    else restart();
  }
  private armDeadline(): void {
    if (this.#timer !== undefined) return;
    const epoch = this.#epoch;
    this.#timer = this.options.timers.setTimeout(() => {
      this.#timer = undefined;
      if (epoch === this.#epoch && (this.#state === 'CalibratingAToB' || this.#state === 'CalibratingBToA')) {
        this.#counters.retries += 1;
        this.armDeadline();
      }
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
    if (!value || typeof value !== 'object' || typeof value.received !== 'boolean' || typeof value.bytePerfect !== 'boolean' || typeof value.corrupt !== 'boolean' || typeof value.missing !== 'boolean' || typeof value.duplicate !== 'boolean' || typeof value.discontinuity !== 'boolean' || (value.clipping !== undefined && typeof value.clipping !== 'boolean') || (value.latencyMs !== undefined && !validInteger(value.latencyMs, 0, 65_534)) || (value.signalDb !== undefined && (!Number.isFinite(value.signalDb) || value.signalDb < -200 || value.signalDb > 0)) || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) invalid('probe observation is invalid');
    return { ...value };
  }
  private encodeReport(probe: AcousticProbe, observation: AcousticProbeObservation): Uint8Array {
    let flags = (observation.received ? OBS_RECEIVED : 0) | (observation.bytePerfect ? OBS_BYTE_PERFECT : 0) | (observation.corrupt ? OBS_CORRUPT : 0) | (observation.missing ? OBS_MISSING : 0) | (observation.duplicate ? OBS_DUPLICATE : 0) | (observation.discontinuity ? OBS_DISCONTINUITY : 0) | (observation.clipping ? OBS_CLIPPING : 0);
    const body = new Uint8Array(10); const view = new DataView(body.buffer);
    body[0] = this.directionByte(probe.direction); body[1] = probe.candidateIndex; body[2] = probe.probeIndex; body[3] = flags;
    view.setUint16(4, observation.latencyMs ?? 0xffff, true); view.setInt16(6, observation.signalDb === undefined ? -2_000 : Math.round(observation.signalDb * 10), true); view.setUint16(8, Math.round(observation.confidence * 1_000), true);
    return body;
  }
  private decodeReport(body: Uint8Array): { probe: AcousticProbe; observation: AcousticProbeObservation } {
    if (body.byteLength !== 10) invalid('report body is invalid');
    const direction = this.parseDirection(body[0]!); const candidateIndex = body[1]!; const probeIndex = body[2]!; const flags = body[3]!;
    if ((flags & ~127) !== 0 || candidateIndex >= this.options.candidates.length || probeIndex >= this.options.calibration.probesPerDirection) invalid('report geometry is invalid');
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const candidate = this.options.candidates[candidateIndex]!;
    const latency = view.getUint16(4, true); const signal = view.getInt16(6, true);
    return { probe: { direction, candidateIndex, probeIndex, candidate }, observation: this.normalizeObservation({ received: (flags & OBS_RECEIVED) !== 0, bytePerfect: (flags & OBS_BYTE_PERFECT) !== 0, corrupt: (flags & OBS_CORRUPT) !== 0, missing: (flags & OBS_MISSING) !== 0, duplicate: (flags & OBS_DUPLICATE) !== 0, discontinuity: (flags & OBS_DISCONTINUITY) !== 0, clipping: (flags & OBS_CLIPPING) !== 0 ? true : undefined, latencyMs: latency === 0xffff ? undefined : latency, signalDb: signal === -2_000 ? undefined : signal / 10, confidence: view.getUint16(8, true) / 1_000 }) };
  }
  private onProbe(sessionId: bigint, body: Uint8Array): void {
    if (sessionId !== this.#sessionId || body.byteLength !== 3) return;
    const direction = this.parseDirection(body[0]!);
    const receivedOrdinal = body[1]! * this.options.calibration.probesPerDirection + body[2]!;
    const ordinal = this.#receivedProbes[direction];
    if (receivedOrdinal === ordinal - 1) {
      const cached = this.#lastProbeReport[direction];
      if (cached?.ordinal === receivedOrdinal) {
        this.#counters.duplicates += 1;
        this.send(Fas1UnitType.Report, sessionId, cached.body);
      }
      return;
    }
    if (this.#state !== this.stateFor(direction) || this.options.role === this.expectedSender(direction) || receivedOrdinal !== ordinal || body[1] !== Math.floor(ordinal / this.options.calibration.probesPerDirection) || body[2] !== ordinal % this.options.calibration.probesPerDirection) return;
    const probe = this.probeFor(direction, ordinal); const observation = this.normalizeObservation(this.options.measureProbe(probe));
    const report = this.encodeReport(probe, observation);
    this.#receivedProbes[direction] += 1; this.#ledger.push({ ...probe, observation }); this.#lastProbeReport[direction] = { ordinal, body: report }; this.send(Fas1UnitType.Report, sessionId, report); this.completeDirection(direction);
  }
  private onReport(sessionId: bigint, body: Uint8Array): void {
    if (sessionId !== this.#sessionId) return;
    const { probe, observation } = this.decodeReport(body); const ordinal = this.#receivedReports[probe.direction];
    if (this.#state !== this.stateFor(probe.direction) || this.options.role !== this.expectedSender(probe.direction) || probe.candidateIndex !== Math.floor(ordinal / this.options.calibration.probesPerDirection) || probe.probeIndex !== ordinal % this.options.calibration.probesPerDirection) return;
    this.clearProbeRetry();
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
      const safe = observations.length === this.options.calibration.probesPerDirection && observations.every((entry) => entry.received && entry.bytePerfect && !entry.corrupt && !entry.missing && entry.clipping !== true && entry.confidence >= 0.5);
      const measuredLatency = observations.map((entry) => entry.latencyMs).filter((value): value is number => value !== undefined);
      const latency = measuredLatency.length === 0 ? Number.POSITIVE_INFINITY : measuredLatency.reduce((sum, value) => sum + value, 0) / measuredLatency.length;
      return { candidate, safe, latency };
    }).filter((entry) => entry.safe);
    ranked.sort((left, right) => left.latency - right.latency || left.candidate.playbackGain - right.candidate.playbackGain || right.candidate.payloadBytes - left.candidate.payloadBytes || left.candidate.id.localeCompare(right.candidate.id));
    return ranked[0]?.candidate;
  }
  private driveProbe(direction: 'AtoB' | 'BtoA'): void {
    if (this.options.role !== this.expectedSender(direction) || this.#state !== this.stateFor(direction) || !this.#sessionId) return;
    const ordinal = this.#sentProbes[direction]; const total = this.options.candidates.length * this.options.calibration.probesPerDirection;
    if (ordinal >= total) return;
    const probe = this.probeFor(direction, ordinal); this.options.modem.applyCandidate?.(probe.candidate); this.#sentProbes[direction] += 1;
    const completion = this.send(Fas1UnitType.Probe, this.#sessionId, new Uint8Array([this.directionByte(direction), probe.candidateIndex, probe.probeIndex]));
    void Promise.resolve(completion).then(
      () => this.armProbeRetry(direction, ordinal),
      () => this.fail('acoustic_probe_playback_failed'),
    );
  }
  private queueCommit(): void {
    this.#work = this.#work.then(async () => {
      if (this.#state !== 'Committing' || !this.#sessionId || !this.#selected.AtoB || !this.#selected.BtoA) return;
      this.#settings = { aToB: this.toSettings(this.#selected.AtoB), bToA: this.toSettings(this.#selected.BtoA) };
      this.applyOutboundCandidate();
      this.#settingsDigest = await digestSettings(this.#settings);
      await Promise.resolve(this.send(Fas1UnitType.Commit, this.#sessionId, this.#settingsDigest));
      this.armCommitRetry();
    }).catch(() => this.fail('acoustic_commit_failed'));
  }
  private onCommit(sessionId: bigint, body: Uint8Array): void {
    if (this.options.role !== 'A' || sessionId !== this.#sessionId || body.byteLength !== 32) return;
    if ((this.#state === 'AwaitingHeartbeat' || this.#state === 'Ready') && equal(body, this.#settingsDigest)) {
      this.#counters.duplicates += 1;
      this.send(Fas1UnitType.CommitAck, sessionId, body);
      if (this.#state === 'AwaitingHeartbeat') this.send(Fas1UnitType.Heartbeat, sessionId, new Uint8Array());
      return;
    }
    if (this.#state !== 'Committing' || !this.#selected.AtoB || !this.#selected.BtoA) return;
    const received = body.slice();
    this.#work = this.#work.then(async () => {
      if (this.#state !== 'Committing' || !this.#sessionId) return;
      this.#settings = { aToB: this.toSettings(this.#selected.AtoB!), bToA: this.toSettings(this.#selected.BtoA!) };
      const digest = await digestSettings(this.#settings);
      if (!equal(received, digest)) { this.fail('acoustic_commit_digest_mismatch'); return; }
      this.#settingsDigest = digest; this.applyOutboundCandidate(); this.#state = 'AwaitingHeartbeat'; this.#turnOwner = 'A';
      this.send(Fas1UnitType.CommitAck, this.#sessionId, digest);
      // The sole direct post-commit heartbeat is a deterministic bootstrap
      // exchange.  B is already AwaitingHeartbeat after the synchronous
      // COMMIT_ACK receive path and may make exactly one bound response.
      this.send(Fas1UnitType.Heartbeat, this.#sessionId, new Uint8Array());
    }).catch(() => this.fail('acoustic_commit_failed'));
  }
  private onCommitAck(sessionId: bigint, body: Uint8Array): void {
    if (this.options.role !== 'B' || this.#state !== 'Committing' || sessionId !== this.#sessionId || !equal(body, this.#settingsDigest)) return;
    // A owns the post-commit bootstrap turn.  B becomes ready only after it
    // receives this bound heartbeat and returns the one explicit bootstrap
    // reply below. Keep retrying COMMIT while waiting: A replays COMMIT_ACK
    // plus the bootstrap heartbeat, so losing that one heartbeat cannot leave
    // both peers permanently AwaitingHeartbeat.
    this.#state = 'AwaitingHeartbeat'; this.#turnOwner = 'A';
    this.armCommitRetry();
  }
  private onHeartbeat(sessionId: bigint): void {
    if (sessionId !== this.#sessionId || (this.#state !== 'AwaitingHeartbeat' && this.#state !== 'Ready' && this.#state !== 'Degraded' && this.#state !== 'Recovering')) return;
    const recovering = this.#state === 'Degraded' || this.#state === 'Recovering';
    const reply = this.#state === 'AwaitingHeartbeat' || (recovering && this.options.role === 'B');
    if (this.options.role === 'B') this.clearCommitRetry();
    this.clearDeliveryTimer(); this.#state = 'Ready'; this.#lastHeartbeatAtMs = this.options.clock.now(); this.armHeartbeatTimers();
    this.#recoveryAttempts = 0;
    if (this.#settings && this.#settingsDigest) {
      this.#provenSettings = copySettings(this.#settings);
      this.#provenDigest = this.#settingsDigest.slice();
      this.#resuming = false;
    }
    if (reply && this.options.role === 'B') {
      // A initiates both bootstrap and bounded recovery. B's single response
      // prevents symmetric recovery waits. Wait for the negotiated acoustic
      // guard during recovery so the response cannot overlap A's playback
      // tail. Bootstrap keeps its existing immediate response contract.
      if (recovering) {
        this.schedule(() => {
          if (this.#state === 'Ready' && this.#sessionId === sessionId) this.send(Fas1UnitType.Heartbeat, sessionId, new Uint8Array());
        }, this.guardMs());
      } else {
        this.send(Fas1UnitType.Heartbeat, sessionId, new Uint8Array());
      }
    }
    if (reply || recovering) this.#turnOwner = 'A';
  }
  private toSettings(candidate: AcousticCandidate): DirectionalSettings { return { profileId: candidate.profileId, payloadBytes: candidate.payloadBytes, repetition: candidate.repetition, guardMs: candidate.guardMs, playbackGain: candidate.playbackGain, ackTimeoutMs: candidate.ackTimeoutMs }; }
  private applyOutboundCandidate(): void {
    const candidate = this.options.role === 'A' ? this.#selected.AtoB : this.#selected.BtoA;
    if (candidate) this.options.modem.applyCandidate?.(candidate);
  }
  private fail(reason: string): void { if (this.#timer !== undefined) this.options.timers.clearTimeout(this.#timer); this.#timer = undefined; this.clearHandshakeRetry(); this.clearProbeRetry(); this.clearCommitRetry(); this.clearHeartbeatTimers(); this.#state = 'Error'; this.#reason = reason; }
  private mutualRange(peer: AcousticCapabilityRange): boolean { return peer.minPayloadBytes <= this.options.ranges.maxPayloadBytes && peer.maxPayloadBytes >= this.options.ranges.minPayloadBytes; }
  private send(type: Fas1UnitType, sessionId: bigint, body: Uint8Array): void | Promise<void> {
    const raw = encodeFas1({ type, flags: senderFlag(this.options.role), sessionId, sequence: this.#sequence++, packetId: 0, fragmentIndex: 0, fragmentCount: 0, packetLength: 0, body });
    return this.options.modem.send(raw, CEREMONY_TYPES.has(type) ? 'ceremony' : 'data');
  }
}
