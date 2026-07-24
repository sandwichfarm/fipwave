import manifest from '../../../fixtures/corpus/manifest.json' with { type: 'json' };

export const QUIET_PROFILE = 'audible-7k-channel-0';
export const QUIET_CLAMP_FRAME = true;
export const QUIET_FRAME_BYTES = 253;
export const QUIET_ENVELOPE_BYTES = 32;
export const QUIET_DATA_BYTES = QUIET_FRAME_BYTES - QUIET_ENVELOPE_BYTES;
export const QUIET_GUARD_MS = 750;

export type Role = 'A' | 'B';
export type LiteralDirection = 'A → B' | 'B → A';
export type EvidenceClass = 'Fixture' | 'Loopback' | 'Open air';

export interface RunnerConfig {
  machineId: string;
  role: Role;
  reportTarget: string;
  tunEvidence: string;
  evidenceMode: EvidenceClass;
  evidenceClass: EvidenceClass;
  acoustic?: Readonly<{
    profiles: readonly ['quiet-audible-7k-v1'];
    ranges: Readonly<{ minPayloadBytes: number; maxPayloadBytes: number }>;
    candidates: readonly Readonly<{ id: string; profileId: 'quiet-audible-7k-v1'; payloadBytes: number; repetition: number; guardMs: number; playbackGain: number; ackTimeoutMs: number }>[];
    calibration: Readonly<{ maxCandidates: number; probesPerDirection: number; deadlineMs: number; maximumPlaybackGain: number }>;
  }>;
}

export interface AppliedQuietSettings {
  microphoneLabel: string;
  contextState: string | undefined;
  contextSampleRate: number | undefined;
  inputDeviceSampleRate: number | undefined;
  captureSampleRate: number | undefined;
  inputDeviceChannels: number | undefined;
  captureChannels: number | undefined;
  echoCancellation: boolean | undefined;
  noiseSuppression: boolean | undefined;
  autoGainControl: boolean | undefined;
}
export interface QuietMetrics { captureHighWaterBytes: number; captureHighWaterMs: number; playbackHighWaterBytes: number; playbackHighWaterMs: number; discontinuities: number; }

export interface CorpusCase { id: string; direction: LiteralDirection; size: number; pattern: string; sha256: string; }
export interface QuietFragment { epoch: number; sender: Role; direction: LiteralDirection; caseId: string; caseIndex: number; fragmentIndex: number; fragmentCount: number; declaredLength: number; digestPrefix: Uint8Array; payload: Uint8Array; }
export interface ReceiveCaseEvidence { epoch: number; sender: Role; direction: LiteralDirection; caseId: string; digest: string | null; acquisitionMs: number; airtimeMs: number; deliveryCount: number; coldAcquired: boolean; complete: boolean; corrupt: boolean; missing: number; duplicates: number; }

type QuietTransmitter = { transmit(buffer: ArrayBuffer): void; destroy(): void; frameLength: number };
type QuietReceiver = { destroy(): void };
type QuietApi = {
  init(options: { profilesPrefix: string; memoryInitializerPrefix: string; libfecPrefix: string; onReady: () => void; onError: (reason: string) => void }): void;
  transmitter(options: { profile: string; clampFrame: boolean; onFinish: () => void }): QuietTransmitter;
  receiver(options: { profile: string; onReceive: (frame: ArrayBuffer) => void; onCreate: () => void; onCreateFail: (reason: string) => void; onReceiveFail: () => void }): QuietReceiver;
  disconnect?(): void;
};
type QuietRuntimeWindow = Window & {
  AudioContext: typeof AudioContext;
  Quiet?: QuietApi;
};

declare global { interface Window { Quiet?: QuietApi; } }

const encoder = new TextEncoder();
const seed = 'fipwave-phase-01-corpus-v1';
const FWAV_HEADER_BYTES = 32;
const FWAV_RESET_TYPE = 8;

