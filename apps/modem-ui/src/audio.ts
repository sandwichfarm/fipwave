export const SAMPLE_RATE = 48_000;
export const PCM_PLAYBACK_MESSAGE_TYPE = 4;
export const PCM_FLOAT32_ENCODING = 1;
export const PCM_SAMPLE_INDEX_BYTES = 8;
export const FWAV_HEADER_BYTES = 32;
export const CYRINX_PCM_PLAYBACK_FLAG = 1;
export const CYRINX_FRAME_SAMPLES = 62_464;
export const CYRINX_GUARD_SAMPLES = 14_400;
export const MAX_BRIDGE_CAPTURE_BUFFER_BYTES = 256 * 1024;
const MAX_SCHEDULED_HORIZON_MS = 2_000;

export type PermissionState = 'granted' | 'denied' | 'unknown';
export type WorkletState = 'ready' | 'unavailable' | 'unknown';
export type BridgeState = 'connected' | 'disconnected' | 'unknown';

export interface AppliedAudioEvidence {
  epoch: number;
  microphoneLabel: string;
  permission: PermissionState;
  contextState: string;
  contextSampleRate: number | undefined;
  inputDeviceSampleRate: number | undefined;
  captureSampleRate: number | undefined;
  inputDeviceChannels: number | undefined;
  captureChannels: number | undefined;
  echoCancellation: boolean | undefined;
  noiseSuppression: boolean | undefined;
  autoGainControl: boolean | undefined;
  workletState: WorkletState;
  bridgeState: BridgeState;
}

export interface AudioPreflightResult {
  ready: boolean;
  failure?: string;
  evidence: AppliedAudioEvidence;
}

export interface PcmPlaybackChunk {
  epoch: number;
  sequence: bigint;
  firstSampleIndex: bigint;
  sampleRate: number;
  channelCount: 1;
  samples: Float32Array;
  byteLength: number;
  durationMs: number;
  /** Cyrinx's modem-only wire frame receives a local 300 ms all-zero guard tail. */
  guardSamples?: number;
}

export interface PlaybackMetrics {
  queuedBytes: number;
  queuedDurationMs: number;
  highWaterBytes: number;
  highWaterDurationMs: number;
  discontinuities: number;
  scheduledSources: number;
}
export interface PlaybackCompletion {
  epoch: number;
  sequence: bigint;
  firstSampleIndex: bigint;
}
export interface ScheduledPlayback extends PlaybackMetrics {
  completion: Promise<PlaybackCompletion>;
}

export interface PcmPlaybackQueue {
  enqueue(chunk: PcmPlaybackChunk): PlaybackMetrics;
  dequeue(): PcmPlaybackChunk | undefined;
  metrics(): PlaybackMetrics;
  clear(): void;
}

