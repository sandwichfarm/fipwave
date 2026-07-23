import './style.css';
import { armAudio, canBufferPcmCaptureFrame, enqueuePcmPlayback, resetAudio, setPcmCaptureHandler, validatePcmPlaybackFrame, type AppliedAudioEvidence } from './audio.js';
import { acceptBridgePlaybackFrame } from '../../../packages/bridge/src/codecs/websocket.js';
import { CyrinxCaseWatchdog, sameCyrinxBrowserCase, type CyrinxBrowserCase } from './cyrinx-case-watchdog.js';
import { CyrinxQualificationSession, type CyrinxSessionSnapshot } from './qualification-session.js';
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

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Modem UI root is unavailable');
const appRoot: HTMLDivElement = app;
// Vite's diagnostic server intentionally has no runner authority. The shipped
// production route is always runner-backed and never uses this fixture branch.
const developmentDiagnostic = window.location.port === '5173';

let epoch = 1;
let evidence: AppliedAudioEvidence | undefined;
let uiState: UiState = 'idle';
let failure = '';
let bridge: WebSocket | undefined;
let bridgeSequence = 0n;
let bridgeDelivery = 'Not connected';
let quietRuntime = 'Not armed';
type QuietCorpusSendState = 'unavailable' | 'ready' | 'sending' | 'sent';
let quietCorpusSendState: QuietCorpusSendState = 'unavailable';
let quietFailureReportedEpoch: number | undefined;
let runnerConfig: Readonly<RunnerConfig> | undefined;
let configFailure = '';
function requestedPlaybackGain(): number {
  const raw = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('playbackGain');
  if (raw === null || raw.trim() === '') return 1;
  const gain = Number(raw);
  return Number.isFinite(gain) && gain > 0 && gain <= 4 ? gain : 1;
}
const quiet = new QuietClient((received) => { void appendQuietEvidence(received); }, { playbackGain: requestedPlaybackGain() });
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
let pendingReset: (Pending<number> & { previousEpoch: number }) | undefined;
const pendingResults = new Map<string, Pending<void>>();

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
  clearCyrinxCase();
  bridge = undefined;
  rejectPending(reason);
  bridgeDelivery = `Failed — ${reason.message}`;
  uiState = 'disconnected';
  failure = reason.message;
  render();
}

function handleBridgeMessage(socket: WebSocket, event: MessageEvent): void {
  try {
    if (developmentDiagnostic && pendingSettings && (event.data === undefined || event.data === '{}')) {
      const pending = pendingSettings;
      window.clearTimeout(pending.timer);
      pendingSettings = undefined;
      pending.resolve();
      return;
    }
    if (event.data instanceof ArrayBuffer) {
      const type = readFwavMessageType(event.data);
      if (type === 8) {
        const pending = pendingReset;
        if (!pending) throw new Error('Local bridge sent an unsolicited RESET');
        const nextEpoch = decodeResetFrame(event.data, pending.previousEpoch);
        window.clearTimeout(pending.timer);
        pendingReset = undefined;
        pending.resolve(nextEpoch);
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
        void scheduled.completion.then(() => {
          const socket = bridge;
          if (transmitCase !== activeTransmit || !cyrinxCaseWatchdog.owns(activeTransmit)) return;
          if (!socket || socket.readyState !== WebSocket.OPEN) { cyrinxCaseWatchdog.fail(activeTransmit); return; }
          try {
            const payload = new TextEncoder().encode(JSON.stringify({ action: 'playback_complete', caseId: activeTransmit.caseId, direction: activeTransmit.direction }));
            const frame = encodeControlFrame({ type: 5, epoch: activeTransmit.epoch, sequence: bridgeSequence, payload });
            socket.send(frame);
            bridgeSequence += 1n;
            activeTransmit.completionSent = true;
            cyrinxCaseWatchdog.markTransmitCompletionSent(activeTransmit);
          } catch {
            cyrinxCaseWatchdog.fail(activeTransmit);
          }
        }).catch(() => {
          if (transmitCase === activeTransmit) cyrinxCaseWatchdog.fail(activeTransmit);
        });
      }
      return;
    }
    if (typeof event.data !== 'string') throw new Error('Local bridge sent an unsupported message');
    const message = JSON.parse(event.data) as Record<string, unknown>;
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
  bridge = socket;
  socket.binaryType = 'arraybuffer';
  socket.addEventListener('message', (event) => handleBridgeMessage(socket, event));
  socket.addEventListener('error', () => failBridge(socket, new Error('Local bridge disconnected')));
  socket.addEventListener('close', () => failBridge(socket, new Error('Local bridge closed before delivery was accepted')));
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Local bridge connection timed out')), 5_000);
    socket.addEventListener('open', () => { window.clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { window.clearTimeout(timer); reject(new Error('Local bridge disconnected')); }, { once: true });
  });
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
  const socket = bridge?.readyState === WebSocket.OPEN ? bridge : await openFreshBridge();
  const accepted = new Promise<number>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingReset = undefined;
      reject(new Error('Local bridge did not return RESET'));
    }, 5_000);
    pendingReset = { previousEpoch, resolve, reject, timer };
  });
  try { socket.send(encodeControlFrame({ type: 8, epoch: previousEpoch, sequence: bridgeSequence++ })); } catch (error) { failBridge(socket, asError(error, 'Local bridge RESET delivery failed')); }
  const nextEpoch = await accepted;
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