function bytesFor(entry: CorpusCase, index: number): Uint8Array {
  const bytes = new Uint8Array(entry.size);
  if (entry.pattern === 'all-ff') return bytes.fill(0xff);
  if (entry.pattern === 'incrementing') return bytes.map((_, offset) => (offset + index) & 0xff);
  if (entry.pattern === 'alternating') return bytes.map((_, offset) => ((offset + index) % 2 ? 0x55 : 0xaa));
  if (entry.pattern === 'pseudorandom') {
    // The seed is deliberately committed; hashing it makes browser and corpus generator reproduce the same LCG seed.
    throw new Error('pseudorandom corpus payload must be supplied by the verified manifest helper');
  }
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fetchRunnerConfig(): Promise<Readonly<RunnerConfig>> {
  const response = await fetch('/qualification-config', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('runner qualification configuration is unavailable');
  const value = await response.json() as Partial<RunnerConfig>;
  const evidenceClass = value.evidenceClass;
  const acoustic = value.acoustic;
  const integerBetween = (input: unknown, minimum: number, maximum: number): input is number => Number.isInteger(input) && typeof input === 'number' && input >= minimum && input <= maximum;
  const exactRecord = (input: unknown, keys: readonly string[]): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === keys.length && keys.every((key) => key in input);
  const validCandidate = (candidate: unknown): candidate is NonNullable<RunnerConfig['acoustic']>['candidates'][number] => {
    if (!exactRecord(candidate, ['id', 'profileId', 'payloadBytes', 'repetition', 'guardMs', 'playbackGain', 'ackTimeoutMs'])) return false;
    const record = candidate;
    return typeof record.id === 'string' && /^[a-z0-9][a-z0-9-]{2,63}$/.test(record.id)
      && record.profileId === 'quiet-audible-7k-v1'
      && integerBetween(record.payloadBytes, 96, 217)
      && record.repetition === 1
      && integerBetween(record.guardMs, 1, 5_000)
      && (record.playbackGain === 1 || record.playbackGain === 2)
      && integerBetween(record.ackTimeoutMs, 4_000, 15_000);
  };
  const validAcoustic = exactRecord(acoustic, ['profiles', 'ranges', 'candidates', 'calibration']) && (() => {
    const record = acoustic;
    const ranges = record.ranges; const calibration = record.calibration; const candidates = record.candidates;
    if (!exactRecord(ranges, ['minPayloadBytes', 'maxPayloadBytes']) || !exactRecord(calibration, ['maxCandidates', 'probesPerDirection', 'deadlineMs', 'maximumPlaybackGain']) || !Array.isArray(candidates)) return false;
    const minPayloadBytes = ranges.minPayloadBytes; const maxPayloadBytes = ranges.maxPayloadBytes;
    return Array.isArray(record.profiles) && record.profiles.length === 1 && record.profiles[0] === 'quiet-audible-7k-v1'
      && integerBetween(minPayloadBytes, 96, 217) && integerBetween(maxPayloadBytes, minPayloadBytes, 217)
      && Array.isArray(candidates) && candidates.length >= 1 && candidates.length <= 3 && candidates.every(validCandidate)
      && new Set(candidates.map((candidate) => candidate.id)).size === candidates.length
      && integerBetween(calibration.maxCandidates, candidates.length, candidates.length)
      && integerBetween(calibration.probesPerDirection, 1, 4)
      && integerBetween(calibration.deadlineMs, 1, 120_000)
      && calibration.maximumPlaybackGain === 2;
  })();
  // Local audio preflight/bridge UI predates the acoustic calibration contract
  // and remains valid without an acoustic peer.  If a runner supplies the
  // acoustic projection it must still pass the exact fail-closed schema above.
  if (!value.machineId || (value.role !== 'A' && value.role !== 'B') || !value.reportTarget || !value.tunEvidence || !evidenceClass || !['Fixture', 'Loopback', 'Open air'].includes(evidenceClass) || value.evidenceMode !== evidenceClass || (acoustic !== undefined && !validAcoustic)) throw new Error('runner qualification configuration is invalid');
  const publicAcoustic = validAcoustic ? Object.freeze({ profiles: ['quiet-audible-7k-v1'] as ['quiet-audible-7k-v1'], ranges: Object.freeze({ ...(acoustic as NonNullable<RunnerConfig['acoustic']>).ranges }), candidates: Object.freeze((acoustic as NonNullable<RunnerConfig['acoustic']>).candidates.map((candidate) => Object.freeze({ ...candidate }))), calibration: Object.freeze({ ...(acoustic as NonNullable<RunnerConfig['acoustic']>).calibration }) }) : undefined;
  return Object.freeze({ machineId: value.machineId, role: value.role, reportTarget: value.reportTarget, tunEvidence: value.tunEvidence, evidenceMode: evidenceClass, evidenceClass, ...(publicAcoustic ? { acoustic: publicAcoustic } : {}) });
}

export function directionForRole(role: Role): LiteralDirection { return role === 'A' ? 'A → B' : 'B → A'; }
export function receiveDirectionForRole(role: Role): LiteralDirection { return role === 'A' ? 'B → A' : 'A → B'; }
export function peerRole(role: Role): Role { return role === 'A' ? 'B' : 'A'; }

export function encodeControlFrame(input: { type: number; epoch: number; sequence: bigint; payload?: Uint8Array }): ArrayBuffer {
  const payload = input.payload ?? new Uint8Array();
  if (!Number.isInteger(input.type) || input.type < 1 || input.type > 14) throw new Error('FWAV control type is invalid');
  if (!Number.isInteger(input.epoch) || input.epoch < 0 || input.epoch > 0xffff_ffff) throw new Error('FWAV control epoch is invalid');
  if (input.sequence < 0n || input.sequence > 0xffff_ffff_ffff_ffffn) throw new Error('FWAV control sequence is invalid');
  if (payload.byteLength > 256 * 1024 - FWAV_HEADER_BYTES) throw new Error('FWAV control payload is too large');
  const output = new ArrayBuffer(FWAV_HEADER_BYTES + payload.byteLength);
  const bytes = new Uint8Array(output);
  const view = new DataView(output);
  bytes.set([0x46, 0x57, 0x41, 0x56]);
  view.setUint8(4, 1);
  view.setUint8(5, input.type);
  view.setUint32(8, payload.byteLength, true);
  view.setUint32(12, input.epoch, true);
  view.setBigUint64(16, input.sequence, true);
  bytes.set(payload, FWAV_HEADER_BYTES);
  return output;
}

export function readFwavMessageType(input: ArrayBuffer): number {
  if (input.byteLength < FWAV_HEADER_BYTES) throw new Error('FWAV frame is shorter than its header');
  const bytes = new Uint8Array(input);
  const view = new DataView(input);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== 'FWAV' || view.getUint8(4) !== 1) throw new Error('FWAV frame identity is invalid');
  if (view.getUint32(8, true) !== input.byteLength - FWAV_HEADER_BYTES) throw new Error('FWAV frame length is invalid');
  return view.getUint8(5);
}

export function decodeResetFrame(input: ArrayBuffer, previousEpoch: number): number {
  if (readFwavMessageType(input) !== FWAV_RESET_TYPE) throw new Error('FWAV frame is not RESET');
  const view = new DataView(input);
  if (input.byteLength !== FWAV_HEADER_BYTES || view.getUint32(8, true) !== 0 || view.getBigUint64(16, true) !== 0n || view.getUint32(24, true) !== 0 || view.getUint16(28, true) !== 0 || view.getUint16(30, true) !== 0) throw new Error('FWAV RESET frame is malformed');
  const epoch = view.getUint32(12, true);
  if (epoch !== previousEpoch + 1) throw new Error(`FWAV RESET did not establish the exact next epoch after ${previousEpoch}`);
  return epoch;
}

export function fragmentCase(input: { epoch: number; sender: Role; caseIndex: number; entry: CorpusCase; payload: Uint8Array }): QuietFragment[] {
  const { epoch, sender, caseIndex, entry, payload } = input;
  const fragmentCount = Math.max(1, Math.ceil(payload.byteLength / QUIET_DATA_BYTES));
  const digestPrefix = new Uint8Array(entry.sha256.match(/../g)?.slice(0, 8).map((part) => Number.parseInt(part, 16)) ?? []);
  return Array.from({ length: fragmentCount }, (_, fragmentIndex) => ({ epoch, sender, direction: entry.direction, caseId: entry.id, caseIndex, fragmentIndex, fragmentCount, declaredLength: payload.byteLength, digestPrefix, payload: payload.slice(fragmentIndex * QUIET_DATA_BYTES, (fragmentIndex + 1) * QUIET_DATA_BYTES) }));
}

/** Fixed 32-byte application envelope. It is deliberately independent of any Quiet framing. */
export function encodeFragment(fragment: QuietFragment): ArrayBuffer {
  if (fragment.payload.byteLength > QUIET_DATA_BYTES) throw new Error('Quiet fragment exceeds fixed envelope capacity');
  const output = new Uint8Array(QUIET_ENVELOPE_BYTES + fragment.payload.byteLength);
  const view = new DataView(output.buffer);
  output.set([0x46, 0x51, 0x54, 0x31], 0); view.setUint32(4, fragment.epoch, true); output[8] = fragment.sender === 'A' ? 0 : 1; output[9] = fragment.direction === 'A → B' ? 0 : 1;
  view.setUint16(10, fragment.caseIndex, true); output[12] = fragment.fragmentIndex; output[13] = fragment.fragmentCount; view.setUint16(14, fragment.declaredLength, true);
  output.set(fragment.digestPrefix, 16); output.set(fragment.payload, QUIET_ENVELOPE_BYTES);
  return output.buffer;
}

export function decodeFragment(input: ArrayBuffer): QuietFragment {
  const bytes = new Uint8Array(input); if (bytes.byteLength < QUIET_ENVELOPE_BYTES) throw new Error('Quiet fragment is shorter than the application envelope');
  const view = new DataView(input); if (String.fromCharCode(...bytes.slice(0, 4)) !== 'FQT1') throw new Error('Quiet fragment magic is invalid');
  if (bytes.byteLength > QUIET_FRAME_BYTES) throw new Error('Quiet fragment is malformed');
  const fragmentCount = bytes[13]!; const fragmentIndex = bytes[12]!; if (!fragmentCount || fragmentIndex >= fragmentCount) throw new Error('Quiet fragment index is invalid');
  const direction = bytes[9] === 0 ? 'A → B' : bytes[9] === 1 ? 'B → A' : (() => { throw new Error('Quiet direction is invalid'); })();
  const caseIndex = view.getUint16(10, true); const caseId = (manifest.cases as CorpusCase[]).filter((entry) => entry.direction === direction)[caseIndex]?.id;
  if (!caseId) throw new Error('Quiet case index is invalid');
  return { epoch: view.getUint32(4, true), sender: bytes[8] === 0 ? 'A' : bytes[8] === 1 ? 'B' : (() => { throw new Error('Quiet sender is invalid'); })(), direction, caseIndex, fragmentIndex, fragmentCount, declaredLength: view.getUint16(14, true), digestPrefix: bytes.slice(16, 24), caseId, payload: bytes.slice(QUIET_ENVELOPE_BYTES) };
}

interface ReceiverSession { epoch: number; localRole: Role; startedAtMs: number; }
interface PartialCase { fragment: QuietFragment; parts: Map<number, Uint8Array>; duplicates: number; startedAtMs: number; }
interface ReceiverMetrics { captureHighWaterBytes: number; captureHighWaterMs: number; discontinuities: number; }

export interface QuietClientOptions {
  /** Multiplier applied only to the browser playback destination. */
  playbackGain?: number;
}

export interface QuietAcousticCandidate {
  readonly playbackGain: number;
  readonly repetition: number;
  readonly guardMs: number;
}

export class QuietReceiverEvidence {
  #parts = new Map<string, PartialCase>();
  #session: ReceiverSession;
  #metrics: ReceiverMetrics = { captureHighWaterBytes: 0, captureHighWaterMs: 0, discontinuities: 0 };
  #completedCase = false;

  constructor(session: ReceiverSession = { epoch: 0, localRole: 'A', startedAtMs: 0 }) { this.#session = session; }
  metrics(): Readonly<ReceiverMetrics> { return { ...this.#metrics }; }

  #isExpected(fragment: QuietFragment): boolean {
    return fragment.epoch === this.#session.epoch
      && fragment.sender === peerRole(this.#session.localRole)
      && fragment.direction === receiveDirectionForRole(this.#session.localRole);
  }

  #updateHighWater(current: PartialCase, nowMs: number): void {
    const bufferedBytes = [...this.#parts.values()].reduce((total, partial) => total + [...partial.parts.values()].reduce((subtotal, bytes) => subtotal + bytes.byteLength, 0), 0);
    this.#metrics.captureHighWaterBytes = Math.max(this.#metrics.captureHighWaterBytes, bufferedBytes);
    this.#metrics.captureHighWaterMs = Math.max(this.#metrics.captureHighWaterMs, Math.max(0, nowMs - current.startedAtMs));
  }

  accept(raw: ArrayBuffer, nowMs = performance.now()): Promise<ReceiveCaseEvidence | undefined> {
    let fragment: QuietFragment; try { fragment = decodeFragment(raw); } catch { return Promise.resolve(undefined); }
    if (!this.#isExpected(fragment)) return Promise.resolve(undefined);
    const expected = (manifest.cases as CorpusCase[]).find((entry) => entry.id === fragment.caseId);
    const expectedPrefix = expected?.sha256.slice(0, 16) ?? '';
    const actualPrefix = [...fragment.digestPrefix].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const expectedFragments = expected ? Math.max(1, Math.ceil(expected.size / QUIET_DATA_BYTES)) : 0;
    if (!expected || fragment.declaredLength !== expected.size || fragment.fragmentCount !== expectedFragments || actualPrefix !== expectedPrefix) {
      this.#metrics.discontinuities += 1;
      return Promise.resolve(undefined);
    }
    const key = `${fragment.epoch}\u0000${fragment.sender}\u0000${fragment.caseId}`;
    const current = this.#parts.get(key) ?? { fragment, parts: new Map(), duplicates: 0, startedAtMs: nowMs };
    if (current.fragment.fragmentCount !== fragment.fragmentCount || current.fragment.declaredLength !== fragment.declaredLength) {
      this.#metrics.discontinuities += 1;
      return Promise.resolve(undefined);
    }
    if (current.parts.has(fragment.fragmentIndex)) current.duplicates += 1;
    else current.parts.set(fragment.fragmentIndex, fragment.payload);
    this.#parts.set(key, current);
    this.#updateHighWater(current, nowMs);
    if (current.parts.size !== fragment.fragmentCount) return Promise.resolve(undefined);
    return (async () => {
      const payload = new Uint8Array([...current.parts.entries()].sort(([a], [b]) => a - b).flatMap(([, bytes]) => [...bytes])).slice(0, fragment.declaredLength);
      const digest = await sha256(payload); const corrupt = digest !== expected.sha256 || payload.byteLength !== fragment.declaredLength;
      this.#parts.delete(key);
      const coldAcquired = !this.#completedCase;
      this.#completedCase = true;
      return { epoch: fragment.epoch, sender: fragment.sender, direction: fragment.direction, caseId: fragment.caseId, digest, acquisitionMs: Math.max(0, current.startedAtMs - this.#session.startedAtMs), airtimeMs: Math.max(0, nowMs - current.startedAtMs), deliveryCount: current.duplicates ? 2 : 1, coldAcquired, complete: true, corrupt, missing: 0, duplicates: current.duplicates };
    })();
  }

  flush(nowMs = performance.now()): ReceiveCaseEvidence[] {
    for (const current of this.#parts.values()) this.#updateHighWater(current, nowMs);
    const incomplete = [...this.#parts.values()].map((current) => ({
      epoch: current.fragment.epoch,
      sender: current.fragment.sender,
      direction: current.fragment.direction,
      caseId: current.fragment.caseId,
      digest: null,
      acquisitionMs: Math.max(0, current.startedAtMs - this.#session.startedAtMs),
      airtimeMs: Math.max(0, nowMs - current.startedAtMs),
      deliveryCount: 0,
      coldAcquired: false,
      complete: false,
      corrupt: false,
      missing: current.fragment.fragmentCount - current.parts.size,
      duplicates: current.duplicates,
    }));
    this.#parts.clear();
    return incomplete;
  }

  reset(session: ReceiverSession, nowMs = performance.now()): ReceiveCaseEvidence[] {
    const incomplete = this.flush(nowMs);
    this.#session = session;
    this.#metrics = { captureHighWaterBytes: 0, captureHighWaterMs: 0, discontinuities: 0 };
    this.#completedCase = false;
    return incomplete;
  }
}

export async function closeAudioContexts(contexts: Set<AudioContext>): Promise<void> {
  const pending = [...contexts].filter((context) => context.state !== 'closed').map((context) => context.close());
  await Promise.allSettled(pending);
  contexts.clear();
}

export class QuietClient {
  #transmitter: QuietTransmitter | undefined;
  #receiver: QuietReceiver | undefined;
  #track: MediaStreamTrack | undefined;
  #originalGetUserMedia: unknown;
  #epoch: number | undefined;
  #localRole: Role | undefined;
  #receiverEvidence = new QuietReceiverEvidence();
  #onReceive: (evidence: ReceiveCaseEvidence) => void;
  #applied: AppliedQuietSettings | undefined;
  #contextSampleRate: number | undefined;
  #originalAudioContext: typeof AudioContext | undefined;
  #contexts = new Set<AudioContext>();
  #runtimeFrame: HTMLIFrameElement | undefined;
  #runtimeWindow: QuietRuntimeWindow | undefined;
  #playbackGain: number;
  #acousticRepetition = 1;
  #acousticGuardMs = QUIET_GUARD_MS;
  #outputGains = new Set<GainNode>();
  #generation = 0;
  #cancelTransmission: (() => void) | undefined;
  #unitHandler: ((unit: Uint8Array) => void) | undefined;
  #metrics: QuietMetrics = { captureHighWaterBytes: 0, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 };

  constructor(onReceive: (evidence: ReceiveCaseEvidence) => void = () => undefined, options: QuietClientOptions = {}) {
    const playbackGain = options.playbackGain ?? 1;
    if (!Number.isFinite(playbackGain) || playbackGain <= 0 || playbackGain > 4) throw new Error('Quiet playback gain must be greater than 0 and no more than 4');
    this.#onReceive = onReceive;
    this.#playbackGain = playbackGain;
  }
  get applied(): AppliedQuietSettings | undefined { return this.#applied; }
  get metrics(): Readonly<QuietMetrics> {
    const capture = this.#receiverEvidence.metrics();
    return { ...this.#metrics, captureHighWaterBytes: capture.captureHighWaterBytes, captureHighWaterMs: capture.captureHighWaterMs, discontinuities: this.#metrics.discontinuities + capture.discontinuities };
  }

  /**
   * Applies only actual controls exposed by the fixed Quiet profile.  Carrier
   * frequency remains the profile identifier; no sample-rate or speed trick is
   * represented as a frequency change.
   */
  configureAcousticCandidate(candidate: QuietAcousticCandidate): void {
    if (!Number.isFinite(candidate.playbackGain) || candidate.playbackGain < 1 || candidate.playbackGain > 2 || !Number.isInteger(candidate.repetition) || candidate.repetition < 1 || candidate.repetition > 3 || !Number.isInteger(candidate.guardMs) || candidate.guardMs < 1 || candidate.guardMs > 5_000) throw new Error('Quiet acoustic candidate is invalid');
    this.#playbackGain = candidate.playbackGain;
    this.#acousticRepetition = candidate.repetition;
    this.#acousticGuardMs = candidate.guardMs;
    for (const gain of this.#outputGains) gain.gain.value = candidate.playbackGain;
  }

  /**
   * Raw codec-frame seam for FAS1. The receiver never interprets the unit and
   * callers receive a copy only while the currently armed generation owns it.
   */
  onUnit(handler: (unit: Uint8Array) => void): () => void {
    this.#unitHandler = handler;
    return () => { if (this.#unitHandler === handler) this.#unitHandler = undefined; };
  }

  async arm(epoch: number, localRole: Role): Promise<AppliedQuietSettings> {
    await this.reset();
    this.#epoch = epoch;
    this.#localRole = localRole;
    this.#receiverEvidence.reset({ epoch, localRole, startedAtMs: performance.now() });
    const generation = this.#generation;
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Quiet modem runtime';
    const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
    frame.srcdoc = '<!doctype html><html><head></head><body></body></html>';
    document.body.append(frame);
    await loaded;
    const runtime = frame.contentWindow as QuietRuntimeWindow | null;
    if (!runtime) throw new Error('Quiet runtime realm is unavailable');
    this.#runtimeFrame = frame;
    this.#runtimeWindow = runtime;
    const nav = runtime.navigator as Navigator & { getUserMedia?: (constraints: MediaStreamConstraints, success: (stream: MediaStream) => void, failure: (error: unknown) => void) => void };
    this.#originalGetUserMedia = nav.getUserMedia;
    nav.getUserMedia = (_ignored, success, failure) => { void navigator.mediaDevices.getUserMedia({ audio: { channelCount: { exact: 1 }, sampleRate: { ideal: 48_000 }, echoCancellation: { exact: false }, noiseSuppression: { exact: false }, autoGainControl: { exact: false } }, video: false }).then((stream) => { this.#track = stream.getAudioTracks()[0]; success(stream); }, failure); };
    this.#originalAudioContext = runtime.AudioContext;
    if (!this.#originalAudioContext) throw new Error('Quiet AudioContext is unavailable');
    const client = this;
    runtime.AudioContext = new Proxy(this.#originalAudioContext, { construct(Target, args) {
      const context = Reflect.construct(Target, args) as AudioContext;
      client.#contexts.add(context);
      client.#contextSampleRate = context.sampleRate;
      if (client.#playbackGain !== 1) {
        const destination = context.destination;
        const outputGain = context.createGain();
        outputGain.gain.value = client.#playbackGain;
        outputGain.connect(destination);
        client.#outputGains.add(outputGain);
        Object.defineProperty(context, 'destination', { configurable: true, value: outputGain });
      }
      return context;
    } });
    await loadClassicScript(runtime.document, '/codec-assets/quiet.js');
    const quiet = runtime.Quiet; if (!quiet) throw new Error('verified Quiet runtime did not load');
    const ready = new Promise<void>((resolve, reject) => quiet.init({ profilesPrefix: '/codec-assets/', memoryInitializerPrefix: '/codec-assets/', libfecPrefix: '/codec-assets/', onReady: resolve, onError: (reason) => reject(new Error(`Quiet initialization failed: ${reason}`)) }));
    // init must register prefixes and its callback before Emscripten starts.
    // Load the allowlisted libfec artifact in this disposable realm; Emscripten
    // also receives the same verified URL as its dynamic-library prefix.
    await loadClassicScript(runtime.document, '/codec-assets/libfec.js');
    await loadClassicScript(runtime.document, '/codec-assets/quiet-emscripten.js');
    await ready;
    await new Promise<void>((resolve, reject) => {
      this.#receiver = quiet.receiver({ profile: QUIET_PROFILE, onReceive: (raw) => {
        if (generation === this.#generation && this.#epoch === epoch) this.#unitHandler?.(new Uint8Array(raw).slice());
        void this.#receiverEvidence.accept(raw).then((evidence) => { if (evidence && generation === this.#generation && evidence.epoch === this.#epoch && evidence.sender === peerRole(localRole) && evidence.direction === receiveDirectionForRole(localRole)) this.#onReceive(evidence); });
      }, onCreate: resolve, onCreateFail: (reason) => reject(new Error(`Quiet microphone failed: ${reason}`)), onReceiveFail: () => { this.#metrics.discontinuities += 1; } });
    });
    const settings = this.#track?.getSettings() ?? {}; const flag = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
    const quietContext = [...this.#contexts][0];
    const applied: AppliedQuietSettings = { microphoneLabel: this.#track?.label || 'Unavailable', contextState: quietContext?.state, contextSampleRate: this.#contextSampleRate, inputDeviceSampleRate: settings.sampleRate, captureSampleRate: quietContext?.sampleRate, inputDeviceChannels: settings.channelCount, captureChannels: 1, echoCancellation: flag(settings.echoCancellation), noiseSuppression: flag(settings.noiseSuppression), autoGainControl: flag(settings.autoGainControl) };
    this.#applied = applied;
    if (applied.contextState !== 'running' || applied.contextSampleRate !== 48_000 || applied.captureSampleRate !== 48_000 || (applied.inputDeviceSampleRate !== 44_100 && applied.inputDeviceSampleRate !== 48_000) || (applied.inputDeviceChannels !== 1 && applied.inputDeviceChannels !== 2) || applied.captureChannels !== 1 || applied.echoCancellation !== false || applied.noiseSuppression !== false || applied.autoGainControl !== false) { await this.reset(); throw new Error('Quiet applied microphone settings are incompatible'); }
    return applied;
  }

  /** Resolves only after local `onFinish` and the fixed local guard. */
  async sendUnit(unit: Uint8Array, epoch = this.#epoch): Promise<void> {
    const runtime = this.#runtimeWindow;
    if (!(unit instanceof Uint8Array) || unit.byteLength < 1 || unit.byteLength > QUIET_FRAME_BYTES || epoch === undefined || epoch !== this.#epoch || !runtime?.Quiet || !this.#receiver) throw new Error('Quiet is not armed');
    const generation = this.#generation;
    const startedAt = performance.now();
    this.#metrics.playbackHighWaterBytes = Math.max(this.#metrics.playbackHighWaterBytes, unit.byteLength);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => { if (settled) return; settled = true; this.#cancelTransmission = undefined; callback(); };
      this.#cancelTransmission = () => finish(() => reject(new Error('Quiet transmission cancelled by reset')));
      this.#transmitter?.destroy();
      this.#transmitter = runtime.Quiet!.transmitter({ profile: QUIET_PROFILE, clampFrame: QUIET_CLAMP_FRAME, onFinish: () => {
        this.#metrics.playbackHighWaterMs = Math.max(this.#metrics.playbackHighWaterMs, performance.now() - startedAt);
        runtime.setTimeout(() => finish(() => generation === this.#generation && epoch === this.#epoch ? resolve() : reject(new Error('Quiet transmission cancelled by reset'))), this.#acousticGuardMs);
      } });
      for (let repetition = 0; repetition < this.#acousticRepetition; repetition += 1) this.#transmitter.transmit(unit.slice().buffer);
    });
  }

  async sendCorpus(role: Role, epoch: number, onProgress: (entry: CorpusCase, index: number, total: number) => void, limit?: number): Promise<void> {
    const runtime = this.#runtimeWindow;
    if (!this.#receiver || epoch !== this.#epoch || role !== this.#localRole || !runtime?.Quiet) throw new Error('Quiet is not armed');
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 25)) throw new Error('Quiet corpus limit is invalid');
    const generation = this.#generation;
    const matching = (manifest.cases as CorpusCase[]).filter((entry) => entry.direction === directionForRole(role));
    const entries = limit === undefined ? matching : matching.slice(0, limit);
    for (const [index, entry] of entries.entries()) {
      if (generation !== this.#generation || epoch !== this.#epoch) throw new Error('Quiet transmission cancelled by reset');
      const payload = await corpusPayload(entry, index % (entry.size === 256 ? 20 : 5)); const digest = await sha256(payload); if (digest !== entry.sha256) throw new Error(`committed corpus digest mismatch: ${entry.id}`);
      const fragments = fragmentCase({ epoch, sender: role, caseIndex: index, entry, payload });
      const startedAt = performance.now(); const bytes = fragments.reduce((total, fragment) => total + encodeFragment(fragment).byteLength, 0); this.#metrics.playbackHighWaterBytes = Math.max(this.#metrics.playbackHighWaterBytes, bytes);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => { if (settled) return; settled = true; this.#cancelTransmission = undefined; callback(); };
        this.#cancelTransmission = () => finish(() => reject(new Error('Quiet transmission cancelled by reset')));
        this.#transmitter?.destroy();
        this.#transmitter = runtime.Quiet!.transmitter({ profile: QUIET_PROFILE, clampFrame: QUIET_CLAMP_FRAME, onFinish: () => {
          this.#metrics.playbackHighWaterMs = Math.max(this.#metrics.playbackHighWaterMs, performance.now() - startedAt);
          runtime.setTimeout(() => finish(() => generation === this.#generation ? resolve() : reject(new Error('Quiet transmission cancelled by reset'))), QUIET_GUARD_MS);
        } });
        fragments.forEach((fragment) => this.#transmitter!.transmit(encodeFragment(fragment)));
      });
      onProgress(entry, index + 1, entries.length);
    }
  }

  flushIncomplete(nowMs = performance.now()): ReceiveCaseEvidence[] { return this.#receiverEvidence.flush(nowMs); }

  async reset(): Promise<void> {
    this.#generation += 1;
    this.#cancelTransmission?.();
    this.#cancelTransmission = undefined;
    this.#transmitter?.destroy(); this.#receiver?.destroy(); this.#transmitter = undefined; this.#receiver = undefined; this.#track?.stop(); this.#track = undefined; this.#applied = undefined; this.#contextSampleRate = undefined; this.#outputGains.clear(); this.#acousticRepetition = 1; this.#acousticGuardMs = QUIET_GUARD_MS; this.#metrics = { captureHighWaterBytes: 0, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 };
    const runtime = this.#runtimeWindow;
    runtime?.Quiet?.disconnect?.();
    const nav = runtime?.navigator as (Navigator & { getUserMedia?: unknown }) | undefined;
    if (nav) {
      if (this.#originalGetUserMedia !== undefined) nav.getUserMedia = this.#originalGetUserMedia as never;
      else delete nav.getUserMedia;
    }
    this.#originalGetUserMedia = undefined;
    if (runtime && this.#originalAudioContext) runtime.AudioContext = this.#originalAudioContext;
    this.#originalAudioContext = undefined;
    await closeAudioContexts(this.#contexts);
    this.#runtimeFrame?.remove();
    this.#runtimeFrame = undefined;
    this.#runtimeWindow = undefined;
    this.#epoch = undefined;
    this.#localRole = undefined;
    this.#receiverEvidence.reset({ epoch: 0, localRole: 'A', startedAtMs: performance.now() });
  }
}

async function loadClassicScript(documentRoot: Document, src: string): Promise<void> {
  if ([...documentRoot.scripts].some((script) => script.src === new URL(src, window.location.origin).href)) return;
  await new Promise<void>((resolve, reject) => { const script = documentRoot.createElement('script'); script.src = src; script.async = false; script.onload = () => resolve(); script.onerror = () => reject(new Error(`verified codec asset failed to load: ${src}`)); documentRoot.head.append(script); });
}

async function corpusPayload(entry: CorpusCase, index: number): Promise<Uint8Array> {
  if (entry.pattern !== 'pseudorandom') return bytesFor(entry, index);
  const seedDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${seed}:${entry.direction}:${entry.size}:${index}`)));
  let state = new DataView(seedDigest.buffer).getUint32(0, true); const output = new Uint8Array(entry.size);
  for (let offset = 0; offset < output.length; offset += 1) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; output[offset] = state >>> 24; }
  return output;
}