interface BrowserAudioContext {
  state: string;
  sampleRate: number;
  currentTime: number;
  destination: AudioDestinationNode;
  resume(): Promise<void>;
  close(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  createMediaStreamSource(stream: MediaStream): AudioNode;
  audioWorklet?: { addModule(url: string): Promise<void> };
}

interface WorkletLike {
  connect(destination: AudioNode): AudioNode;
  disconnect(): void;
  port: MessagePort;
}

interface AudioEnvironment {
  createAudioContext: () => BrowserAudioContext;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createWorklet: (context: BrowserAudioContext, epoch: number) => WorkletLike;
}

const defaultEnvironment: AudioEnvironment = {
  createAudioContext: () => new AudioContext({ sampleRate: SAMPLE_RATE }) as unknown as BrowserAudioContext,
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createWorklet: (context, epoch) => new AudioWorkletNode(context as unknown as BaseAudioContext, 'pcm-capture', { processorOptions: { epoch } }) as unknown as WorkletLike,
};

let environment: AudioEnvironment = defaultEnvironment;
let currentEpoch = 0;
let currentContext: BrowserAudioContext | undefined;
let currentStream: MediaStream | undefined;
let currentWorklet: WorkletLike | undefined;
let activeArm: { epoch: number; generation: number; promise: Promise<AppliedAudioEvidence> } | undefined;
let armGeneration = 0;
let currentEvidence: AppliedAudioEvidence | undefined;
let currentQueue: PcmPlaybackQueue | undefined;
let nextPlaybackTime = 0;
let lastPlaybackSequence = -1n;
const scheduledSources = new Set<AudioBufferSourceNode>();
let pendingPlayback: {
  source: AudioBufferSourceNode;
  resolve(value: PlaybackCompletion): void;
  reject(reason: Error): void;
} | undefined;
let captureHandler: ((batch: unknown) => void) | undefined;

const mediaConstraints: MediaStreamConstraints = {
  audio: {
    channelCount: { ideal: 1 },
    sampleRate: { ideal: SAMPLE_RATE },
    echoCancellation: { exact: false },
    noiseSuppression: { exact: false },
    autoGainControl: { exact: false },
  },
  video: false,
};

function observed(value: unknown): string {
  return value === undefined ? 'unknown' : String(value);
}

function fail(message: string): never {
  throw new Error(message);
}

/** Admits a capture frame only when the complete encoded FWAV frame fits. */
export function canBufferPcmCaptureFrame(bufferedAmount: number, frameByteLength: number): boolean {
  return Number.isSafeInteger(bufferedAmount)
    && bufferedAmount >= 0
    && Number.isSafeInteger(frameByteLength)
    && frameByteLength > 0
    && frameByteLength <= MAX_BRIDGE_CAPTURE_BUFFER_BYTES
    && bufferedAmount <= MAX_BRIDGE_CAPTURE_BUFFER_BYTES - frameByteLength;
}

function assertCurrent(epoch: number): void {
  if (epoch !== currentEpoch) {
    fail(`stale audio completion for epoch ${epoch}`);
  }
}

function finishArm(generation: number): void {
  if (activeArm?.generation === generation) activeArm = undefined;
}

export function evaluateAppliedSettings(evidence: AppliedAudioEvidence): AudioPreflightResult {
  const required: Array<[boolean, string]> = [
    [evidence.permission === 'granted', `permission is ${evidence.permission}`],
    [evidence.contextState === 'running', `audio context state is ${observed(evidence.contextState)}, not running`],
    [evidence.contextSampleRate === SAMPLE_RATE, `context sample rate is ${observed(evidence.contextSampleRate)}, not ${SAMPLE_RATE}`],
    [evidence.captureSampleRate === SAMPLE_RATE, `codec capture sample rate is ${observed(evidence.captureSampleRate)}, not ${SAMPLE_RATE}`],
    [evidence.inputDeviceSampleRate === 44_100 || evidence.inputDeviceSampleRate === SAMPLE_RATE, `input-device sample rate is ${observed(evidence.inputDeviceSampleRate)}, not 44100 or ${SAMPLE_RATE}`],
    [evidence.captureChannels === 1, `codec capture channel count is ${observed(evidence.captureChannels)}, not 1`],
    [evidence.inputDeviceChannels === 1 || evidence.inputDeviceChannels === 2, `input-device channel count is ${observed(evidence.inputDeviceChannels)}, not 1 or 2`],
    [evidence.echoCancellation === false, `echo cancellation is ${observed(evidence.echoCancellation)}`],
    [evidence.noiseSuppression === false, `noise suppression is ${observed(evidence.noiseSuppression)}`],
    [evidence.autoGainControl === false, `automatic gain control is ${observed(evidence.autoGainControl)}`],
    [evidence.workletState === 'ready', `AudioWorklet status is ${evidence.workletState}`],
    [evidence.bridgeState === 'connected', `local bridge status is ${evidence.bridgeState}`],
  ];
  const failed = required.find(([passes]) => !passes);
  return failed ? { ready: false, failure: failed[1], evidence } : { ready: true, evidence };
}

function toEvidence(epoch: number, context: BrowserAudioContext, track: MediaStreamTrack, workletState: WorkletState): AppliedAudioEvidence {
  const applied = track.getSettings();
  const booleanSetting = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
  return {
    epoch,
    microphoneLabel: track.label || 'Unavailable',
    permission: 'granted',
    contextState: context.state,
    contextSampleRate: context.sampleRate,
    inputDeviceSampleRate: applied.sampleRate,
    captureSampleRate: context.sampleRate,
    inputDeviceChannels: applied.channelCount,
    // pcm-capture.js consumes inputs[0][0] and emits one Float32 channel.
    captureChannels: 1,
    echoCancellation: booleanSetting(applied.echoCancellation),
    noiseSuppression: booleanSetting(applied.noiseSuppression),
    autoGainControl: booleanSetting(applied.autoGainControl),
    workletState,
    bridgeState: 'connected',
  };
}

async function prepareWorklet(context: BrowserAudioContext, stream: MediaStream, epoch: number): Promise<WorkletLike> {
  if (!context.audioWorklet) {
    fail('AudioWorklet is unavailable');
  }
  await context.audioWorklet.addModule('/worklets/pcm-capture.js');
  assertCurrent(epoch);
  const worklet = environment.createWorklet(context, epoch);
  const source = context.createMediaStreamSource(stream);
  try {
    source.connect(worklet as unknown as AudioNode);
    worklet.connect(context.destination);
    worklet.port.onmessage = (event) => {
      if (epoch === currentEpoch) captureHandler?.(event.data);
    };
  } catch (error) {
    try { worklet.disconnect(); } catch { /* Context cleanup remains authoritative. */ }
    throw error;
  }
  return worklet;
}

export function armAudio(epoch: number): Promise<AppliedAudioEvidence> {
  if (activeArm?.epoch === epoch) {
    return activeArm.promise;
  }
  if (activeArm) return Promise.reject(new Error('audio reset is required before changing epoch'));
  if (currentEvidence?.epoch === epoch && currentContext?.state === 'running') return Promise.resolve(currentEvidence);
  if (currentContext || currentStream || currentWorklet) return Promise.reject(new Error('audio reset is required before re-arm'));
  if (epoch !== currentEpoch) {
    currentEpoch = epoch;
  }
  const generation = ++armGeneration;
  const promise = (async () => {
    let context: BrowserAudioContext | undefined;
    let stream: MediaStream | undefined;
    let worklet: WorkletLike | undefined;
    try {
      context = environment.createAudioContext();
      currentContext = context;
      await context.resume();
      assertCurrent(epoch);
      stream = await environment.getUserMedia(mediaConstraints);
      if (epoch !== currentEpoch) {
        stream.getTracks().forEach((track) => track.stop());
        fail(`stale audio completion for epoch ${epoch}`);
      }
      currentStream = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) {
        fail('microphone is unavailable');
      }
      worklet = await prepareWorklet(context, stream, epoch);
      assertCurrent(epoch);
      currentWorklet = worklet;
      const evidence = toEvidence(epoch, context, track, 'ready');
      const result = evaluateAppliedSettings(evidence);
      if (!result.ready) {
        fail(result.failure ?? 'audio preflight failed');
      }
      currentQueue = createPlaybackQueue({ maxBytes: 256 * 1024, maxDurationMs: 2_000 });
      nextPlaybackTime = context.currentTime;
      lastPlaybackSequence = -1n;
      currentEvidence = evidence;
      return evidence;
    } catch (error) {
      if (worklet) {
        worklet.port.onmessage = null;
        try { worklet.disconnect(); } catch { /* Continue closing every owned resource. */ }
      }
      if (stream) for (const track of stream.getTracks()) {
        try { track.stop(); } catch { /* Continue closing every owned resource. */ }
      }
      if (context && context.state !== 'closed') await context.close().catch(() => undefined);
      const ownsCurrentAudio = currentContext === context;
      if (currentWorklet === worklet) currentWorklet = undefined;
      if (currentStream === stream) currentStream = undefined;
      if (currentContext === context) currentContext = undefined;
      if (ownsCurrentAudio) {
        currentQueue?.clear();
        currentQueue = undefined;
        currentEvidence = undefined;
      }
      throw error;
    } finally {
      finishArm(generation);
    }
  })();
  activeArm = { epoch, generation, promise };
  return promise;
}

