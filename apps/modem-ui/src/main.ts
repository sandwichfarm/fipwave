import './style.css';
import { armAudio, canBufferPcmCaptureFrame, enqueuePcmPlayback, resetAudio, setPcmCaptureHandler, validatePcmPlaybackFrame, type AppliedAudioEvidence } from './audio.js';
import { acceptBridgePlaybackFrame } from '../../../packages/bridge/src/codecs/websocket.js';
import { FipsTrafficClass, isFipsTrafficClass } from '../../../packages/bridge/src/protocol.js';
import { createFipsPacketAdapter, type FipsPacketEnvelope } from './fips-packet-adapter.js';
import { decodeFas1, Fas1UnitType } from './acoustic-protocol.js';
import { AcousticSession } from './acoustic-session.js';
import { AcousticSessionAdapter } from './acoustic-session-adapter.js';
import { projectAcousticStatus } from './acoustic-status.js';
import { reduceBridgeState, validateBridgeSnapshot, type BridgeState } from './bridge-state.js';
import { CyrinxCaseWatchdog, sameCyrinxBrowserCase, type CyrinxBrowserCase } from './cyrinx-case-watchdog.js';
import { CyrinxQualificationSession, type CyrinxSessionSnapshot } from './qualification-session.js';
import { safeConfigReason, safeUiReason } from './ui-errors.js';
import { reduceProofState, type ProofState } from './proof-state.js';
import { DEMO_IMAGE_DATA_URL, DEMO_IMAGE_HEIGHT, DEMO_IMAGE_WIDTH, decodeBand, demoImageRaster, type ImageTransferSnapshot } from './demo-image.js';
import {
  QUIET_PROFILE,
  QuietClient,
  decodeResetFrame,
  directionForRole,
  encodeControlFrame,
  fetchRunnerConfig,
  peerRole,
  readFwavMessageType,
  receiveDirectionForRole,
  type RunnerConfig,
  type ReceiveCaseEvidence,
} from './quiet-client.js';

type UiState = 'idle' | 'requesting' | 'ready' | 'failed' | 'disconnected';

declare global {
  interface Window {
    __FIPWAVE_ACOUSTIC_FIXTURE__?: boolean;
    __fipwaveAcousticFixture?: Readonly<{ evidenceClass: 'Fixture'; aReady: boolean; bReady: boolean; aToBBytes: number; bToABytes: number }>;
  }
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Modem UI root is unavailable');
const appRoot: HTMLDivElement = app;
// Vite's diagnostic server intentionally has no runner authority. The shipped
// production route is always runner-backed and never uses this fixture branch.
const developmentDiagnostic = window.location.port === '5173';
const viewParams = new URLSearchParams(`${window.location.search.slice(1)}&${window.location.hash.replace(/^#/, '')}`);
// The local Vite route has always been a diagnostics surface and the existing
// browser tests intentionally exercise it that way. A shipped runner opens the
// audience view unless the operator explicitly asks for #debug (or ?debug=1).
let debugMode = viewParams.has('debug') || (developmentDiagnostic && !viewParams.has('demo')) || (navigator.webdriver && !viewParams.has('demo'));

let epoch = 1;
let evidence: AppliedAudioEvidence | undefined;
let uiState: UiState = 'idle';
let failure = '';
let bridge: WebSocket | undefined;
let bridgeGeneration = 0;
let bridgeSequence = 0n;
let bridgeDelivery = 'Not connected';
let packetGeneration = 0;
let browserPacketReady = false;
let packetTx = 0;
let packetRx = 0;
let bridgeState: BridgeState | undefined;
let quietRuntime = 'Not armed';
type QuietCorpusSendState = 'unavailable' | 'ready' | 'sending' | 'sent';
let quietCorpusSendState: QuietCorpusSendState = 'unavailable';
let quietFailureReportedEpoch: number | undefined;
let runnerConfig: Readonly<RunnerConfig> | undefined;
let configFailure = '';
let resetFailure = '';
let proofState: ProofState = reduceProofState(undefined, { type: 'snapshot', value: { state: 'loading', pingReady: false, reason: 'proof_unavailable', result: null } });
let proofRequest: Promise<void> | undefined;
let acousticCapability: Readonly<{ epoch: number; bytes: Uint8Array }> | undefined;
let fipsDetailsRevealed = false;
let imageTransfer: ImageTransferSnapshot = Object.freeze({ transferId: null, width: 0, height: 0, receivedRows: 0, complete: false, revision: 0, bands: Object.freeze([]) });
let imageTransferSending = false;
let imageTransferMessage = 'Waiting for the authenticated FIPS link';
type MeasuredProbe = Readonly<{ received: true; bytePerfect: true; corrupt: false; missing: false; duplicate: false; discontinuity: boolean; latencyMs: undefined; signalDb: undefined; clipping: undefined; confidence: 1 }>;
const receivedProbes = new Map<string, MeasuredProbe>();
function probeReceiptKey(sessionId: bigint, direction: number, candidateIndex: number, probeIndex: number): string {
  return `${epoch}:${sessionId}:${direction}:${candidateIndex}:${probeIndex}`;
}
function requestedPlaybackGain(): number {
  const raw = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('playbackGain');
  if (raw === null || raw.trim() === '') return 1;
  const gain = Number(raw);
  return Number.isFinite(gain) && gain > 0 && gain <= 4 ? gain : 1;
}
function requestedCorpusLimit(): number | undefined {
  const raw = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('corpusLimit');
  if (raw === null || raw.trim() === '') return undefined;
  const limit = Number(raw);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 25 ? limit : undefined;
}
const quiet = new QuietClient((received) => { void appendQuietEvidence(received); }, { playbackGain: requestedPlaybackGain() });
const quietCorpusLimit = requestedCorpusLimit();
let acousticSession: AcousticSession | undefined;
let acousticAdapter: AcousticSessionAdapter | undefined;
let acousticTx = 0;
let acousticRx = 0;
let acousticFramesTx = 0;
let acousticFramesRx = 0;
type DemoStageTiming = Readonly<{ label: string; durationMs: number }>;
let activeDemoStage: { label: string; startedAtMs: number } | undefined;
let completedDemoStages: DemoStageTiming[] = [];
function resetDemoStageTimings(): void {
  activeDemoStage = undefined;
  completedDemoStages = [];
}
function syncDemoStageTiming(label: string, nowMs = performance.now()): Readonly<{ elapsedMs: number; completed: readonly DemoStageTiming[] }> {
  if (!activeDemoStage) activeDemoStage = { label, startedAtMs: nowMs };
  else if (activeDemoStage.label !== label) {
    completedDemoStages = [...completedDemoStages, Object.freeze({ label: activeDemoStage.label, durationMs: Math.max(0, nowMs - activeDemoStage.startedAtMs) })].slice(-8);
    activeDemoStage = { label, startedAtMs: nowMs };
  }
  return Object.freeze({ elapsedMs: Math.max(0, nowMs - activeDemoStage.startedAtMs), completed: completedDemoStages });
}
function formatDemoDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}
type GateState = 'not-started' | 'cyrinx-running';
type CorpusRow = { direction: string; caseId: string; evidenceClass: 'Fixture' | 'Loopback' | 'Open air'; result: string; airtime: string };
let gateState: GateState = 'not-started';
let corpusRows: CorpusRow[] = [];
const cyrinxSession = new CyrinxQualificationSession();
type CyrinxCaptureCase = CyrinxBrowserCase & { generation: number; baseSampleIndex?: number; nextSampleIndex: number };
type CyrinxTransmitCase = CyrinxBrowserCase & { generation: number; completionSent: boolean };
let captureCase: CyrinxCaptureCase | undefined;
let captureGeneration = 0;
let transmitCase: CyrinxTransmitCase | undefined;
const cyrinxCaseWatchdog = new CyrinxCaseWatchdog((value) => {
  reportCyrinxRuntimeFailure(value);
  if (sameCyrinxBrowserCase(captureCase, value)) clearCyrinxCapture();
  if (sameCyrinxBrowserCase(transmitCase, value)) transmitCase = undefined;
});

type Pending<T> = { resolve(value: T): void; reject(error: Error): void; timer: number };
let pendingSettings: Pending<void> | undefined;
let pendingReset: (Pending<number> & { previousEpoch: number; socket: WebSocket; generation: number }) | undefined;
const pendingResults = new Map<string, Pending<void>>();

const FWAV_HEADER_BYTES = 32;
const FIPS_PACKET_TYPE = 9;
const FIPS_PACKET_ADMISSION_TYPE = 14;
const FIPS_PACKET_ADMISSION_ACCEPTED = 1;
const FIPS_PACKET_ADMISSION_QUEUE_FULL = 2;
function encodeFipsPacket(payload: Uint8Array, trafficClass: FipsTrafficClass): ArrayBuffer {
  if (!browserPacketReady || payload.byteLength === 0 || payload.byteLength > 256 * 1024 - FWAV_HEADER_BYTES) throw new Error('FIPS packet adapter is not ready for this packet');
  if (!isFipsTrafficClass(trafficClass)) throw new Error('FIPS packet frame traffic class is invalid');
  const output = new ArrayBuffer(FWAV_HEADER_BYTES + payload.byteLength);
  const bytes = new Uint8Array(output); const view = new DataView(output);
  bytes.set([0x46, 0x57, 0x41, 0x56]); view.setUint8(4, 1); view.setUint8(5, FIPS_PACKET_TYPE);
  view.setUint8(6, trafficClass);
  view.setUint32(8, payload.byteLength, true); view.setUint32(12, epoch, true); view.setBigUint64(16, bridgeSequence++, true);
  bytes.set(payload, FWAV_HEADER_BYTES);
  return output;
}
function decodeFipsPacket(input: ArrayBuffer): FipsPacketEnvelope & { sequence: bigint } {
  if (input.byteLength <= FWAV_HEADER_BYTES || input.byteLength > 256 * 1024) throw new Error('FIPS packet frame size is invalid');
  const bytes = new Uint8Array(input); const view = new DataView(input);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== 'FWAV' || view.getUint8(4) !== 1 || view.getUint8(5) !== FIPS_PACKET_TYPE) throw new Error('FIPS packet frame identity is invalid');
  const trafficClass = view.getUint8(6);
  if (view.getUint32(8, true) !== input.byteLength - FWAV_HEADER_BYTES || view.getUint8(7) !== 0 || !isFipsTrafficClass(trafficClass) || view.getUint32(24, true) !== 0 || view.getUint16(28, true) !== 0 || view.getUint16(30, true) !== 0) throw new Error('FIPS packet frame header is invalid');
  if (view.getUint32(12, true) !== epoch) throw new Error('FIPS packet frame is stale');
  return Object.freeze({ bytes: bytes.slice(FWAV_HEADER_BYTES), trafficClass, sequence: view.getBigUint64(16, true) });
}
function sendFipsPacketAdmission(socket: WebSocket, packetEpoch: number, sequence: bigint, accepted: boolean): void {
  const payload = Uint8Array.of(accepted ? FIPS_PACKET_ADMISSION_ACCEPTED : FIPS_PACKET_ADMISSION_QUEUE_FULL);
  socket.send(encodeControlFrame({ type: FIPS_PACKET_ADMISSION_TYPE, epoch: packetEpoch, sequence, payload }));
}
let fipsPackets = createFipsPacketAdapter({
  onPacket(envelope) {
    packetRx += 1;
    syncBridgeState();
    window.dispatchEvent(new CustomEvent('fips-packet-received', { detail: envelope }));
    return { accepted: true };
  },
  emitPacket(envelope) {
    const socket = bridge;
    if (!browserPacketReady || !socket || socket.readyState !== WebSocket.OPEN) throw new Error('FIPS packet adapter is disconnected');
    socket.send(encodeFipsPacket(envelope.bytes, envelope.trafficClass));
    packetTx += 1;
    syncBridgeState();
  },
});

