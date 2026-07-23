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
}

export interface AppliedQuietSettings {
  microphoneLabel: string;
  trackSampleRate: number | undefined;
  channelCount: number | undefined;
  echoCancellation: boolean | undefined;
  noiseSuppression: boolean | undefined;
  autoGainControl: boolean | undefined;
}

export interface CorpusCase { id: string; direction: LiteralDirection; size: number; pattern: string; sha256: string; }
export interface QuietFragment { epoch: number; sender: Role; direction: LiteralDirection; caseId: string; caseIndex: number; fragmentIndex: number; fragmentCount: number; declaredLength: number; digestPrefix: Uint8Array; payload: Uint8Array; }
export interface ReceiveCaseEvidence { epoch: number; sender: Role; direction: LiteralDirection; caseId: string; digest: string; acquiredAtMs: number; airtimeMs: number; deliveryCount: number; complete: boolean; corrupt: boolean; missing: number; duplicates: number; }

type QuietTransmitter = { transmit(buffer: ArrayBuffer): void; destroy(): void; frameLength: number };
type QuietReceiver = { destroy(): void };
type QuietApi = {
  init(options: { profilesPrefix: string; memoryInitializerPrefix: string; libfecPrefix: string; onReady: () => void; onError: (reason: string) => void }): void;
  transmitter(options: { profile: string; clampFrame: boolean; onFinish: () => void }): QuietTransmitter;
  receiver(options: { profile: string; onReceive: (frame: ArrayBuffer) => void; onCreate: () => void; onCreateFail: (reason: string) => void; onReceiveFail: () => void }): QuietReceiver;
};

declare global { interface Window { Quiet?: QuietApi; } }

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const seed = 'fipwave-phase-01-corpus-v1';

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
  if (!value.machineId || (value.role !== 'A' && value.role !== 'B') || !value.reportTarget || !value.tunEvidence || !evidenceClass || !['Fixture', 'Loopback', 'Open air'].includes(evidenceClass) || value.evidenceMode !== evidenceClass) throw new Error('runner qualification configuration is invalid');
  return Object.freeze({ machineId: value.machineId, role: value.role, reportTarget: value.reportTarget, tunEvidence: value.tunEvidence, evidenceMode: evidenceClass, evidenceClass });
}

export function directionForRole(role: Role): LiteralDirection { return role === 'A' ? 'A → B' : 'B → A'; }

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

export class QuietReceiverEvidence {
  #parts = new Map<string, { fragment: QuietFragment; parts: Map<number, Uint8Array>; duplicates: number; startedAtMs: number }>();
  accept(raw: ArrayBuffer, nowMs = performance.now()): Promise<ReceiveCaseEvidence | undefined> {
    let fragment: QuietFragment; try { fragment = decodeFragment(raw); } catch { return Promise.resolve(undefined); }
    const key = `${fragment.epoch}\u0000${fragment.sender}\u0000${fragment.caseId}`;
    const current = this.#parts.get(key) ?? { fragment, parts: new Map(), duplicates: 0, startedAtMs: nowMs };
    if (current.parts.has(fragment.fragmentIndex)) current.duplicates += 1; else current.parts.set(fragment.fragmentIndex, fragment.payload);
    this.#parts.set(key, current);
    if (current.parts.size !== fragment.fragmentCount) return Promise.resolve(undefined);
    return (async () => {
      const payload = new Uint8Array([...current.parts.entries()].sort(([a], [b]) => a - b).flatMap(([, bytes]) => [...bytes])).slice(0, fragment.declaredLength);
      const expected = (manifest.cases as CorpusCase[]).find((entry) => entry.id === fragment.caseId)?.sha256 ?? '';
      const digest = await sha256(payload); const corrupt = digest !== expected || payload.byteLength !== fragment.declaredLength;
      this.#parts.delete(key);
      return { epoch: fragment.epoch, sender: fragment.sender, direction: fragment.direction, caseId: fragment.caseId, digest, acquiredAtMs: current.startedAtMs, airtimeMs: nowMs - current.startedAtMs, deliveryCount: current.duplicates ? 2 : 1, complete: true, corrupt, missing: 0, duplicates: current.duplicates };
    })();
  }
}

export class QuietClient {
  #transmitter: QuietTransmitter | undefined;
  #receiver: QuietReceiver | undefined;
  #track: MediaStreamTrack | undefined;
  #originalGetUserMedia: unknown;
  #epoch = 0;
  #receiverEvidence = new QuietReceiverEvidence();
  #onReceive: (evidence: ReceiveCaseEvidence) => void;
  #applied: AppliedQuietSettings | undefined;