export function validatePcmPlaybackFrame(data: ArrayBuffer, expectedEpoch: number): PcmPlaybackChunk {
  if (data.byteLength < FWAV_HEADER_BYTES) fail('PCM playback frame is shorter than the FWAV header');
  if (data.byteLength > 256 * 1024) fail('PCM playback frame exceeds the 256 KiB cap');
  const view = new DataView(data);
  if (String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== 'FWAV') fail('PCM playback magic is invalid');
  if (view.getUint8(4) !== 1) fail('PCM playback version is unsupported');
  if (view.getUint8(5) !== PCM_PLAYBACK_MESSAGE_TYPE) fail('PCM playback type is invalid');
  const payloadBytes = view.getUint32(8, true);
  if (payloadBytes !== data.byteLength - FWAV_HEADER_BYTES) fail('PCM playback length does not match payload');
  const epoch = view.getUint32(12, true);
  if (epoch !== expectedEpoch) fail(`PCM playback epoch ${epoch} is stale; expected ${expectedEpoch}`);
  const sampleRate = view.getUint32(24, true);
  if (sampleRate !== SAMPLE_RATE) fail(`PCM playback sample rate is ${sampleRate}, not ${SAMPLE_RATE}`);
  const channelCount = view.getUint16(28, true);
  if (channelCount !== 1) fail(`PCM playback channel count is ${channelCount}, not 1`);
  if (view.getUint16(30, true) !== PCM_FLOAT32_ENCODING) fail('PCM playback encoding is not Float32');
  if (payloadBytes <= PCM_SAMPLE_INDEX_BYTES || (payloadBytes - PCM_SAMPLE_INDEX_BYTES) % Float32Array.BYTES_PER_ELEMENT !== 0) fail('PCM playback Float32 payload is unaligned');
  const payload = data.slice(FWAV_HEADER_BYTES + PCM_SAMPLE_INDEX_BYTES);
  const samples = new Float32Array(payload);
  const flags = view.getUint16(6, true);
  if (flags !== 0 && flags !== CYRINX_PCM_PLAYBACK_FLAG) fail('PCM playback flags are unsupported');
  if (flags === CYRINX_PCM_PLAYBACK_FLAG && samples.length !== CYRINX_FRAME_SAMPLES) fail('Cyrinx PCM frame has unexpected geometry');
  const guardSamples = flags === CYRINX_PCM_PLAYBACK_FLAG ? CYRINX_GUARD_SAMPLES : 0;
  return {
    epoch,
    sequence: view.getBigUint64(16, true),
    firstSampleIndex: view.getBigUint64(FWAV_HEADER_BYTES, true),
    sampleRate,
    channelCount: 1,
    samples,
    byteLength: payloadBytes,
    durationMs: (samples.length + guardSamples) / sampleRate * 1_000,
    ...(guardSamples ? { guardSamples } : {}),
  };
}