function readinessPayload(controlEpoch: number): Uint8Array | undefined {
  const snapshot = acousticSession?.snapshot;
  if (!snapshot?.ready || snapshot.epoch !== controlEpoch || !snapshot.sessionId || !snapshot.settingsDigest || snapshot.settingsDigest.byteLength !== 32 || snapshot.lastHeartbeatAtMs === undefined || !acousticCapability || acousticCapability.epoch !== controlEpoch || acousticCapability.bytes.byteLength !== 16 || snapshot.lastHeartbeatAtMs < 0) return undefined;
  const payload = new Uint8Array(64); const view = new DataView(payload.buffer);
  view.setBigUint64(0, snapshot.sessionId, true);
  payload.set(snapshot.settingsDigest, 8);
  view.setBigUint64(40, BigInt(snapshot.lastHeartbeatAtMs), true);
  payload.set(acousticCapability.bytes, 48);
  return payload;
}
function sendAcousticControl(type: 12 | 13, controlEpoch: number): boolean {
  const socket = bridge;
  if (!socket || socket.readyState !== WebSocket.OPEN || !acousticCapability || acousticCapability.epoch !== controlEpoch) return false;
  const payload = type === 12 ? readinessPayload(controlEpoch) : acousticCapability.bytes;
  if (!payload) return false;
  try { socket.send(encodeControlFrame({ type, epoch: controlEpoch, sequence: 0n, payload })); return true; }
  catch { return false; }
}

/** Builds the only browser composition path: opaque FIPS packet → session → FAS1 unit → Quiet. */
function configureAcousticSession(config: Readonly<RunnerConfig>): void {
  acousticAdapter?.invalidate();
  acousticSession?.dispose();
  const acousticConfig = config.acoustic;
  // Local bridge/audio facts remain usable without a peer or a calibration
  // projection. Only the acoustic/FIPS path is unavailable in that mode.
  if (!acousticConfig) { acousticSession = undefined; acousticAdapter = undefined; return; }
  let adapter: AcousticSessionAdapter | undefined;
  let transmit = Promise.resolve();
  const modem = {
    send(unit: Uint8Array): Promise<void> {
      const queuedEpoch = epoch;
      acousticFramesTx += 1;
      // Quiet's Promise is local playback completion plus guard only. The
      // session's remote ACK and heartbeat remain the delivery/readiness proof.
      transmit = transmit.then(() => quiet.sendUnit(unit, queuedEpoch)).then(() => undefined, () => {
        adapter?.markDegraded();
      });
      return transmit;
    },
    onUnit(handler: (unit: Uint8Array) => void): () => void {
      return quiet.onUnit((unit) => {
        acousticFramesRx += 1;
        // Quiet has already delivered a modem frame.  A FAS1 parse gives us an
        // actual current-generation integrity observation; it does not invent
        // unmeasurable RSSI, clipping, or one-way latency values.
        try {
          const decoded = decodeFas1(unit);
          if (decoded.type === Fas1UnitType.Probe && decoded.body.byteLength === 3) {
            receivedProbes.set(
              probeReceiptKey(decoded.sessionId, decoded.body[0]!, decoded.body[1]!, decoded.body[2]!),
              Object.freeze({ received: true, bytePerfect: true, corrupt: false, missing: false, duplicate: false, discontinuity: quiet.metrics.discontinuities > 0, latencyMs: undefined, signalDb: undefined, clipping: undefined, confidence: 1 }),
            );
          }
        } catch {
          // A corrupt codec payload never becomes a calibration observation.
        }
        handler(unit); adapter?.refresh();
      });
    },
    applyCandidate(candidate: { playbackGain: number; repetition: number; guardMs: number }): void { quiet.configureAcousticCandidate(candidate); },
  };
  const session = new AcousticSession({
    role: config.role, identity: config.machineId, expectedPeer: config.role === 'A' ? 'fipwave-b' : 'fipwave-a', modem,
    clock: { now: () => Date.now() }, timers: { setTimeout: (callback, delay) => window.setTimeout(callback, delay) as unknown as ReturnType<typeof setTimeout>, clearTimeout: (handle) => window.clearTimeout(handle as unknown as number) },
    nonce: () => crypto.getRandomValues(new Uint8Array(16)), profiles: acousticConfig.profiles, ranges: acousticConfig.ranges,
    // Preserve the exact runner allowlist and order.  Warm-start selection is
    // performed by the session only after literal A→B then B→A observations.
    candidates: acousticConfig.candidates.map((candidate) => ({ ...candidate })),
    calibration: { ...acousticConfig.calibration },
    measureProbe: (probe) => receivedProbes.get(probeReceiptKey(
      acousticSession?.snapshot.sessionId ?? 0n,
      probe.direction === 'AtoB' ? 1 : 2,
      probe.candidateIndex,
      probe.probeIndex,
    )) ?? Object.freeze({ received: false, bytePerfect: false, corrupt: false, missing: true, duplicate: false, discontinuity: quiet.metrics.discontinuities > 0, latencyMs: undefined, signalDb: undefined, clipping: undefined, confidence: 0 }),
    onPacket: (packet) => { acousticRx += 1; adapter?.deliver(packet, FipsTrafficClass.Ordinary); },
  });
  adapter = new AcousticSessionAdapter({
    session,
    emitPacket(envelope) {
      const socket = bridge;
      if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('FIPS bridge is disconnected');
      socket.send(encodeFipsPacket(envelope.bytes, envelope.trafficClass)); acousticTx += 1;
    },
    controls: {
      ready(controlEpoch) { browserPacketReady = sendAcousticControl(12, controlEpoch); if (browserPacketReady) packetGeneration = adapter!.generation; syncBridgeState(); },
      disarm(controlEpoch) { browserPacketReady = false; sendAcousticControl(13, controlEpoch); syncBridgeState(); },
    },
  });
  acousticSession = session;
  acousticAdapter = adapter;
  fipsPackets = adapter.fips;
}

/** Deterministic in-page FAS1-only acceptance seam; it has no WebSocket or physical-audio path. */
async function runAcousticFixtureIfRequested(): Promise<void> {
  if (!window.__FIPWAVE_ACOUSTIC_FIXTURE__) return;
  class FixtureModem {
    handler: ((unit: Uint8Array) => void) | undefined;
    peer: FixtureModem | undefined;
    send(unit: Uint8Array): void { this.peer?.handler?.(unit.slice()); }
    onUnit(handler: (unit: Uint8Array) => void): () => void { this.handler = handler; return () => { if (this.handler === handler) this.handler = undefined; }; }
  }
  const timers = new Map<number, { callback: () => void; dueAtMs: number }>(); let timerId = 0; let fixtureNowMs = 0;
  const timerApi = { setTimeout: (callback: () => void, delayMs = 0) => { const id = ++timerId; timers.set(id, { callback, dueAtMs: fixtureNowMs + delayMs }); return id as unknown as ReturnType<typeof setTimeout>; }, clearTimeout: (handle: ReturnType<typeof setTimeout>) => { timers.delete(handle as unknown as number); } };
  const left = new FixtureModem(); const right = new FixtureModem(); left.peer = right; right.peer = left;
  const receivedA: Uint8Array[] = []; const receivedB: Uint8Array[] = [];
  const fixtureOptions = (role: 'A' | 'B', modem: FixtureModem, received: Uint8Array[]) => ({
    role, identity: role === 'A' ? 'fixture-a' : 'fixture-b', expectedPeer: role === 'A' ? 'fixture-b' : 'fixture-a', modem,
    clock: { now: () => 0 }, timers: timerApi, nonce: () => new Uint8Array(role === 'A' ? Array(16).fill(1) : Array(16).fill(2)),
    profiles: ['quiet-audible-7k-v1'], ranges: { minPayloadBytes: 96, maxPayloadBytes: 217 },
    candidates: [{ id: 'quiet-audible-7k-v1', profileId: 'quiet-audible-7k-v1', payloadBytes: 96, repetition: 1, guardMs: 750, playbackGain: 1, ackTimeoutMs: 4_000 }],
    calibration: { probesPerDirection: 1, maxCandidates: 1, deadlineMs: 30_000 },
    measureProbe: () => ({ received: true, bytePerfect: true, corrupt: false, missing: false, duplicate: false, discontinuity: false, latencyMs: 1, signalDb: -20, clipping: false, confidence: 1 }),
    onPacket: (packet: Uint8Array) => received.push(packet.slice()),
  });
  const a = new AcousticSession(fixtureOptions('A', left, receivedA)); const b = new AcousticSession(fixtureOptions('B', right, receivedB));
  a.start(); for (let round = 0; round < 4; round += 1) await Promise.all([a.settle(), b.settle()]);
  const flush = () => {
    const nextDueAtMs = Math.min(...[...timers.values()].map((timer) => timer.dueAtMs));
    fixtureNowMs = nextDueAtMs;
    const callbacks = [...timers.entries()].filter(([, timer]) => timer.dueAtMs === nextDueAtMs);
    callbacks.forEach(([id]) => timers.delete(id));
    callbacks.forEach(([, timer]) => timer.callback());
  };
  const drainUntil = async (complete: () => boolean): Promise<void> => {
    for (let turn = 0; turn < 128; turn += 1) {
      await Promise.all([a.settle(), b.settle()]);
      if (complete()) return;
      flush();
    }
    throw new Error('Fixture acoustic delivery did not quiesce within the bounded turn budget');
  };
  a.enqueuePacket(Uint8Array.from({ length: 1_357 }, (_, index) => index & 0xff));
  await drainUntil(() => receivedB.length === 1);
  b.enqueuePacket(Uint8Array.from({ length: 1_357 }, (_, index) => (255 - index) & 0xff));
  await drainUntil(() => receivedA.length === 1);
  window.__fipwaveAcousticFixture = Object.freeze({ evidenceClass: 'Fixture', aReady: a.snapshot.ready, bReady: b.snapshot.ready, aToBBytes: receivedB[0]?.byteLength ?? 0, bToABytes: receivedA[0]?.byteLength ?? 0 });
  a.dispose(); b.dispose();
}
window.addEventListener('fips-packet-send', (event) => {
  const packet = (event as CustomEvent<unknown>).detail;
  if (!(packet instanceof Uint8Array)) return;
  const result = fipsPackets.send(packet);
  if (!result.accepted) bridgeDelivery = `FIPS packet rejected — ${result.reason}`;
});

const labels: Record<UiState, string> = {
  idle: 'Idle', requesting: 'Requesting', ready: 'Ready', failed: 'Failed', disconnected: 'Disconnected',
};

const bodyCopy: Record<UiState, string> = {
  idle: 'Arm this laptop to request microphone access, start audio, and verify the applied capture settings.',
  requesting: 'Requesting microphone and starting audio…',
  ready: 'Audio preflight passed on this laptop.',
  failed: '',
  disconnected: 'Local bridge disconnected. Qualification is paused; no result is being inferred.',
};

function localBridgeCopy(state: BridgeState | undefined): string {
  if (!state) return 'Local bridge: not connected';
  if (state.status === 'ready') return `Local bridge ready · epoch ${state.epoch}`;
  if (state.status === 'resetting') return 'Resetting local session…';
  if (state.status === 'disconnected') return 'Local bridge disconnected. Reset and reconnect to start a new local session.';
  if (state.status === 'overflow') return 'Bridge queue limit reached; the frame was rejected. Reset and reconnect before continuing.';
  if (state.status === 'rejected') return 'Bridge rejected an invalid frame. Reset and reconnect before continuing.';
  return 'Local bridge: not connected';
}

function completePacketCopy(state: BridgeState | undefined): string {
  if (!state) return 'Unknown';
  const prefix = state.stale ? `Previous epoch: ${state.epoch}` : `Epoch ${state.epoch}`;
  const txLabel = state.txPackets === 1 ? 'packet' : 'packets';
  const rxLabel = state.rxPackets === 1 ? 'packet' : 'packets';
  return `${prefix} · TX complete ${txLabel}: ${state.txPackets} · RX complete ${rxLabel}: ${state.rxPackets}`;
}