  constructor(onReceive: (evidence: ReceiveCaseEvidence) => void = () => undefined) { this.#onReceive = onReceive; }
  get applied(): AppliedQuietSettings | undefined { return this.#applied; }

  async arm(epoch: number): Promise<AppliedQuietSettings> {
    await this.reset(); this.#epoch = epoch;
    const nav = navigator as Navigator & { getUserMedia?: (constraints: MediaStreamConstraints, success: (stream: MediaStream) => void, failure: (error: unknown) => void) => void };
    this.#originalGetUserMedia = nav.getUserMedia;
    nav.getUserMedia = (_ignored, success, failure) => { void navigator.mediaDevices.getUserMedia({ audio: { channelCount: { exact: 1 }, sampleRate: { ideal: 48_000 }, echoCancellation: { exact: false }, noiseSuppression: { exact: false }, autoGainControl: { exact: false } }, video: false }).then((stream) => { this.#track = stream.getAudioTracks()[0]; success(stream); }, failure); };
    await loadClassicScript('/codec-assets/quiet.js');
    const quiet = window.Quiet; if (!quiet) throw new Error('verified Quiet runtime did not load');
    await new Promise<void>((resolve, reject) => quiet.init({ profilesPrefix: '/codec-assets/', memoryInitializerPrefix: '/codec-assets/', libfecPrefix: '/codec-assets/', onReady: resolve, onError: (reason) => reject(new Error(`Quiet initialization failed: ${reason}`)) }));
    await loadClassicScript('/codec-assets/libfec.js'); await loadClassicScript('/codec-assets/quiet-emscripten.js');
    await new Promise<void>((resolve, reject) => {
      const ready = () => resolve();
      // init is idempotent enough for the stock asset; this second registration waits for Emscripten after scripts load.
      quiet.init({ profilesPrefix: '/codec-assets/', memoryInitializerPrefix: '/codec-assets/', libfecPrefix: '/codec-assets/', onReady: ready, onError: (reason) => reject(new Error(`Quiet initialization failed: ${reason}`)) });
    });
    await new Promise<void>((resolve, reject) => {
      this.#receiver = quiet.receiver({ profile: QUIET_PROFILE, onReceive: (raw) => { void this.#receiverEvidence.accept(raw).then((evidence) => { if (evidence) this.#onReceive(evidence); }); }, onCreate: resolve, onCreateFail: (reason) => reject(new Error(`Quiet microphone failed: ${reason}`)), onReceiveFail: () => undefined });
    });
    const settings = this.#track?.getSettings() ?? {}; const flag = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
    const applied: AppliedQuietSettings = { microphoneLabel: this.#track?.label || 'Unavailable', trackSampleRate: settings.sampleRate, channelCount: settings.channelCount, echoCancellation: flag(settings.echoCancellation), noiseSuppression: flag(settings.noiseSuppression), autoGainControl: flag(settings.autoGainControl) };
    this.#applied = applied;
    if (applied.trackSampleRate !== 48_000 || applied.channelCount !== 1 || applied.echoCancellation !== false || applied.noiseSuppression !== false || applied.autoGainControl !== false) { await this.reset(); throw new Error('Quiet applied microphone settings are incompatible'); }
    return applied;
  }

  async sendCorpus(role: Role, epoch: number, onProgress: (entry: CorpusCase, index: number, total: number) => void): Promise<void> {
    if (!this.#receiver || epoch !== this.#epoch || !window.Quiet) throw new Error('Quiet is not armed');
    const entries = (manifest.cases as CorpusCase[]).filter((entry) => entry.direction === directionForRole(role));
    for (const [index, entry] of entries.entries()) {
      const payload = await corpusPayload(entry, index % (entry.size === 256 ? 20 : 5)); const digest = await sha256(payload); if (digest !== entry.sha256) throw new Error(`committed corpus digest mismatch: ${entry.id}`);
      const fragments = fragmentCase({ epoch, sender: role, caseIndex: index, entry, payload });
      await new Promise<void>((resolve) => { this.#transmitter?.destroy(); this.#transmitter = window.Quiet!.transmitter({ profile: QUIET_PROFILE, clampFrame: QUIET_CLAMP_FRAME, onFinish: () => window.setTimeout(resolve, QUIET_GUARD_MS) }); fragments.forEach((fragment) => this.#transmitter!.transmit(encodeFragment(fragment))); });
      onProgress(entry, index + 1, entries.length);
    }
  }

  async reset(): Promise<void> {
    this.#transmitter?.destroy(); this.#receiver?.destroy(); this.#transmitter = undefined; this.#receiver = undefined; this.#track?.stop(); this.#track = undefined; this.#applied = undefined;
    const nav = navigator as Navigator & { getUserMedia?: unknown }; if (this.#originalGetUserMedia !== undefined) nav.getUserMedia = this.#originalGetUserMedia as never; else delete nav.getUserMedia; this.#originalGetUserMedia = undefined;
  }
}

async function loadClassicScript(src: string): Promise<void> {
  if ([...document.scripts].some((script) => script.src === new URL(src, window.location.origin).href)) return;
  await new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.async = false; script.onload = () => resolve(); script.onerror = () => reject(new Error(`verified codec asset failed to load: ${src}`)); document.head.append(script); });
}

async function corpusPayload(entry: CorpusCase, index: number): Promise<Uint8Array> {
  if (entry.pattern !== 'pseudorandom') return bytesFor(entry, index);
  const seedDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${seed}:${entry.direction}:${entry.size}:${index}`)));
  let state = new DataView(seedDigest.buffer).getUint32(0, true); const output = new Uint8Array(entry.size);
  for (let offset = 0; offset < output.length; offset += 1) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; output[offset] = state >>> 24; }
  return output;
}