export function createPlaybackQueue(options: { maxBytes: number; maxDurationMs: number }): PcmPlaybackQueue {
  const chunks: PcmPlaybackChunk[] = [];
  let queuedBytes = 0;
  let queuedDurationMs = 0;
  let highWaterBytes = 0;
  let highWaterDurationMs = 0;
  let discontinuities = 0;
  let lastEnd: bigint | undefined;
  const metrics = (): PlaybackMetrics => ({ queuedBytes, queuedDurationMs, highWaterBytes, highWaterDurationMs, discontinuities, scheduledSources: scheduledSources.size });
  return {
    enqueue(chunk) {
      if (queuedBytes + chunk.byteLength > options.maxBytes || queuedDurationMs + chunk.durationMs > options.maxDurationMs) fail('PCM playback queue overflow');
      if (lastEnd !== undefined && chunk.firstSampleIndex !== lastEnd) {
        discontinuities += 1;
        fail('PCM playback discontinuity');
      }
      lastEnd = chunk.firstSampleIndex + BigInt(chunk.samples.length + (chunk.guardSamples ?? 0));
      chunks.push(chunk);
      queuedBytes += chunk.byteLength;
      queuedDurationMs += chunk.durationMs;
      highWaterBytes = Math.max(highWaterBytes, queuedBytes);
      highWaterDurationMs = Math.max(highWaterDurationMs, queuedDurationMs);
      return metrics();
    },
    dequeue() {
      const chunk = chunks.shift();
      if (chunk) { queuedBytes -= chunk.byteLength; queuedDurationMs -= chunk.durationMs; }
      return chunk;
    },
    metrics,
    clear() { chunks.splice(0); queuedBytes = 0; queuedDurationMs = 0; lastEnd = undefined; },
  };
}