function roleDescription(role: 'A' | 'B'): string {
  return role === 'A' ? 'gateway' : 'acoustically isolated node';
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function settingValue(value: unknown): string {
  return value === undefined ? 'Unknown' : String(value);
}

function frameForSettings(value: AppliedAudioEvidence): ArrayBuffer {
  const payload = new TextEncoder().encode(JSON.stringify({
    browserVersion: navigator.userAgent,
    microphoneLabel: value.microphoneLabel,
    contextState: value.contextState,
    contextSampleRate: value.contextSampleRate,
    inputDeviceSampleRate: value.inputDeviceSampleRate,
    captureSampleRate: value.captureSampleRate,
    inputDeviceChannels: value.inputDeviceChannels,
    channels: value.captureChannels,
    echoCancellation: value.echoCancellation,
    noiseSuppression: value.noiseSuppression,
    autoGainControl: value.autoGainControl,
  }));
  return encodeControlFrame({ type: 2, epoch: value.epoch, sequence: bridgeSequence++, payload });
}

function asError(reason: unknown, fallback: string): Error { return reason instanceof Error ? reason : new Error(fallback); }
let bridgeStatusFetch: Promise<void> | undefined;
async function refreshBridgeState(): Promise<void> {
  if (developmentDiagnostic || bridgeStatusFetch) return bridgeStatusFetch;
  bridgeStatusFetch = fetch('/bridge-status', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Bridge status is unavailable');
      const snapshot = validateBridgeSnapshot(await response.json());
      if (!snapshot) throw new Error('Bridge status was invalid');
      bridgeState = reduceBridgeState(bridgeState, { type: 'snapshot', snapshot });
    })
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'Bridge status is unavailable';
      bridgeState = reduceBridgeState(bridgeState, { type: 'reset-failed', reason });
    })
    .finally(() => { bridgeStatusFetch = undefined; render(); });
  return bridgeStatusFetch;
}
function syncBridgeState(): void {
  void refreshBridgeState();
}
function resultKey(caseId: string, resultEpoch: number): string { return `${resultEpoch}\u0000${caseId}`; }
function reportCyrinxRuntimeFailure(value: CyrinxBrowserCase): void {
  const socket = bridge;
  if (
    value.epoch !== epoch
    || cyrinxSession.snapshot.codec !== 'cyrinx'
    || !socket
    || socket.readyState !== WebSocket.OPEN
  ) return;
  try {
    const frame = encodeControlFrame({ type: 7, epoch: value.epoch, sequence: bridgeSequence });
    socket.send(frame);
    bridgeSequence += 1n;
  } catch {
    // Reporting is best-effort and must never replace the original case error.
  }
}
function reportQuietRuntimeFailure(failureEpoch: number): void {
  const socket = bridge;
  if (
    failureEpoch !== epoch
    || quietFailureReportedEpoch === failureEpoch
    || cyrinxSession.snapshot.codec !== 'quiet'
    || !socket
    || socket.readyState !== WebSocket.OPEN
  ) return;
  try {
    const frame = encodeControlFrame({ type: 7, epoch: failureEpoch, sequence: bridgeSequence });
    socket.send(frame);
    bridgeSequence += 1n;
    quietFailureReportedEpoch = failureEpoch;
  } catch {
    // Reporting is best-effort and must never replace the original Quiet error.
  }
}

function clearCyrinxCapture(): void { captureGeneration += 1; captureCase = undefined; setPcmCaptureHandler(undefined); }
function clearCyrinxCase(): void { cyrinxCaseWatchdog.cancel(); clearCyrinxCapture(); transmitCase = undefined; }
function pcmCaptureFrame(input: { epoch: number; sequence: bigint; firstSampleIndex: bigint; samples: Float32Array }): ArrayBuffer {
  const payloadBytes = 8 + input.samples.byteLength; const output = new ArrayBuffer(32 + payloadBytes); const view = new DataView(output);
  new Uint8Array(output, 0, 4).set([0x46, 0x57, 0x41, 0x56]); view.setUint8(4, 1); view.setUint8(5, 3); view.setUint32(8, payloadBytes, true); view.setUint32(12, input.epoch, true); view.setBigUint64(16, input.sequence, true); view.setUint32(24, 48_000, true); view.setUint16(28, 1, true); view.setUint16(30, 1, true); view.setBigUint64(32, input.firstSampleIndex, true); new Float32Array(output, 40, input.samples.length).set(input.samples); return output;
}
function armCyrinxCapture(caseId: string, direction: 'A → B' | 'B → A'): void {
  const active: CyrinxCaptureCase = { epoch, generation: ++captureGeneration, caseId, direction, mode: 'listen', nextSampleIndex: 0 }; captureCase = active;
  cyrinxCaseWatchdog.arm(active);
  setPcmCaptureHandler((batch: unknown) => {
    const value = batch as { type?: unknown; epoch?: unknown; firstSampleIndex?: unknown; sampleRate?: unknown; channelCount?: unknown; encoding?: unknown; discontinuity?: unknown; samples?: unknown };
    if (captureCase !== active) return;
    if (value.type !== 'PCM_CAPTURE' || value.epoch !== active.epoch || value.sampleRate !== 48_000 || value.channelCount !== 1 || value.encoding !== 'Float32LE' || !(value.samples instanceof Float32Array) || value.samples.length !== 2048 || value.discontinuity === true) { cyrinxCaseWatchdog.fail(active); return; }
    if (active.baseSampleIndex === undefined) active.baseSampleIndex = typeof value.firstSampleIndex === 'number' ? value.firstSampleIndex : Number.NaN;
    const offset = typeof value.firstSampleIndex === 'number' ? value.firstSampleIndex - active.baseSampleIndex : Number.NaN;
    const socket = bridge;
    if (!Number.isInteger(offset) || offset !== active.nextSampleIndex || !socket || socket.readyState !== WebSocket.OPEN) { cyrinxCaseWatchdog.fail(active); return; }
    try {
      const frame = pcmCaptureFrame({ epoch: active.epoch, sequence: bridgeSequence, firstSampleIndex: BigInt(offset), samples: value.samples });
      if (!canBufferPcmCaptureFrame(socket.bufferedAmount, frame.byteLength)) { cyrinxCaseWatchdog.fail(active); return; }
      bridgeSequence += 1n;
      socket.send(frame);
      active.nextSampleIndex += value.samples.length;
      if (active.nextSampleIndex === 131_072) clearCyrinxCapture();
    }
    catch { cyrinxCaseWatchdog.fail(active); }
  });
}

function rejectPending(reason: Error): void {
  if (pendingSettings) { window.clearTimeout(pendingSettings.timer); pendingSettings.reject(reason); pendingSettings = undefined; }
  if (pendingReset) { window.clearTimeout(pendingReset.timer); pendingReset.reject(reason); pendingReset = undefined; }
  for (const pending of pendingResults.values()) { window.clearTimeout(pending.timer); pending.reject(reason); }
  pendingResults.clear();
}

function failBridge(socket: WebSocket, reason: Error): void {
  if (bridge !== socket) return;
  acousticAdapter?.invalidate(); fipsPackets.invalidate(); browserPacketReady = false; packetGeneration += 1;
  clearCyrinxCase();
  bridge = undefined;
  rejectPending(reason);
  const safeReason = safeUiReason(reason, 'local bridge message was rejected');
  bridgeDelivery = `Failed — ${safeReason}`;
  uiState = 'disconnected';
  failure = safeReason;
  bridgeState = reduceBridgeState(bridgeState, { type: 'reset-failed', reason: failure });
  render();
}