function render(): void {
  appRoot.replaceChildren();
  const header = element('header');
  header.append(element('h1', 'Modem qualification'));
  const meta = element('p', `Machine: ${runnerConfig?.machineId ?? 'runner config pending'} · Role: ${runnerConfig?.role ?? 'Unknown'} · Evidence: ${runnerConfig?.evidenceClass ?? 'Unknown'} · Chromium: ${navigator.userAgent} · Local epoch: ${epoch}`);
  meta.className = 'measurements';
  header.append(meta);
  const badge = element('p', `● ${labels[uiState]}`);
  badge.className = `status status-${uiState}`;
  header.append(badge);
  appRoot.append(header);

  const grid = element('div');
  grid.className = 'console-grid';
  const operator = element('section');
  operator.className = 'card operator-card';
  operator.append(element('h2', 'Operator control'));
  if (uiState === 'idle') operator.append(element('h3', 'Modem is not armed'));
  const announcement = element('p', uiState === 'failed'
    ? `Audio preflight failed: ${failure}. Check the device or browser permission, then Reset / re-arm.`
    : bodyCopy[uiState]);
  announcement.id = 'audio-status';
  announcement.setAttribute('aria-live', uiState === 'failed' ? 'assertive' : 'polite');
  operator.append(announcement);
  if (configFailure) operator.append(element('p', `Runner configuration failed: ${configFailure}`));
  operator.append(element('p', `Report target: ${runnerConfig?.reportTarget ?? 'Unknown'} · TUN mode: ${runnerConfig?.tunEvidence ?? 'Unknown'}`));
  operator.append(element('p', `Bridge delivery: ${bridgeDelivery}`));
  operator.append(element('p', quietRuntime));
  if (uiState === 'idle') operator.append(control('Arm modem', arm, !runnerConfig && !developmentDiagnostic));
  if (uiState === 'requesting') operator.append(control('Arm modem', arm, true));
  if (uiState === 'ready') {
    if (cyrinxSession.canRequestStart) operator.append(control('Start Cyrinx qualification', startQualification));
    if (quietCorpusSendState === 'ready' && runnerConfig && cyrinxSession.snapshot.codec === 'quiet') {
      operator.append(control(`Send Quiet ${directionForRole(runnerConfig.role)} corpus`, sendQuietCorpus));
    }
    operator.append(control('Reset / re-arm', reset, false, 'secondary'));
  }
  if (uiState === 'failed' || uiState === 'disconnected') operator.append(control('Reset / re-arm', reset, false, 'secondary'));
  operator.append(element('p', 'This starts a new local epoch and ignores stale results.'));
  grid.append(operator);

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
  uiState = 'requesting'; failure = ''; quietRuntime = 'Not armed'; render();
  try {
    evidence = await armAudio(epoch);
    await reportToBridge(evidence);
    bridgeDelivery = `Audio settings accepted for epoch ${epoch}`;
    uiState = 'ready';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown audio error';
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
    });
    if (epoch !== sendEpoch) return;
    quietCorpusSendState = 'sent';
    quietRuntime = `Quiet ${direction} corpus sent · receiver remains armed · epoch ${sendEpoch}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quiet qualification failed';
    if (message === 'Quiet transmission cancelled by reset' || epoch !== sendEpoch) return;
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
    bridgeDelivery = `Quiet audio settings accepted for epoch ${epoch}`;
    quietCorpusSendState = 'ready';
    quietRuntime = `Quiet armed and listening · ${QUIET_PROFILE} · send ${directionForRole(runnerConfig.role)} when the operator is ready · epoch ${epoch}`;
    render();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quiet qualification failed';
    if (message === 'Quiet transmission cancelled by reset' || epoch !== quietEpoch) return;
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
    failure = asError(error, 'Local bridge result delivery failed').message;
    bridgeDelivery = `Failed — ${failure}`;
    reportQuietRuntimeFailure(epoch);
    try { cyrinxSession.markQuietFailed(); } catch { /* terminal state is already authoritative */ }
  }
  render();
}

async function reset(): Promise<void> {
  if (uiState === 'requesting') return;
  uiState = 'requesting'; failure = ''; render();
  try {
    clearCyrinxCase();
    for (const incomplete of quiet.flushIncomplete()) await appendQuietEvidence(incomplete);
    const nextEpoch = await requestBridgeReset();
    await quiet.reset();
    await resetAudio();
    epoch = nextEpoch;
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
    const message = asError(error, 'Reset / re-arm failed').message;
    uiState = message.includes('bridge') || message.includes('RESET') ? 'disconnected' : 'failed';
    failure = message;
    render();
  }
}

render();
void fetchRunnerConfig().then((config) => { runnerConfig = config; render(); }, (error: unknown) => { configFailure = error instanceof Error ? error.message : 'unknown configuration error'; render(); });