export function enqueuePcmPlayback(chunk: PcmPlaybackChunk): ScheduledPlayback {
  assertCurrent(chunk.epoch);
  if (!currentContext || !currentQueue || currentContext.state !== 'running') fail('audio playback is not armed');
  if (chunk.sequence <= lastPlaybackSequence) fail('PCM playback sequence is a replay');
  if (scheduledSources.size !== 0) fail('PCM playback already has a scheduled source');
  const outputSamples = chunk.samples.length + (chunk.guardSamples ?? 0);
  const startAt = Math.max(currentContext.currentTime, nextPlaybackTime);
  if ((startAt - currentContext.currentTime + outputSamples / chunk.sampleRate) * 1_000 > MAX_SCHEDULED_HORIZON_MS) fail('PCM playback scheduled horizon overflow');
  currentQueue.enqueue(chunk);
  let source: AudioBufferSourceNode | undefined;
  let rejectCompletion: ((reason: Error) => void) | undefined;
  try {
    const buffer = currentContext.createBuffer(2, outputSamples, chunk.sampleRate);
    const left = new Float32Array(outputSamples); left.set(chunk.samples); buffer.copyToChannel(left, 0);
    buffer.copyToChannel(new Float32Array(outputSamples), 1);
    source = currentContext.createBufferSource();
    source.buffer = buffer;
    source.connect(currentContext.destination);
    scheduledSources.add(source);
    const identity = { epoch: chunk.epoch, sequence: chunk.sequence, firstSampleIndex: chunk.firstSampleIndex };
    let resolveCompletion!: (value: PlaybackCompletion) => void;
    let reject!: (reason: Error) => void;
    const completion = new Promise<PlaybackCompletion>((resolve, rejectPromise) => {
      resolveCompletion = resolve;
      reject = rejectPromise;
    });
    // The production consumer awaits this promise. This attached rejection
    // handler also prevents reset from creating an unhandled rejection if a
    // diagnostic caller intentionally ignores completion.
    void completion.catch(() => undefined);
    rejectCompletion = reject;
    const ownedSource = source;
    pendingPlayback = { source: ownedSource, resolve: resolveCompletion, reject };
    source.addEventListener('ended', () => {
      scheduledSources.delete(ownedSource);
      if (pendingPlayback?.source === ownedSource) {
        const pending = pendingPlayback;
        pendingPlayback = undefined;
        pending.resolve(identity);
      }
    }, { once: true });
    source.start(startAt);
    nextPlaybackTime = startAt + outputSamples / chunk.sampleRate;
    lastPlaybackSequence = chunk.sequence;
    currentQueue.dequeue();
    return { ...currentQueue.metrics(), completion };
  } catch (error) {
    if (source) {
      scheduledSources.delete(source);
      try { source.disconnect(); } catch { /* A failed source is already detached from scheduling. */ }
      if (pendingPlayback?.source === source) pendingPlayback = undefined;
    }
    rejectCompletion?.(error instanceof Error ? error : new Error('PCM playback failed'));
    currentQueue.clear();
    throw error;
  }
}

export async function resetAudio(): Promise<number> {
  currentEpoch += 1;
  activeArm = undefined;
  currentEvidence = undefined;
  captureHandler = undefined;
  const playback = pendingPlayback;
  pendingPlayback = undefined;
  playback?.reject(new Error('PCM playback was cancelled by reset'));
  currentQueue?.clear();
  currentQueue = undefined;
  const sources = [...scheduledSources];
  scheduledSources.clear();
  for (const source of sources) {
    try { source.stop(); } catch { /* Ended sources must not block the rest of teardown. */ }
    try { source.disconnect(); } catch { /* Ended sources must not block the rest of teardown. */ }
  }
  if (currentWorklet) {
    currentWorklet.port.onmessage = null;
    try { currentWorklet.disconnect(); } catch { /* Continue closing tracks and context. */ }
  }
  currentWorklet = undefined;
  if (currentStream) for (const track of currentStream.getTracks()) {
    try { track.stop(); } catch { /* Continue closing tracks and context. */ }
  }
  currentStream = undefined;
  const context = currentContext;
  currentContext = undefined;
  if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  nextPlaybackTime = 0;
  lastPlaybackSequence = -1n;
  return currentEpoch;
}

export function configureAudioEnvironmentForTests(overrides?: Partial<AudioEnvironment>): void {
  environment = { ...defaultEnvironment, ...overrides };
}

export function setPcmCaptureHandler(handler?: (batch: unknown) => void): void {
  captureHandler = handler;
}