function handleBridgeMessage(socket: WebSocket, generation: number, event: MessageEvent): void {
  // A retiring socket can still receive server broadcasts after a replacement
  // is open. Only the current connection generation owns UI state or pending
  // acknowledgements.
  if (bridge !== socket || bridgeGeneration !== generation) return;
  try {
    if (developmentDiagnostic && (event.data === undefined || event.data === '{}')) {
      // Vite's deterministic local bridge fixture acknowledges the capability
      // request and AUDIO_SETTINGS with the same empty event. A capability
      // acknowledgement can legitimately arrive before settings are pending;
      // it is informational and must not tear down local preflight state.
      const settleSettings = () => {
        if (!pendingSettings) return;
        const pending = pendingSettings;
        window.clearTimeout(pending.timer);
        pendingSettings = undefined;
        pending.resolve();
      };
      settleSettings();
      // The fixture's capability acknowledgement can be delivered one
      // microtask before reportToBridge installs its AUDIO_SETTINGS promise.
      // Recheck once, without treating an empty diagnostic message as a
      // bridge error or allowing it to affect a real runner protocol.
      if (!pendingSettings) queueMicrotask(settleSettings);
      return;
    }
    if (event.data instanceof ArrayBuffer) {
      const type = readFwavMessageType(event.data);
      if (type === 8) {
        const pending = pendingReset;
        if (!pending) throw new Error('Local bridge sent an unsolicited RESET');
        if (pending.socket !== socket || pending.generation !== generation) return;
        const nextEpoch = decodeResetFrame(event.data, pending.previousEpoch);
        window.clearTimeout(pending.timer);
        pendingReset = undefined;
        pending.resolve(nextEpoch);
        return;
      }
      if (type === FIPS_PACKET_TYPE) {
        const envelope = decodeFipsPacket(event.data);
        const accepted = fipsPackets.receive(envelope.bytes, envelope.trafficClass, epoch, packetGeneration);
        sendFipsPacketAdmission(socket, epoch, envelope.sequence, accepted.accepted);
        if (!accepted.accepted) bridgeDelivery = `FIPS packet rejected — ${accepted.reason}`;
        render();
        return;
      }
      if (type !== 4) throw new Error(`Local bridge sent unsupported binary FWAV type ${type}`);
      const activeTransmit = transmitCase;
      let scheduled;
      try {
        scheduled = acceptBridgePlaybackFrame(event.data, epoch, { validate: validatePcmPlaybackFrame, enqueue: enqueuePcmPlayback });
      } catch (error) {
        if (activeTransmit) cyrinxCaseWatchdog.fail(activeTransmit);
        throw error;
      }
      if (activeTransmit) {
        const completionSocket = socket;
        const completionGeneration = generation;
        void scheduled.completion.then(() => {
          if (transmitCase !== activeTransmit || !cyrinxCaseWatchdog.owns(activeTransmit)) return;
          if (bridge !== completionSocket || bridgeGeneration !== completionGeneration || completionSocket.readyState !== WebSocket.OPEN) return;
          try {
            const payload = new TextEncoder().encode(JSON.stringify({ action: 'playback_complete', caseId: activeTransmit.caseId, direction: activeTransmit.direction }));
            const frame = encodeControlFrame({ type: 5, epoch: activeTransmit.epoch, sequence: bridgeSequence, payload });
            completionSocket.send(frame);
            bridgeSequence += 1n;
            activeTransmit.completionSent = true;
            cyrinxCaseWatchdog.markTransmitCompletionSent(activeTransmit);
          } catch {
            cyrinxCaseWatchdog.fail(activeTransmit);
          }
        }).catch(() => {
          if (bridge === completionSocket && bridgeGeneration === completionGeneration && transmitCase === activeTransmit) cyrinxCaseWatchdog.fail(activeTransmit);
        });
      }
      return;
    }
    if (typeof event.data !== 'string') throw new Error('Local bridge sent an unsupported message');
    const message = JSON.parse(event.data) as Record<string, unknown>;
    if (message.kind === 'acoustic-capability' && message.epoch === epoch && typeof message.capability === 'string' && /^[a-f0-9]{32}$/i.test(message.capability)) {
      const bytes = new Uint8Array(message.capability.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
      acousticCapability = Object.freeze({ epoch, bytes });
      // Capability delivery can race initial session establishment.  Retry only
      // the bound projection; the session itself remains the readiness source.
      if (acousticSession?.snapshot.ready && acousticAdapter) {
        browserPacketReady = sendAcousticControl(12, epoch);
        if (browserPacketReady) packetGeneration = acousticAdapter.generation;
      }
      return;
    }
    if (message.kind === 'qualification-result') {
      const caseId = typeof message.caseId === 'string' ? message.caseId : '';
      const ackEpoch = typeof message.epoch === 'number' ? message.epoch : -1;
      const pending = pendingResults.get(resultKey(caseId, ackEpoch));
      if (!pending || message.accepted !== true) throw new Error('Local bridge sent an invalid qualification-result acknowledgement');
      window.clearTimeout(pending.timer);
      pendingResults.delete(resultKey(caseId, ackEpoch));
      pending.resolve();
      return;
    }
    if (message.kind === 'cyrinx-session' && message.epoch !== epoch) throw new Error('Local bridge sent a stale Cyrinx session snapshot');
    if (message.kind === 'cyrinx-session' && (message.codec === 'idle' || message.codec === 'cyrinx' || message.codec === 'quiet' || message.codec === 'unqualified') && message.deadline && typeof message.deadline === 'object') {
      const deadline = message.deadline as Record<string, unknown>; const fallback = message.fallback as Record<string, unknown> | null;
      const snapshot: CyrinxSessionSnapshot = message.codec === 'idle' ? { codec: 'idle', stage: 'idle' } : { codec: message.codec, stage: message.stage, startedAtMs: deadline.startedAtMs, deadlineAtMs: deadline.deadlineAtMs, elapsedMs: deadline.elapsedMs, ...(typeof fallback?.reasonCode === 'string' ? { reasonCode: fallback.reasonCode } : {}) } as CyrinxSessionSnapshot;
      cyrinxSession.apply(snapshot);
      const instruction = message.instruction as Record<string, unknown> | null;
      const authoritativeInstruction: CyrinxBrowserCase | undefined =
        snapshot.codec === 'cyrinx'
        && instruction
        && (instruction.action === 'transmit' || instruction.action === 'listen')
        && typeof instruction.caseId === 'string'
        && (instruction.direction === 'A → B' || instruction.direction === 'B → A')
          ? {
              epoch,
              caseId: instruction.caseId,
              direction: instruction.direction,
              mode: instruction.action,
            }
          : undefined;
      const completedTransmit = transmitCase;
      if (
        completedTransmit?.completionSent
        && cyrinxCaseWatchdog.completeTransmitAfterAuthoritativeSnapshot({
          epoch,
          codec: snapshot.codec,
          terminal: message.terminal === true,
          ...(authoritativeInstruction ? { instruction: authoritativeInstruction } : {}),
        })
      ) transmitCase = undefined;
      bridgeDelivery = snapshot.codec === 'cyrinx' ? `Cyrinx gate: ${snapshot.stage} · deadline ${new Date(snapshot.deadlineAtMs!).toLocaleTimeString()}` : `Cyrinx rejected: ${snapshot.reasonCode}; Quiet is runner-authorized`;
      if (cyrinxSession.shouldStartQuiet) { cyrinxSession.markQuietStarted(); void startQuietFallback(); }
      if (snapshot.codec === 'cyrinx' && authoritativeInstruction && bridge?.readyState === WebSocket.OPEN && !cyrinxCaseWatchdog.owns(authoritativeInstruction)) {
        const payload = new TextEncoder().encode(JSON.stringify({ action: 'accept_cyrinx_instruction', caseId: authoritativeInstruction.caseId, direction: authoritativeInstruction.direction }));
        bridge.send(encodeControlFrame({ type: 5, epoch, sequence: bridgeSequence++, payload }));
        if (authoritativeInstruction.mode === 'listen') { transmitCase = undefined; armCyrinxCapture(authoritativeInstruction.caseId, authoritativeInstruction.direction); }
        else {
          clearCyrinxCapture();
          const active: CyrinxTransmitCase = { ...authoritativeInstruction, generation: ++captureGeneration, completionSent: false };
          transmitCase = active;
          cyrinxCaseWatchdog.arm(active);
        }
      } else if (snapshot.codec !== 'cyrinx') clearCyrinxCase();
      render();
      return;
    }
    if (message.kind === 'cyrinx-result' && message.accepted === true && message.epoch === epoch && typeof message.caseId === 'string' && (message.direction === 'A → B' || message.direction === 'B → A')) {
      clearCyrinxCase(); bridgeDelivery = `Cyrinx result accepted: ${message.caseId}`;
      render();
      return;
    }
    if (pendingSettings && typeof message.reportPath === 'string') {
      const pending = pendingSettings;
      window.clearTimeout(pending.timer);
      pendingSettings = undefined;
      pending.resolve();
      return;
    }
    // A complete canonical report notification is informative; every case was
    // already acknowledged independently before the UI could render it passed.
    if (message.complete === true && typeof message.reportPath === 'string') {
      bridgeDelivery = `Canonical report written: ${message.reportPath}`;
      render();
      return;
    }
    throw new Error('Local bridge sent an unrecognized acknowledgement');
  } catch (error) {
    failBridge(socket, asError(error, 'Local bridge message was invalid'));
  }
}

async function openFreshBridge(): Promise<WebSocket> {
  if (bridge) {
    const previous = bridge;
    bridge = undefined;
    previous.close();
  }
  rejectPending(new Error('Local bridge connection was replaced'));
  bridgeSequence = 0n;
  const socket = new WebSocket(`ws://${window.location.host}/bridge`);
  const generation = ++bridgeGeneration;
  bridge = socket;
  socket.binaryType = 'arraybuffer';
  socket.addEventListener('message', (event) => handleBridgeMessage(socket, generation, event));
  socket.addEventListener('error', () => failBridge(socket, new Error('Local bridge disconnected')));
  socket.addEventListener('close', () => failBridge(socket, new Error('Local bridge closed before delivery was accepted')));
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Local bridge connection timed out')), 5_000);
    socket.addEventListener('open', () => { window.clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { window.clearTimeout(timer); reject(new Error('Local bridge disconnected')); }, { once: true });
  });
  // Capabilities are explicitly requested after ownership is established so
  // unrelated bridge clients retain their stable startup message ordering.
  socket.send(encodeControlFrame({ type: 1, epoch, sequence: bridgeSequence++ }));
  return socket;
}

async function reportToBridge(value: AppliedAudioEvidence): Promise<void> {
  const socket = await openFreshBridge();
  const accepted = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingSettings = undefined;
      reject(new Error('Local bridge did not accept audio settings'));
    }, 5_000);
    pendingSettings = { resolve, reject, timer };
  });
  try { socket.send(frameForSettings(value)); } catch (error) { failBridge(socket, asError(error, 'Local bridge settings delivery failed')); }
  await accepted;
}

function reportQuietSettings(): Promise<void> {
  const applied = quiet.applied;
  if (!applied) return Promise.reject(new Error('Quiet applied settings are unavailable'));
  if (!applied.contextState) return Promise.reject(new Error('Quiet AudioContext state is unavailable'));
  return reportToBridge({ epoch, microphoneLabel: applied.microphoneLabel, permission: 'granted', contextState: applied.contextState, contextSampleRate: applied.contextSampleRate, inputDeviceSampleRate: applied.inputDeviceSampleRate, captureSampleRate: applied.captureSampleRate, inputDeviceChannels: applied.inputDeviceChannels, captureChannels: applied.captureChannels, echoCancellation: applied.echoCancellation, noiseSuppression: applied.noiseSuppression, autoGainControl: applied.autoGainControl, workletState: 'ready', bridgeState: 'connected' });
}

async function reportQuietResult(received: ReceiveCaseEvidence): Promise<void> {
  if (!bridge || bridge.readyState !== WebSocket.OPEN) throw new Error('Local bridge is not open for qualification-result delivery');
  const observed = quiet.metrics;
  const metrics = {
    captureHighWaterBytes: observed.captureHighWaterBytes,
    captureHighWaterMs: Math.round(observed.captureHighWaterMs),
    playbackHighWaterBytes: observed.playbackHighWaterBytes,
    playbackHighWaterMs: Math.round(observed.playbackHighWaterMs),
    discontinuities: observed.discontinuities,
  };
  const bytePerfect = received.complete && !received.corrupt && received.missing === 0 && received.duplicates === 0 && received.deliveryCount === 1 && received.digest !== null;
  const payload = new TextEncoder().encode(JSON.stringify({
    caseId: received.caseId,
    digest: received.digest,
    acquisitionMs: Math.round(received.acquisitionMs),
    airtimeMs: Math.round(received.airtimeMs),
    deliveryCount: received.deliveryCount,
    bytePerfect,
    coldAcquired: received.coldAcquired,
    complete: received.complete,
    corrupt: received.corrupt,
    missing: received.missing,
    duplicates: received.duplicates,
    queues: metrics,
  }));
  const key = resultKey(received.caseId, received.epoch);
  if (pendingResults.has(key)) throw new Error('Qualification-result delivery is already pending');
  const accepted = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingResults.delete(key);
      reject(new Error(`Local bridge did not accept result ${received.caseId}`));
    }, 5_000);
    pendingResults.set(key, { resolve, reject, timer });
  });
  try { bridge.send(encodeControlFrame({ type: 6, epoch: received.epoch, sequence: bridgeSequence++, payload })); } catch (error) { failBridge(bridge, asError(error, 'Local bridge result delivery failed')); }
  await accepted;
}

async function requestBridgeReset(): Promise<number> {
  const previousEpoch = epoch;
  acousticAdapter?.invalidate(); fipsPackets.invalidate(); browserPacketReady = false; packetGeneration += 1;
  bridgeState = reduceBridgeState(bridgeState, { type: 'reset-start' });
  const socket = bridge?.readyState === WebSocket.OPEN ? bridge : await openFreshBridge();
  const accepted = new Promise<number>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingReset = undefined;
      reject(new Error('Local bridge did not return RESET'));
    }, 5_000);
    pendingReset = { previousEpoch, socket, generation: bridgeGeneration, resolve, reject, timer };
  });
  try { socket.send(encodeControlFrame({ type: 8, epoch: previousEpoch, sequence: bridgeSequence++ })); } catch (error) { failBridge(socket, asError(error, 'Local bridge RESET delivery failed')); }
  const nextEpoch = await accepted;
  bridgeState = reduceBridgeState(bridgeState, { type: 'reset-ack', epoch: nextEpoch });
  bridgeDelivery = `RESET accepted at epoch ${nextEpoch}`;
  if (bridge === socket) {
    bridge = undefined;
    socket.close();
  }
  bridgeSequence = 0n;
  return nextEpoch;
}

function appendSetting(table: HTMLTableElement, label: string, value: unknown): void {
  const row = table.insertRow();
  const key = element('th', label);
  key.scope = 'row';
  row.append(key, element('td', settingValue(value)));
}

function proofValue(value: string | number | null | undefined): string { return value === null || value === undefined ? 'Unavailable' : String(value); }
async function refreshProofStatus(): Promise<void> {
  if (proofRequest) return proofRequest;
  proofState = reduceProofState(proofState, { type: 'refresh' }); render();
  proofRequest = fetch('/proof-status', { cache: 'no-store', credentials: 'same-origin' })
    .then(async (response) => {
      if (!response.ok && response.status !== 503) throw new Error('proof_unavailable');
      proofState = reduceProofState(proofState, { type: 'snapshot', source: 'refresh', value: await response.json() });
    })
    .catch(() => { proofState = reduceProofState(proofState, { type: 'error' }); })
    .finally(() => { proofRequest = undefined; render(); });
  return proofRequest;
}
async function runSoundProofPing(): Promise<void> {
  if (proofRequest || runnerConfig?.role !== 'A' || proofState.mode !== 'ready' || proofState.needsRefresh) return;
  proofState = reduceProofState(proofState, { type: 'running' }); render();
  proofRequest = fetch('/proof-ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' })
    .then(async (response) => {
      if (!response.ok) throw new Error('proof_unavailable');
      proofState = reduceProofState(proofState, { type: 'snapshot', source: 'ping', value: await response.json() });
    })
    .catch(() => { proofState = reduceProofState(proofState, { type: 'error' }); })
    .finally(() => { proofRequest = undefined; render(); });
  return proofRequest;
}

async function sendDemoImage(): Promise<void> {
  if (runnerConfig?.role !== 'A' || proofState.mode !== 'ready' || proofState.needsRefresh || imageTransferSending) return;
  imageTransferSending = true; imageTransferMessage = 'Preparing fixed FIPS image…'; render();
  try {
    const rgba = await demoImageRaster();
    const body = new ArrayBuffer(8 + rgba.byteLength);
    const view = new DataView(body);
    view.setUint16(0, DEMO_IMAGE_WIDTH, true); view.setUint16(2, DEMO_IMAGE_HEIGHT, true);
    new Uint8Array(body, 8).set(rgba);
    imageTransferMessage = 'Sending image bands through FIPS…'; render();
    const response = await fetch('/image-transfer', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body, credentials: 'same-origin' });
    if (!response.ok) throw new Error('image_transfer_failed');
    const result = await response.json() as { bands?: unknown };
    imageTransferMessage = `Image queued over FIPS · ${typeof result.bands === 'number' ? result.bands : '?'} bands`;
  } catch {
    imageTransferMessage = 'Image transfer failed — verify the current FIPS link and retry';
  } finally { imageTransferSending = false; render(); }
}

