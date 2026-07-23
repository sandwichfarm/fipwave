export const SAMPLE_RATE = 48_000;
export const PCM_PLAYBACK_MESSAGE_TYPE = 4;
export const PCM_FLOAT32_ENCODING = 1;
export const PCM_SAMPLE_INDEX_BYTES = 8;
export const FWAV_HEADER_BYTES = 32;

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
let activeArm: { epoch: number; promise: Promise<AppliedAudioEvidence> } | undefined;
let currentQueue: PcmPlaybackQueue | undefined;
let nextPlaybackTime = 0;
const scheduledSources = new Set<AudioBufferSourceNode>();
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

function assertCurrent(epoch: number): void {
  if (epoch !== currentEpoch) {
    fail(`stale audio completion for epoch ${epoch}`);
  }
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
  source.connect(worklet as unknown as AudioNode);
  worklet.connect(context.destination);
  worklet.port.onmessage = (event) => {
    if (epoch === currentEpoch) captureHandler?.(event.data);
  };
  return worklet;
}

export function armAudio(epoch: number): Promise<AppliedAudioEvidence> {
  if (activeArm?.epoch === epoch) {
    return activeArm.promise;
  }
  if (epoch !== currentEpoch) {
    currentEpoch = epoch;
  }
  const promise = (async () => {
    let context: BrowserAudioContext | undefined;
    let stream: MediaStream | undefined;
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
      const worklet = await prepareWorklet(context, stream, epoch);
      assertCurrent(epoch);
      currentWorklet = worklet;
      const evidence = toEvidence(epoch, context, track, 'ready');
      const result = evaluateAppliedSettings(evidence);
      if (!result.ready) {
        fail(result.failure ?? 'audio preflight failed');
      }
      currentQueue = createPlaybackQueue({ maxBytes: 256 * 1024, maxDurationMs: 2_000 });
      nextPlaybackTime = context.currentTime;
      return evidence;
    } catch (error) {
      if (stream && stream !== currentStream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (context && context !== currentContext) {
        await context.close().catch(() => undefined);
      }
      throw error;
    } finally {
      if (activeArm?.epoch === epoch) {
        activeArm = undefined;
      }
    }
  })();
  activeArm = { epoch, promise };
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
  if (flags !== 0 && flags !== 1) fail('PCM playback flags are unsupported');
  if (flags === 1 && samples.length !== 62_464) fail('Cyrinx PCM frame has unexpected geometry');
  return { epoch, firstSampleIndex: view.getBigUint64(FWAV_HEADER_BYTES, true), sampleRate, channelCount: 1, samples, byteLength: payloadBytes, durationMs: samples.length / sampleRate * 1_000, ...(flags === 1 ? { guardSamples: 14_400 } : {}) };
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
      if (lastEnd !== undefined && chunk.firstSampleIndex !== lastEnd) discontinuities += 1;
      lastEnd = chunk.firstSampleIndex + BigInt(chunk.samples.length);
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

export function enqueuePcmPlayback(chunk: PcmPlaybackChunk): PlaybackMetrics {
  assertCurrent(chunk.epoch);
  if (!currentContext || !currentQueue || currentContext.state !== 'running') fail('audio playback is not armed');
  currentQueue.enqueue(chunk);
  const outputSamples = chunk.samples.length + (chunk.guardSamples ?? 0);
  const buffer = currentContext.createBuffer(2, outputSamples, chunk.sampleRate);
  const left = new Float32Array(outputSamples); left.set(chunk.samples); buffer.copyToChannel(left, 0);
  buffer.copyToChannel(new Float32Array(outputSamples), 1);
  const source = currentContext.createBufferSource();
  source.buffer = buffer;
  source.connect(currentContext.destination);
  const startAt = Math.max(currentContext.currentTime, nextPlaybackTime);
  nextPlaybackTime = startAt + outputSamples / chunk.sampleRate;
  scheduledSources.add(source);
  source.addEventListener('ended', () => scheduledSources.delete(source), { once: true });
  source.start(startAt);
  currentQueue.dequeue();
  return currentQueue.metrics();
}

export async function resetAudio(): Promise<number> {
  currentEpoch += 1;
  activeArm = undefined;
  currentQueue?.clear();
  currentQueue = undefined;
  for (const source of scheduledSources) source.stop();
  scheduledSources.clear();
  currentWorklet?.disconnect();
  currentWorklet = undefined;
  currentStream?.getTracks().forEach((track) => track.stop());
  currentStream = undefined;
  const context = currentContext;
  currentContext = undefined;
  if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  nextPlaybackTime = 0;
  return currentEpoch;
}

export function configureAudioEnvironmentForTests(overrides?: Partial<AudioEnvironment>): void {
  environment = { ...defaultEnvironment, ...overrides };
}

export function setPcmCaptureHandler(handler?: (batch: unknown) => void): void {
  captureHandler = handler;
}