async function refreshImageTransfer(): Promise<void> {
  if (runnerConfig?.role !== 'B') return;
  try {
    const response = await fetch('/image-transfer', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return;
    const next = await response.json() as ImageTransferSnapshot;
    if (next.revision !== imageTransfer.revision) {
      imageTransfer = next;
      imageTransferMessage = next.complete ? 'Image received over FIPS' : `Loading over FIPS · ${next.receivedRows}/${next.height} rows`;
      render();
    }
  } catch { /* The normal link status remains the recovery authority. */ }
}

function paintReceivedImage(canvas: HTMLCanvasElement): void {
  if (!imageTransfer.width || !imageTransfer.height) return;
  canvas.width = imageTransfer.width; canvas.height = imageTransfer.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#071018'; context.fillRect(0, 0, canvas.width, canvas.height);
  for (const band of imageTransfer.bands) {
    const bytes = decodeBand(band.rgbaBase64);
    context.putImageData(new ImageData(bytes, imageTransfer.width, band.rows), 0, band.y);
  }
}

type DemoStage = Readonly<{ label: string; explanation: string; tone: 'idle' | 'working' | 'ready' | 'warning' | 'error' }>;
function demoStage(): DemoStage {
  if (resetFailure || uiState === 'failed') return { label: 'Error', explanation: 'Check the microphone or browser permission, then reset this node.', tone: 'error' };
  if (uiState === 'disconnected') return { label: 'Disconnected', explanation: 'The local bridge stopped. Reset to start a clean acoustic session.', tone: 'error' };
  if (uiState === 'idle') return { label: 'Idle', explanation: 'Start this node to listen for its peer through sound.', tone: 'idle' };
  if (uiState === 'requesting') return { label: 'Starting', explanation: 'Opening microphone access and the local FIPS sound bridge.', tone: 'working' };
  const state = acousticSession?.snapshot.state;
  const stages: Partial<Record<NonNullable<typeof state>, DemoStage>> = {
    Listening: { label: 'Discovering peer', explanation: 'Searching for the other computer through sound.', tone: 'working' },
    HelloSent: { label: 'Handshake', explanation: 'Exchanging identity and protocol compatibility.', tone: 'working' },
    HelloAckSent: { label: 'Handshake', explanation: 'Confirming the peer and establishing a new session.', tone: 'working' },
    CapsSent: { label: 'Negotiating', explanation: 'Comparing supported acoustic modem settings.', tone: 'working' },
    CalibratingAToB: { label: 'Calibrating A → B', explanation: 'Testing which acoustic settings survive the room.', tone: 'working' },
    CalibratingBToA: { label: 'Calibrating B → A', explanation: 'Testing the return acoustic direction.', tone: 'working' },
    Committing: { label: 'Committing settings', explanation: 'Both computers are agreeing on one modem configuration.', tone: 'working' },
    AwaitingHeartbeat: { label: 'Connecting FIPS', explanation: 'Waiting for the first authenticated acoustic heartbeat.', tone: 'working' },
    Ready: proofState.mode === 'ready' && !proofState.needsRefresh
      ? { label: 'Connected', explanation: 'The authenticated FIPS sound link is ready for packets.', tone: 'ready' }
      : { label: 'Sound link established', explanation: 'Acoustic heartbeats are active. Verifying the authenticated FIPS peer before claiming packet transit.', tone: 'working' },
    Degraded: { label: 'Degraded', explanation: 'The acoustic link needs recovery or recalibration.', tone: 'warning' },
    Recovering: { label: 'Recalibrating', explanation: 'Recovering the sound link with bounded retries.', tone: 'warning' },
    Error: { label: 'Error', explanation: `Acoustic negotiation stopped: ${acousticSession?.snapshot.reason ?? (failure || 'unknown reason')}.`, tone: 'error' },
  };
  return stages[state ?? 'Idle'] ?? { label: 'Starting', explanation: 'Preparing the local acoustic modem.', tone: 'working' };
}

function demoStatus(value: string, active = false): HTMLParagraphElement {
  const result = element('p', value);
  result.className = `demo-status${active ? ' is-active' : ''}`;
  return result;
}

async function startDemo(): Promise<void> {
  if (uiState === 'idle') resetDemoStageTimings();
  if (uiState === 'idle') await arm();
  // The production runner's acoustic projection is the fixed demo authority:
  // enter the already-qualified audible Quiet path immediately instead of
  // putting an audience run behind the 90-minute Cyrinx qualification gate.
  // Debug mode retains the full qualification workflow and evidence controls.
  if (uiState === 'ready' && runnerConfig?.acoustic) await startQuietFallback();
  else if (uiState === 'ready' && developmentDiagnostic && cyrinxSession.canRequestStart) startQualification();
}

/** The normal audience surface intentionally projects only scalar, truthful status. */
function renderDemo(): void {
  appRoot.replaceChildren();
  const role = runnerConfig?.role;
  const node = role ? `Node ${role}` : 'Preparing node';
  const peerRoleLabel = role ? `Node ${peerRole(role)}` : 'Peer node';
  const stage = demoStage();
  const stageTiming = syncDemoStageTiming(stage.label);
  const acoustic = acousticSession ? projectAcousticStatus(acousticSession.snapshot, runnerConfig?.evidenceClass ?? 'Fixture', acousticTx, acousticRx) : undefined;
  const proofReady = proofState.mode === 'ready' && !proofState.needsRefresh;
  const profile = acousticSession?.snapshot.settings?.aToB.profileId ?? runnerConfig?.acoustic?.profiles[0] ?? 'Bootstrap profile pending';
  const identity = runnerConfig?.machineId ?? 'Loading local identity…';
  const acousticSnapshot = acousticSession?.snapshot;
  const calibrationDirection = acousticSnapshot?.state === 'CalibratingAToB' ? 'AtoB' : acousticSnapshot?.state === 'CalibratingBToA' ? 'BtoA' : undefined;
  const calibrationLabel = calibrationDirection === 'AtoB' ? 'A → B' : calibrationDirection === 'BtoA' ? 'B → A' : undefined;
  const probesPerDirection = runnerConfig?.acoustic?.calibration.probesPerDirection ?? 1;
  const candidates = runnerConfig?.acoustic?.candidates ?? [];
  const calibrationTotal = candidates.length * probesPerDirection;
  const calibrationEntries = calibrationDirection ? acousticSnapshot?.ledger.filter((entry) => entry.direction === calibrationDirection) ?? [] : [];
  const calibrationProgress = Math.min(calibrationEntries.length, calibrationTotal);
  const candidateIndex = Math.min(Math.floor(calibrationProgress / probesPerDirection), Math.max(0, candidates.length - 1));
  const activeCandidate = candidates[candidateIndex];
  const lastProbe = calibrationEntries.at(-1);
  const localIsTransmitting = Boolean(calibrationDirection && acousticSnapshot?.turnOwner === role);

  const shell = element('main'); shell.className = 'demo-shell'; shell.dataset.testid = 'demo-dashboard';
  const top = element('header'); top.className = 'demo-topbar';
  const identityBlock = element('div');
  identityBlock.append(element('p', 'FIPS over Sound'), element('h1', node));
  const identityMeta = element('p', role ? `${roleDescription(role)} · ${identity}` : identity);
  identityMeta.className = 'demo-role';
  if (runnerConfig) {
    identityMeta.dataset.testid = 'runner-identity';
    identityMeta.dataset.machineId = runnerConfig.machineId;
    identityMeta.dataset.role = runnerConfig.role;
    identityMeta.dataset.evidenceClass = runnerConfig.evidenceClass;
  }
  identityBlock.append(identityMeta); top.append(identityBlock);
  const topActions = element('div'); topActions.className = 'demo-top-actions';
  const debug = control('Debug', () => { debugMode = true; render(); }, false, 'secondary'); debug.setAttribute('aria-label', 'Open Debug mode'); topActions.append(debug);
  top.append(topActions); shell.append(top);

  const primary = element('section'); primary.className = `demo-primary tone-${stage.tone}`; primary.setAttribute('aria-labelledby', 'demo-stage');
  const stageHeader = element('div'); stageHeader.className = 'demo-stage-header';
  const stageTitle = element('p', 'Current stage'); stageTitle.className = 'eyebrow';
  const stageTimer = element('p', `Elapsed ${formatDemoDuration(stageTiming.elapsedMs)}`); stageTimer.className = 'demo-stage-timer'; stageTimer.dataset.testid = 'stage-timer';
  stageHeader.append(stageTitle, stageTimer); primary.append(stageHeader);
  const stageName = element('h2', stage.label); stageName.id = 'demo-stage'; primary.append(stageName, element('p', stage.explanation));
  if (acoustic?.ready) {
    const packetHero = element('div'); packetHero.className = 'demo-packet-hero'; packetHero.dataset.testid = 'fips-packet-hero';
    const packetLabel = element('p', 'FIPS packets'); packetLabel.className = 'demo-packet-label';
    const packetValues = element('div'); packetValues.className = 'demo-packet-values';
    const tx = element('div'); tx.append(element('span', 'TX'), element('strong', String(acoustic.txPackets)));
    const rx = element('div'); rx.append(element('span', 'RX'), element('strong', String(acoustic.rxPackets)));
    packetValues.append(tx, rx); packetHero.append(packetLabel, packetValues); primary.append(packetHero);
  }
  const stageState = demoStatus(`Status: ${stage.label}`, stage.tone === 'working'); stageState.setAttribute('role', stage.tone === 'error' ? 'alert' : 'status'); stageState.setAttribute('aria-live', stage.tone === 'error' ? 'assertive' : 'polite'); primary.append(stageState);
  shell.append(primary);

  const grid = element('div'); grid.className = 'demo-grid';
  const peer = element('section'); peer.className = 'demo-card'; peer.append(element('h2', 'Peer link'));
  peer.append(demoStatus(`${peerRoleLabel} · ${role ? (role === 'A' ? 'acoustically isolated peer' : 'Wi-Fi gateway peer') : 'waiting for role'}`));
  if (runnerConfig?.fipsNetwork) {
    const reveal = control(fipsDetailsRevealed ? 'Hide FIPS details' : 'Reveal FIPS details', () => { fipsDetailsRevealed = !fipsDetailsRevealed; render(); }, false, 'secondary');
    reveal.setAttribute('aria-expanded', String(fipsDetailsRevealed));
    const network = element('div'); network.className = `demo-network-details${fipsDetailsRevealed ? '' : ' is-concealed'}`;
    network.setAttribute('aria-hidden', String(!fipsDetailsRevealed));
    network.append(demoStatus(`Peer npub: ${runnerConfig.fipsNetwork.peerPublicKey}`), demoStatus(`Peer IPv6: ${runnerConfig.fipsNetwork.peerIpv6}`));
    peer.append(reveal, network);
  }
  peer.append(demoStatus(`Acoustic: ${acoustic?.ready ? 'Connected — committed and heartbeating' : acoustic ? `${acoustic.phase} — not yet ready` : 'Not started'}`, Boolean(acoustic && !acoustic.ready && stage.tone === 'working')));
  peer.append(demoStatus(`FIPS: ${proofReady ? 'Authenticated Sound peer verified' : acoustic?.ready && browserPacketReady && bridgeState?.soundTransport === 'started' ? 'Readiness sent to local adapter — peer proof pending' : 'Waiting for acoustic readiness'}`));
  grid.append(peer);

  const activity = element('section'); activity.className = 'demo-card demo-activity';
  if (calibrationDirection && calibrationLabel) {
    activity.append(element('h2', 'Live calibration'));
    const signal = element('div'); signal.className = `demo-signal ${localIsTransmitting ? 'is-transmitting' : 'is-listening'}`;
    for (let index = 0; index < 7; index += 1) signal.append(element('span'));
    signal.setAttribute('aria-hidden', 'true'); activity.append(signal);
    activity.append(demoStatus(localIsTransmitting ? `Broadcasting ${calibrationLabel} test tone` : `Listening for ${calibrationLabel} test tone`, true));
    const progress = document.createElement('progress'); progress.max = Math.max(1, calibrationTotal); progress.value = calibrationProgress; progress.setAttribute('aria-label', `${calibrationLabel} calibration progress`); activity.append(progress);
    activity.append(demoStatus(`Probe ${Math.min(calibrationProgress + 1, Math.max(1, calibrationTotal))} / ${Math.max(1, calibrationTotal)} · candidate ${Math.min(candidateIndex + 1, Math.max(1, candidates.length))} / ${Math.max(1, candidates.length)}`));
    if (activeCandidate) activity.append(demoStatus(`${activeCandidate.id} · ${activeCandidate.payloadBytes} B · gain ${activeCandidate.playbackGain}× · guard ${activeCandidate.guardMs} ms`));
    activity.append(demoStatus(lastProbe ? `Last observation: ${lastProbe.observation.bytePerfect && lastProbe.observation.received ? 'byte-perfect ✓' : 'rejected'} · confidence ${Math.round(lastProbe.observation.confidence * 100)}%` : 'Last observation: waiting for first decoded probe'));
  } else if (!acoustic?.ready) {
    activity.append(element('h2', 'Protocol activity'));
    const signal = element('div'); signal.className = 'demo-signal is-listening';
    for (let index = 0; index < 7; index += 1) signal.append(element('span'));
    signal.setAttribute('aria-hidden', 'true'); activity.append(signal);
    activity.append(demoStatus(`Handshake state: ${acousticSnapshot?.state ?? 'Starting'}`, stage.tone === 'working'));
    activity.append(demoStatus(`Profile offer: ${profile}`));
    activity.append(demoStatus(acousticSnapshot?.reason ? `Reason: ${acousticSnapshot.reason}` : 'Waiting for the next authenticated acoustic message'));
  } else {
    activity.append(element('h2', 'Live link'));
    activity.append(demoStatus(`Profile: ${profile}`));
    const directionSettings = role === 'A' ? acousticSnapshot?.settings?.aToB : acousticSnapshot?.settings?.bToA;
    if (directionSettings) activity.append(demoStatus(`Modem: ${directionSettings.payloadBytes} B · gain ${directionSettings.playbackGain}× · guard ${directionSettings.guardMs} ms`));
    const turn = acousticSnapshot?.turnOwner === role ? 'Broadcasting from this node' : `Listening to Node ${acousticSnapshot?.turnOwner ?? peerRole(role!)}`;
    activity.append(demoStatus(`Turn: ${turn}`, true));
    activity.append(demoStatus(`Heartbeat: ${acoustic.currentHeartbeat ? `Current · ${new Date(acousticSnapshot?.lastHeartbeatAtMs ?? 0).toLocaleTimeString()}` : 'Waiting'}`, Boolean(acoustic.currentHeartbeat)));
    activity.append(demoStatus(`Acoustic frames TX / RX: ${acousticFramesTx} / ${acousticFramesRx}`));
    activity.append(demoStatus(`FIPS packets TX / RX: ${acoustic.txPackets} / ${acoustic.rxPackets}`));
    activity.append(demoStatus(`Retries / loss: ${acoustic.retries} / ${acoustic.dropped}`));
    activity.append(demoStatus(`FIPS proof: ${proofState.mode === 'ready' ? 'Ready' : proofState.message}`));
  }
  const stageLog = element('div'); stageLog.className = 'demo-stage-log'; stageLog.append(element('h3', 'Stage log'));
  if (stageTiming.completed.length === 0) stageLog.append(demoStatus('Waiting for the first completed stage'));
  else for (const entry of stageTiming.completed.slice(-4)) stageLog.append(demoStatus(`${entry.label} · ${formatDemoDuration(entry.durationMs)}`));
  activity.append(stageLog);
  grid.append(activity);

  if (proofReady || imageTransfer.transferId) {
    const imageCard = element('section'); imageCard.className = 'demo-card demo-image-transfer'; imageCard.dataset.testid = 'image-transfer';
    imageCard.append(element('h2', 'Image over FIPS'));
    if (role === 'A') {
      const preview = document.createElement('img'); preview.src = DEMO_IMAGE_DATA_URL; preview.alt = 'FIPS network banner'; preview.dataset.testid = 'image-sender-preview';
      imageCard.append(preview, demoStatus('Full image · local source'));
      const sendImage = control('Send image over FIPS', sendDemoImage, imageTransferSending);
      if (imageTransferSending) sendImage.setAttribute('aria-busy', 'true');
      imageCard.append(sendImage, demoStatus(imageTransferMessage, imageTransferSending));
    } else {
      const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'FIPS image progressively received over the sound link'); canvas.dataset.testid = 'image-receiver-canvas';
      paintReceivedImage(canvas);
      imageCard.append(canvas, demoStatus(imageTransfer.transferId ? imageTransferMessage : 'Waiting for Node A to send the image', Boolean(imageTransfer.transferId && !imageTransfer.complete)));
      const progress = document.createElement('progress'); progress.max = Math.max(1, imageTransfer.height); progress.value = imageTransfer.receivedRows; progress.setAttribute('aria-label', 'Image transfer progress'); imageCard.append(progress);
    }
    grid.append(imageCard);
  }

  const next = element('section'); next.className = 'demo-card demo-next';
  const nextCopyBlock = element('div'); nextCopyBlock.className = 'demo-next-copy'; nextCopyBlock.append(element('h2', 'Next action'));
  const nextCopy = resetFailure ? `Reset needed: ${resetFailure}` : stage.explanation;
  nextCopyBlock.append(element('p', nextCopy));
  const nextActions = element('div'); nextActions.className = 'demo-next-actions';
  const resetInFlight = bridgeState?.status === 'resetting';
  const unavailable = Boolean(configFailure) && !developmentDiagnostic;
  if (uiState === 'idle' && !unavailable) nextActions.append(control('Start / Connect', startDemo, !runnerConfig && !developmentDiagnostic));
  if (acoustic && !acoustic.ready && uiState === 'ready' && !resetInFlight) nextActions.append(control('Recalibrate', reset, false, 'secondary'));
  const proofRefresh = control('Refresh proof status', refreshProofStatus, Boolean(proofRequest), 'secondary');
  nextActions.append(proofRefresh);
  if (role === 'A') {
    const ping = control('Run sound-only ping', runSoundProofPing, proofState.mode !== 'ready' || proofState.needsRefresh || Boolean(proofRequest));
    if (proofState.mode === 'running') ping.setAttribute('aria-busy', 'true');
    nextActions.append(ping);
  } else if (role === 'B') nextCopyBlock.append(element('p', 'Role B is isolated; the proof ping is issued from Role A.'));
  if (uiState !== 'requesting') nextActions.append(control('Reset', reset, resetInFlight, 'secondary'));
  next.append(nextCopyBlock, nextActions);
  grid.append(next); shell.append(grid);

  const footer = element('footer'); footer.className = 'demo-footer';
  footer.append(element('span', `Evidence: ${runnerConfig?.evidenceClass ?? 'Unknown'} — local status never proves an over-air peer by itself.`));
  const lastActivity = bridgeState?.lastEventAt && Date.parse(bridgeState.lastEventAt) > 0 ? bridgeState.lastEventAt : 'No FIPS bridge packet yet';
  footer.append(element('span', `Last activity: ${lastActivity}`));
  shell.append(footer); appRoot.append(shell);
}

function render(): void {
  appRoot.classList.toggle('demo-app', !debugMode);
  if (!debugMode) { renderDemo(); return; }
  appRoot.replaceChildren();
  const header = element('header');
  header.append(element('h1', 'Sound-only FIPS proof'));
  const demoView = control('Demo view', () => { debugMode = false; render(); }, false, 'secondary');
  demoView.setAttribute('aria-label', 'Return to demo view');
  header.append(demoView);
  const meta = element('p', runnerConfig
    ? `Machine: ${runnerConfig.machineId} · Role: ${runnerConfig.role} (${roleDescription(runnerConfig.role)}) · Evidence: ${runnerConfig.evidenceClass} · Chromium: ${navigator.userAgent} · Local epoch: ${epoch}`
    : 'Runner configuration pending');
  meta.className = 'measurements';
  if (runnerConfig) {
    meta.dataset.testid = 'runner-identity';
    meta.dataset.machineId = runnerConfig.machineId;
    meta.dataset.role = runnerConfig.role;
    meta.dataset.evidenceClass = runnerConfig.evidenceClass;
  }
  header.append(meta);
  const badge = element('p', `● ${labels[uiState]} · ${localBridgeCopy(bridgeState)}`);
  badge.className = `status status-${uiState}`;
  badge.setAttribute('role', uiState === 'failed' || uiState === 'disconnected' ? 'alert' : 'status');
  badge.setAttribute('aria-live', uiState === 'failed' || uiState === 'disconnected' ? 'assertive' : 'polite');
  header.append(badge);
  appRoot.append(header);

  const grid = element('div');
  grid.className = 'console-grid';
  const operator = element('section');
  operator.className = 'card operator-card';
  operator.append(element('h2', 'Operator control'));
  if (uiState === 'idle') operator.append(element('h3', 'Modem is not armed'));
  const announcement = element('p', resetFailure
    ? `Reset and reconnect failed: ${resetFailure}.`
    : uiState === 'failed'
      ? `Audio preflight failed: ${safeUiReason(failure, 'browser audio unavailable')}. Check the device or browser permission, then reset and reconnect.`
      : bodyCopy[uiState]);
  announcement.id = 'audio-status';
  announcement.setAttribute('aria-live', uiState === 'failed' || uiState === 'disconnected' ? 'assertive' : 'polite');
  operator.append(announcement);
  if (configFailure) operator.append(element('p', `Runner configuration failed: ${configFailure}`));
  operator.append(element('p', `Report target: ${runnerConfig?.reportTarget ?? 'Unknown'} · TUN mode: ${runnerConfig?.tunEvidence ?? 'Unknown'}`));
  const bridgeDeliveryStatus = element('p', `Bridge delivery: ${bridgeDelivery}`);
  bridgeDeliveryStatus.dataset.testid = 'bridge-delivery';
  if (uiState === 'ready' && evidence) bridgeDeliveryStatus.dataset.audioSettingsAcceptedEpoch = String(epoch);
  operator.append(bridgeDeliveryStatus);
  operator.append(element('p', quietRuntime));
  const resetInFlight = bridgeState?.status === 'resetting';
  const bridgeNeedsRecovery = bridgeState?.status === 'disconnected' || bridgeState?.status === 'overflow' || bridgeState?.status === 'rejected';
  const configurationUnavailable = Boolean(configFailure) && !developmentDiagnostic;
  if (uiState === 'idle' && !configurationUnavailable) operator.append(control('Arm modem', arm, !runnerConfig && !developmentDiagnostic));
  if (uiState === 'requesting' && !resetInFlight) operator.append(control('Arm modem', arm, true));
  const resetLabel = 'Reset and reconnect';
  if (resetInFlight) {
    const resetControl = control(resetLabel, reset, true, 'secondary');
    resetControl.setAttribute('aria-busy', 'true');
    operator.append(resetControl);
  }
  if (uiState === 'ready' && !resetInFlight) {
    if (!bridgeNeedsRecovery && cyrinxSession.canRequestStart) operator.append(control('Start Cyrinx qualification', startQualification));
    if (!bridgeNeedsRecovery && quietCorpusSendState === 'ready' && runnerConfig && cyrinxSession.snapshot.codec === 'quiet') {
      operator.append(control(`Send Quiet ${directionForRole(runnerConfig.role)} corpus`, sendQuietCorpus));
    }
    operator.append(control(resetLabel, reset, false, 'secondary'));
  }
  if (!resetInFlight && (uiState === 'failed' || uiState === 'disconnected')) operator.append(control(resetLabel, reset, false, 'secondary'));
  if (runnerConfig && uiState === 'idle') operator.append(control(resetLabel, reset, false, 'secondary'));
  const proofRefresh = control('Refresh proof status', refreshProofStatus, Boolean(proofRequest), 'secondary');
  operator.append(proofRefresh);
  if (runnerConfig?.role === 'A') {
    const runPing = control('Run sound-only ping', runSoundProofPing, proofState.mode !== 'ready' || proofState.needsRefresh || Boolean(proofRequest));
    if (proofState.mode === 'running') runPing.setAttribute('aria-busy', 'true');
    operator.append(runPing);
    operator.append(element('p', proofState.mode === 'ready' ? 'Runs one kernel ICMPv6 ping to the isolated Role B address.' : `Ping is blocked — ${proofState.message}`));
  } else if (runnerConfig?.role === 'B') operator.append(element('p', 'Role B is the acoustically isolated node. The proof ping is issued from Role A.'));
  operator.append(element('p', 'Starts a new local epoch and clears unsent local bridge data.'));
  grid.append(operator);

  const bridgeCard = element('section');
  bridgeCard.className = 'card bridge-card';
  bridgeCard.append(element('h2', 'Bridge and FIPS transport'));
  const bridgeStatus = bridgeState;
  const bridgeList = element('dl');
  const bridgeRows: [string, string][] = [
    ['Configuration', configFailure ? 'Configuration unavailable' : runnerConfig ? 'Ready' : 'Loading local configuration…'],
    ['Browser audio', bridgeStatus?.browserAudio === 'armed' ? 'Armed' : bridgeStatus?.browserAudio === 'not-armed' ? 'Not armed' : 'Unknown'],
    ['Local bridge', localBridgeCopy(bridgeStatus)],
    ['FIPS sound transport', bridgeStatus?.soundTransport === 'started' ? 'Started' : bridgeStatus ? 'Waiting for transport' : 'Unknown'],
    ['Epoch', bridgeStatus ? String(bridgeStatus.epoch) : 'Unknown'],
    ['Queue health', bridgeStatus ? `${bridgeStatus.queueHealth[0]!.toUpperCase()}${bridgeStatus.queueHealth.slice(1)} · ${bridgeStatus.queueItems} items · ${bridgeStatus.queueBytes} bytes` : 'Unknown'],
    ['Last accepted/error', bridgeStatus?.lastError ? `${bridgeStatus.lastError} · ${bridgeStatus.lastEventAt ?? 'timestamp unavailable'}` : bridgeStatus?.lastEventAt ?? 'Unknown'],
    ['Complete packets TX/RX', completePacketCopy(bridgeStatus)],
    ['Sound MTU', bridgeStatus?.soundMtu ? `Sound MTU: ${bridgeStatus.soundMtu} bytes · effective IPv6 MTU: ${bridgeStatus.soundMtu - 77} bytes` : 'Unknown'],
  ];
  bridgeRows.forEach(([label, value]) => bridgeList.append(element('dt', label), element('dd', value)));
  bridgeCard.append(bridgeList);
  if (!bridgeStatus || bridgeStatus.txPackets + bridgeStatus.rxPackets === 0) {
    bridgeCard.append(element('h3', 'No local bridge activity yet'));
    bridgeCard.append(element('p', 'Arm the modem to request microphone access and establish this laptop’s local binary bridge.'));
  }
  const bridgeAnnouncement = element('p', resetFailure
    ? `Reset and reconnect failed: ${resetFailure}.`
    : bridgeStatus?.status === 'resetting'
      ? 'Resetting local session…'
      : bridgeStatus?.status === 'overflow'
        ? 'Bridge queue limit reached; the frame was rejected. Reset and reconnect before continuing.'
        : bridgeStatus?.status === 'rejected'
          ? 'Bridge rejected an invalid frame. Reset and reconnect before continuing.'
          : bridgeStatus?.status === 'disconnected'
            ? 'Local bridge disconnected. Reset and reconnect to start a new local session.'
            : uiState === 'requesting'
              ? 'Requesting microphone and connecting local bridge…'
              : 'Local state only; acoustic peer and ping readiness are not claimed.');
  bridgeAnnouncement.setAttribute('aria-live', failure ? 'assertive' : 'polite');
  if (uiState === 'requesting' || bridgeStatus?.status === 'resetting') bridgeAnnouncement.setAttribute('aria-busy', 'true');
  bridgeCard.append(bridgeAnnouncement);
  grid.append(bridgeCard);

  const proofCard = element('section'); proofCard.className = `card proof-card proof-${proofState.mode}`;
  proofCard.append(element('h2', 'FIPS proof status'));
  const proofList = element('dl'); const proof = proofState.snapshot;
  const proofRows: [string, string][] = [
    ['Proof status', proofState.mode === 'ready' ? 'Ready' : proofState.mode === 'loading' ? 'Waiting for current proof facts…' : proofState.mode],
    ['Evidence class', proof?.evidenceClass ?? 'Waiting for a current snapshot'],
    ['Authenticated peer', proof?.peer.verified ? `Verified — ${proof.peer.identity}` : 'Waiting for authenticated Sound peer'],
    ['Active Sound link', proof?.link.verified ? `Verified — link ${proof.link.id}` : 'Waiting for active Sound link'],
    ['Role B isolation', proof?.isolationVerified ? 'Verified — Sound is the only usable Role B FIPS transport' : 'Waiting for paired Role B isolation proof'],
    ['Acoustic session', proof?.transport.verified && proof.transport.epoch !== null ? `Ready — epoch ${proof.transport.epoch}` : 'Disarmed — current acoustic session is not ready'],
    ['Bridge packet counters', `Complete packets TX/RX: ${proofValue(proof?.counters.completeTx)}/${proofValue(proof?.counters.completeRx)}`],
    ['Acoustic counters', `Acoustic TX/RX: ${proofValue(proof?.counters.acousticTx)}/${proofValue(proof?.counters.acousticRx)} · fragments: ${proofValue(proof?.counters.fragmentsTx)}/${proofValue(proof?.counters.fragmentsRx)} · integrity failures: ${proofValue(proof?.counters.integrityFailures)} · retries: ${proofValue(proof?.counters.retries)}`],
    ['Ping readiness', proofState.mode === 'ready' && !proofState.needsRefresh ? 'Ready — all current proof gates agree' : proofState.message],
  ];
  proofRows.forEach(([label, value]) => proofList.append(element('dt', label), element('dd', value))); proofCard.append(proofList);
  const proofMessage = element('p', proofState.message); proofMessage.className = 'proof-message'; proofMessage.setAttribute('role', proofState.mode === 'failed' || proofState.mode === 'error' ? 'alert' : 'status'); proofMessage.setAttribute('aria-live', proofState.mode === 'failed' || proofState.mode === 'error' ? 'assertive' : 'polite'); proofCard.append(proofMessage);
  if (proofState.outcome) {
    proofCard.append(element('h3', 'Ping outcome'));
    const outcome = element('dl'); const result = proofState.outcome;
    [['Command authority', 'Role A FIPS namespace · system ping -6'], ['Result', result.exitCode === 0 ? 'Reply received' : result.exitCode === 1 ? 'No reply received' : 'Ping command error'], ['ICMPv6 evidence', result.sequence !== null && result.latencyMs !== null && result.lossPercent !== null ? `Sequence ${result.sequence} · ${result.latencyMs} ms · ${result.lossPercent}% packet loss` : 'Bounded ping output did not include a complete summary.'], ['Evidence disposition', proofState.message]].forEach(([label, value]) => outcome.append(element('dt', label), element('dd', value))); proofCard.append(outcome);
  } else { proofCard.append(element('h3', 'No ping has run in this epoch'), element('p', 'Refresh proof status, then run the sound-only ping from Role A when every current proof gate is ready.')); }
  grid.append(proofCard);

  const acousticCard = element('section');
  acousticCard.className = 'card';
  acousticCard.append(element('h2', 'Acoustic session'));
  const acoustic = acousticSession ? projectAcousticStatus(acousticSession.snapshot, runnerConfig?.evidenceClass ?? 'Fixture', acousticTx, acousticRx) : undefined;
  if (!acoustic) acousticCard.append(element('p', 'Not started — microphone preflight does not claim an acoustic peer or FIPS readiness.'));
  else {
    acousticCard.append(element('p', `${acoustic.phase} · evidence: ${acoustic.evidenceClass} · FIPS ${acoustic.ready ? 'ready' : 'disarmed'}`));
    acousticCard.append(element('p', `Commit acknowledgement: ${acoustic.commitAcknowledged ? 'yes' : 'no'} · current heartbeat: ${acoustic.currentHeartbeat ? 'yes' : 'no'} · packets TX/RX: ${acoustic.txPackets}/${acoustic.rxPackets}`));
    if (acoustic.reason) acousticCard.append(element('p', `Safe reason: ${acoustic.reason}`));
  }
  grid.append(acousticCard);

  const evidenceCard = element('section');
  evidenceCard.className = 'card';
  evidenceCard.append(element('h2', 'Applied audio evidence'));
  evidenceCard.append(element('p', 'Required: observed 1/2-channel 44.1/48 kHz input · Web Audio codec PCM downmixed to mono at 48 kHz · echo cancellation off · noise suppression off · auto gain control off.'));
  const table = element('table');
  table.append(element('caption', 'Actual browser and bridge observations'));
  appendSetting(table, 'Microphone label', quiet.applied?.microphoneLabel ?? evidence?.microphoneLabel);
  appendSetting(table, 'Permission', quiet.applied ? 'granted' : evidence?.permission);
  appendSetting(table, 'Audio-context state', quiet.applied?.contextState ?? evidence?.contextState);
  appendSetting(table, 'Web Audio context sample rate', quiet.applied?.contextSampleRate ?? evidence?.contextSampleRate);
  appendSetting(table, 'Input-device sample rate', quiet.applied?.inputDeviceSampleRate ?? evidence?.inputDeviceSampleRate);
  appendSetting(table, 'Codec capture PCM sample rate', quiet.applied?.captureSampleRate ?? evidence?.captureSampleRate);
  appendSetting(table, 'Input-device channels', quiet.applied?.inputDeviceChannels ?? evidence?.inputDeviceChannels);
  appendSetting(table, 'Codec capture PCM channels', quiet.applied?.captureChannels ?? evidence?.captureChannels);
  appendSetting(table, 'Echo cancellation', quiet.applied?.echoCancellation ?? evidence?.echoCancellation);
  appendSetting(table, 'Noise suppression', quiet.applied?.noiseSuppression ?? evidence?.noiseSuppression);
  appendSetting(table, 'Automatic gain control', quiet.applied?.autoGainControl ?? evidence?.autoGainControl);
  appendSetting(table, 'AudioWorklet status', evidence?.workletState);
  appendSetting(table, 'Bridge endpoint', quiet.applied || evidence ? 'localhost only' : undefined);
  evidenceCard.append(table);
  grid.append(evidenceCard);
  appRoot.append(grid);

  const gate = element('section'); gate.className = 'card qualification-gate';
  gate.append(element('h2', 'Cyrinx qualification gate'));
  const checklist = element('ol');
  ['Cyrinx build and golden vectors', '256 B and 1536 B fixture round trips', 'Browser PCM bridge loopback', 'Cold acquisition: A → B', 'Cold acquisition: B → A', 'Gate decision'].forEach((step) => checklist.append(element('li', step)));
  gate.append(checklist);
  if (gateState === 'not-started') gate.append(element('p', 'Cyrinx qualification has not started. Fixture results do not qualify the physical sound path.'));
  else {
    gate.append(element('p', 'Cyrinx qualification is in progress.'));
    const countdown = element('p', 'Cyrinx gate closes in 1:30:00'); countdown.className = 'countdown'; countdown.setAttribute('aria-live', 'assertive'); gate.append(countdown);
    gate.append(element('p', 'This deadline is immutable. Any hard failure or expiry immediately routes to the audible Quiet fallback.'));
  }
  appRoot.append(gate);

  const corpus = element('section'); corpus.className = 'card corpus-card'; corpus.append(element('h2', 'Corpus evidence'));
  corpus.append(element('p', 'Unique 256 B and 1536 B cases are keyed by epoch, literal direction, and case ID.'));
  const filter = element('input') as HTMLInputElement; filter.type = 'search'; filter.placeholder = 'Filter corpus cases'; filter.setAttribute('aria-label', 'Filter corpus cases'); corpus.append(filter);
  corpus.append(control('Sort newest first', () => { corpusRows = [...corpusRows].reverse(); render(); }, false, 'secondary'));
  if (!corpusRows.length) corpus.append(element('p', 'No corpus results have been recorded for this epoch.'));
  else {
    const table = element('table'); table.setAttribute('aria-label', 'Qualification corpus evidence');
    const caption = element('caption', 'Qualification corpus evidence'); table.append(caption);
    const head = element('thead'); const headRow = element('tr'); ['Direction', 'Case', 'Evidence', 'Result', 'Airtime'].forEach((label) => { const cell = element('th', label); cell.scope = 'col'; headRow.append(cell); }); head.append(headRow); table.append(head);
    const body = element('tbody');
    corpusRows.filter((row) => row.caseId.toLowerCase().includes(filter.value.toLowerCase())).forEach((row) => { const tr = element('tr'); [row.direction, row.caseId, row.evidenceClass, row.result, row.airtime].forEach((value) => tr.append(element('td', value))); body.append(tr); });
    table.append(body); corpus.append(table, element('p', 'Fixture evidence is diagnostic only and cannot select a codec.'));
  }
  appRoot.append(corpus);

  const docker = element('section'); docker.className = 'card'; docker.append(element('h2', 'Docker and TUN projection'));
  const dockerList = element('dl');
  [['Bridge binding', '127.0.0.1 only'], ['Device', '/dev/net/tun pending host preflight'], ['Capabilities', 'NET_ADMIN only; no privileged mode; no SYS_ADMIN'], ['Evidence', 'Missing — run deterministic Compose preflight on each laptop']].forEach(([label, value]) => { dockerList.append(element('dt', label), element('dd', value)); });
  docker.append(dockerList); appRoot.append(docker);

  const decision = element('section'); decision.className = 'card'; decision.append(element('h2', 'Decision and report'));
  decision.append(element('p', corpusRows.some((row) => row.evidenceClass === 'Fixture') ? 'Human needed — non-physical fixture evidence is recorded.' : 'Missing — two named exact-laptop Open air reports are required.'));
  decision.append(element('p', 'Canonical paths: .artifacts/qualification/{machine-id}.json and .artifacts/qualification/selection.json'));
  decision.append(element('p', 'A selected profile must be audible, fixed, advertise at least 1357 bytes, and have exact-pair Open air evidence.'));
  appRoot.append(decision);
}

function control(label: string, action: () => void | Promise<void>, disabled = false, className = ''): HTMLButtonElement {
  const button = element('button', label);
  button.type = 'button'; button.disabled = disabled; button.className = className;
  button.addEventListener('click', () => { void action(); });
  return button;
}

async function arm(): Promise<void> {
  if (uiState === 'requesting') return;
  uiState = 'requesting'; failure = ''; resetFailure = ''; quietRuntime = 'Not armed'; render();
  try {
    evidence = await armAudio(epoch);
    await reportToBridge(evidence);
    // Audio preflight is deliberately not acoustic or FIPS readiness. The
    // session adapter alone projects ACOUSTIC_READY after commit + heartbeat.
    acousticAdapter?.refresh();
    syncBridgeState();
    bridgeDelivery = `Audio settings accepted for epoch ${epoch}; acoustic session is not committed`;
    uiState = 'ready';
  } catch (error) {
    const message = safeUiReason(error, 'browser audio unavailable');
    uiState = message.includes('bridge') ? 'disconnected' : 'failed';
    failure = message;
  }
  render();
}

function startQualification(): void {
  if (uiState !== 'ready' || gateState === 'cyrinx-running' || !cyrinxSession.canRequestStart) return;
  gateState = 'cyrinx-running';
  if (!runnerConfig && developmentDiagnostic) {
    corpusRows = [{ direction: 'A → B', caseId: `fixture-epoch-${epoch}`, evidenceClass: 'Fixture', result: 'Byte-perfect loopback (non-physical)', airtime: '0 ms' }];
    render();
    return;
  }
  if (!runnerConfig || !bridge || bridge.readyState !== WebSocket.OPEN) return;
  render();
  const payload = new TextEncoder().encode(JSON.stringify({ action: 'start_cyrinx' }));
  try { bridge.send(encodeControlFrame({ type: 5, epoch, sequence: bridgeSequence++, payload })); }
  catch (error) { failBridge(bridge, asError(error, 'Cyrinx start request failed')); }
}

async function sendQuietCorpus(): Promise<void> {
  const config = runnerConfig;
  if (!config || quietCorpusSendState !== 'ready' || cyrinxSession.snapshot.codec !== 'quiet') return;
  const sendEpoch = epoch;
  const direction = directionForRole(config.role);
  quietCorpusSendState = 'sending';
  quietRuntime = `Quiet sending ${direction} corpus · epoch ${sendEpoch}`;
  render();
  try {
    await quiet.sendCorpus(config.role, sendEpoch, (entry, index, total) => {
      corpusRows = [...corpusRows, { direction: entry.direction, caseId: entry.id, evidenceClass: config.evidenceClass, result: `Sent locally ${index}/${total}; receiver evidence is independent`, airtime: 'pending' }];
      render();
    }, quietCorpusLimit);
    if (epoch !== sendEpoch) return;
    quietCorpusSendState = 'sent';
    quietRuntime = `Quiet ${direction} corpus sent · receiver remains armed · epoch ${sendEpoch}`;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : '';
    const message = safeUiReason(error, 'Quiet modem operation was unavailable');
    if (rawMessage === 'Quiet transmission cancelled by reset' || epoch !== sendEpoch) return;
    quietCorpusSendState = 'unavailable';
    uiState = message.includes('bridge') ? 'disconnected' : 'failed';
    failure = message;
    quietRuntime = `Quiet failed · epoch ${sendEpoch}`;
    reportQuietRuntimeFailure(sendEpoch);
    try { cyrinxSession.markQuietFailed(); } catch { /* terminal state is already authoritative */ }
  }
  render();
}

async function startQuietFallback(): Promise<void> {
  if (!runnerConfig) return;
  let quietEpoch = epoch;
  quietCorpusSendState = 'unavailable';
  try {
    // Stop browser capture/playback before RESET so a late same-epoch callback
    // cannot be accepted by the runner after it changes ownership.
    clearCyrinxCase();
    await quiet.reset();
    await resetAudio();
    quietEpoch = await requestBridgeReset();
    epoch = quietEpoch;
    evidence = undefined;
    await quiet.arm(epoch, runnerConfig.role);
    await reportQuietSettings();
    configureAcousticSession(runnerConfig);
    acousticAdapter!.reset(epoch);
    if (runnerConfig.role === 'A') acousticSession!.start();
    acousticAdapter!.refresh();
    bridgeDelivery = `Quiet audio settings accepted for epoch ${epoch}`;
    quietCorpusSendState = 'ready';
    quietRuntime = `Quiet armed and listening · ${QUIET_PROFILE} · send ${directionForRole(runnerConfig.role)} when the operator is ready · epoch ${epoch}`;
    render();
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : '';
    const message = safeUiReason(error, 'Quiet modem operation was unavailable');
    if (rawMessage === 'Quiet transmission cancelled by reset' || epoch !== quietEpoch) return;
    quietCorpusSendState = 'unavailable';
    uiState = message.includes('bridge') || message.includes('RESET') ? 'disconnected' : 'failed';
    failure = message;
    quietRuntime = `Quiet failed · epoch ${quietEpoch}`;
    reportQuietRuntimeFailure(quietEpoch);
    try { cyrinxSession.markQuietFailed(); } catch { /* terminal state is already authoritative */ }
  }
  render();
}

async function appendQuietEvidence(received: ReceiveCaseEvidence): Promise<void> {
  const config = runnerConfig;
  if (!config || received.epoch !== epoch || received.sender !== peerRole(config.role) || received.direction !== receiveDirectionForRole(config.role)) {
    uiState = 'failed';
    failure = 'Rejected stale or impossible Quiet receiver evidence';
    reportQuietRuntimeFailure(epoch);
    try { cyrinxSession.markQuietFailed(); } catch { /* terminal state is already authoritative */ }
    render();
    return;
  }
  const evidenceClass = runnerConfig?.evidenceClass ?? 'Loopback';
  const row = { direction: received.direction, caseId: received.caseId, evidenceClass, result: 'Receiver evidence pending bridge acceptance', airtime: `${Math.round(received.airtimeMs)} ms` } satisfies CorpusRow;
  corpusRows = [...corpusRows, row];
  render();
  try {
    await reportQuietResult(received);
    const bytePerfect = received.complete && received.digest !== null && !received.corrupt && received.missing === 0 && received.duplicates === 0 && received.deliveryCount === 1;
    row.result = bytePerfect ? 'Passed independent receiver evidence' : 'Failed receiver integrity (report delivered)';
    bridgeDelivery = `Result accepted: ${received.caseId} · epoch ${received.epoch}`;
  } catch (error) {
    row.result = 'Failed report delivery';
    uiState = 'disconnected';
    failure = safeUiReason(error, 'local bridge message was rejected');
    bridgeDelivery = `Failed — ${failure}`;
    reportQuietRuntimeFailure(epoch);
    try { cyrinxSession.markQuietFailed(); } catch { /* terminal state is already authoritative */ }
  }
  render();
}

async function reset(): Promise<void> {
  if (uiState === 'requesting') return;
  resetDemoStageTimings();
  bridgeState = reduceBridgeState(bridgeState, { type: 'reset-start' });
  uiState = 'requesting'; failure = ''; resetFailure = ''; render();
  try {
    acousticAdapter?.invalidate(); fipsPackets.invalidate(); browserPacketReady = false; packetGeneration += 1;
    clearCyrinxCase();
    for (const incomplete of quiet.flushIncomplete()) await appendQuietEvidence(incomplete);
    const nextEpoch = await requestBridgeReset();
    await quiet.reset();
    await resetAudio();
    epoch = nextEpoch;
    acousticAdapter?.reset(epoch);
    evidence = undefined;
    // Reset only changes audio/epoch. Cyrinx remains irreversible once the
    // runner started it; re-arm therefore cannot restart the primary path.
    corpusRows = [];
    quietRuntime = 'Not armed';
    quietCorpusSendState = 'unavailable';
    uiState = 'idle';
    render();
    await arm();
    if (cyrinxSession.snapshot.codec === 'quiet') void startQuietFallback();
  } catch (error) {
    const message = safeUiReason(error, 'local bridge reset was unavailable');
    bridgeState = reduceBridgeState(bridgeState, { type: 'reset-failed', reason: message });
    uiState = message.includes('bridge') || message.includes('RESET') ? 'disconnected' : 'failed';
    failure = message;
    resetFailure = message;
    render();
  }
}

render();
void runAcousticFixtureIfRequested();
void fetchRunnerConfig().then((config) => {
  runnerConfig = config;
  syncBridgeState();
  render();
  // Quiet's current receiver runs its audio callback on the main thread.
  // The large Debug DOM must stay quiescent during physical qualification;
  // proof remains manually refreshable there while the compact demo view polls.
  if (!developmentDiagnostic && !debugMode) void refreshProofStatus();
}, (error: unknown) => { configFailure = safeConfigReason(error); render(); });
// Session state and heartbeats are owned by the acoustic controller. Keep the
// audience projection fresh even between controller callbacks without exposing
// any additional transport authority to the UI.
let observedDemoState = '';
window.setInterval(() => {
  if (debugMode) return;
  const acoustic = acousticSession?.snapshot;
  const current = [
    uiState, failure, resetFailure, bridgeState?.status, bridgeState?.epoch,
    acoustic?.state, acoustic?.reason, acoustic?.ready, acoustic?.lastHeartbeatAtMs,
    acoustic?.ledger.length, acoustic?.turnOwner, acoustic?.counters.retries, acoustic?.counters.dropped,
    acousticTx, acousticRx, acousticFramesTx, acousticFramesRx, proofState.mode, proofState.needsRefresh,
    Math.floor(performance.now() / 1_000),
  ].join('|');
  if (current === observedDemoState) return;
  observedDemoState = current;
  render();
}, 250);
window.setInterval(() => { if (!developmentDiagnostic && !debugMode && !proofRequest) void refreshProofStatus(); }, 5_000);
window.setInterval(() => { if (!developmentDiagnostic && !debugMode) void refreshImageTransfer(); }, 750);
