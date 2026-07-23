import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  armAudio,
  configureAudioEnvironmentForTests,
  createPlaybackQueue,
  enqueuePcmPlayback,
  evaluateAppliedSettings,
  resetAudio,
  setPcmCaptureHandler,
  validatePcmPlaybackFrame,
} from './audio.js';

function settings(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: 'built-in-mic',
    sampleRate: 48_000,
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    ...overrides,
  };
}

function playbackFrame(options: { epoch?: number; sampleRate?: number; channels?: number; flags?: number; sequence?: bigint; firstSampleIndex?: bigint; payload?: Float32Array } = {}) {
  const payload = options.payload ?? new Float32Array([0, 0.25, -0.25, 0]);
  const frame = new ArrayBuffer(32 + 8 + payload.byteLength);
  const view = new DataView(frame);
  new Uint8Array(frame, 0, 4).set([0x46, 0x57, 0x41, 0x56]);
  view.setUint8(4, 1);
  view.setUint8(5, 4);
  view.setUint16(6, options.flags ?? 0, true);
  view.setUint32(8, 8 + payload.byteLength, true);
  view.setUint32(12, options.epoch ?? 1, true);
  view.setBigUint64(16, options.sequence ?? 12n, true);
  view.setUint32(24, options.sampleRate ?? 48_000, true);
  view.setUint16(28, options.channels ?? 1, true);
  view.setUint16(30, 1, true);
  view.setBigUint64(32, options.firstSampleIndex ?? 0n, true);
  new Float32Array(frame, 40).set(payload);
  return frame;
}

function audioHarness(options: { invalidSettings?: boolean; sourceStopThrows?: boolean } = {}) {
  const buffers: Array<Float32Array[]> = [];
  const sources: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    end(): void;
  }> = [];
  let onCapture: ((event: MessageEvent) => void) | null = null;
  const track = {
    getSettings: () => settings(options.invalidSettings ? { echoCancellation: true } : {}),
    label: 'Built-in microphone',
    stop: vi.fn(),
  };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  const worklet = {
    port: {
      get onmessage() { return onCapture; },
      set onmessage(value: ((event: MessageEvent) => void) | null) { onCapture = value; },
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const context = {
    state: 'suspended',
    sampleRate: 48_000,
    currentTime: 0,
    destination: {},
    audioWorklet: { addModule: vi.fn(async () => undefined) },
    resume: vi.fn(async () => { context.state = 'running'; }),
    close: vi.fn(async () => { context.state = 'closed'; }),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
    createBuffer: vi.fn((channels: number, length: number) => {
      const channelData = Array.from({ length: channels }, () => new Float32Array(length).fill(9));
      buffers.push(channelData);
      return {
        copyToChannel(source: Float32Array, channel: number, offset = 0) {
          channelData[channel]!.set(source, offset);
        },
      };
    }),
    createBufferSource: vi.fn(() => {
      let ended: (() => void) | undefined;
      const source = {
        buffer: undefined,
        connect: vi.fn(),
        start: vi.fn(),
        stop: options.sourceStopThrows ? vi.fn(() => { throw new DOMException('already ended', 'InvalidStateError'); }) : vi.fn(),
        addEventListener: vi.fn((_name: string, listener: () => void) => { ended = listener; }),
        end: () => ended?.(),
      };
      sources.push(source);
      return source;
    }),
  };
  configureAudioEnvironmentForTests({
    createAudioContext: () => context as never,
    getUserMedia: async () => stream,
    createWorklet: () => worklet as never,
  });
  return {
    buffers,
    context,
    sources,
    stream,
    track,
    worklet,
    capture(data: unknown) { onCapture?.({ data } as MessageEvent); },
  };
}

afterEach(async () => {
  await resetAudio();
  configureAudioEnvironmentForTests();
});

describe('applied audio preflight', () => {
  it.each([
    ['unknown permission', { permission: 'unknown' as const }],
    ['context state', { contextState: 'suspended' as const }],
    ['context sample rate', { contextSampleRate: 44_100 }],
    ['codec capture sample rate', { captureSampleRate: 44_100 }],
    ['unknown input-device sample rate', { inputDeviceSampleRate: undefined }],
    ['unsupported input-device sample rate', { inputDeviceSampleRate: 32_000 }],
    ['codec capture channel count', { captureChannels: 2 }],
    ['unknown input-device channel count', { inputDeviceChannels: undefined }],
    ['unsupported input-device channel count', { inputDeviceChannels: 3 }],
    ['echo cancellation', { echoCancellation: true }],
    ['noise suppression', { noiseSuppression: true }],
    ['automatic gain control', { autoGainControl: true }],
    ['worklet', { workletState: 'unavailable' as const }],
    ['bridge', { bridgeState: 'disconnected' as const }],
  ])('fails closed for %s', (_case, overrides) => {
    const result = evaluateAppliedSettings({
      permission: 'granted',
      contextState: 'running',
      contextSampleRate: 48_000,
      captureSampleRate: 48_000,
      inputDeviceSampleRate: 48_000,
      inputDeviceChannels: 1,
      captureChannels: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      workletState: 'ready',
      bridgeState: 'connected',
      microphoneLabel: 'Built-in microphone',
      epoch: 1,
      ...overrides,
    });
    expect(result.ready).toBe(false);
    expect(result.failure).toBeTruthy();
  });

  it.each([44_100, 48_000])('accepts an observed %i Hz input device only across a real 48 kHz Web Audio codec boundary', (inputDeviceSampleRate) => {
    const evidence = {
      permission: 'granted' as const,
      contextState: 'running',
      contextSampleRate: 48_000,
      captureSampleRate: 48_000,
      inputDeviceSampleRate,
      inputDeviceChannels: 1,
      captureChannels: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      workletState: 'ready' as const,
      bridgeState: 'connected' as const,
      microphoneLabel: 'Built-in microphone',
      epoch: 1,
    };
    expect(evaluateAppliedSettings(evidence)).toEqual({ ready: true, evidence });
  });

  it.each([1, 2])('preserves an observed %i-channel input device while the codec graph consumes mono', (inputDeviceChannels) => {
    const evidence = {
      permission: 'granted' as const,
      contextState: 'running',
      contextSampleRate: 48_000,
      captureSampleRate: 48_000,
      inputDeviceSampleRate: 48_000,
      inputDeviceChannels,
      captureChannels: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      workletState: 'ready' as const,
      bridgeState: 'connected' as const,
      microphoneLabel: 'Built-in microphone',
      epoch: 1,
    };
    expect(evaluateAppliedSettings(evidence)).toEqual({ ready: true, evidence });
  });

  it('arms once per epoch with applied settings and cancels stale completion after reset', async () => {
    let resolveMedia!: (value: MediaStream) => void;
    const context = {
      state: 'suspended', sampleRate: 48_000, destination: {},
      resume: vi.fn(async () => { context.state = 'running'; }),
      close: vi.fn(async () => { context.state = 'closed'; }),
      createBuffer: vi.fn(), createBufferSource: vi.fn(), createMediaStreamSource: () => ({ connect: vi.fn() }), currentTime: 0,
    };
    const track = { getSettings: () => settings(), label: 'Built-in microphone', stop: vi.fn() };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
    configureAudioEnvironmentForTests({
      createAudioContext: () => context as never,
      getUserMedia: () => new Promise<MediaStream>((resolve) => { resolveMedia = resolve; }),
      createWorklet: () => ({ port: { onmessage: null }, connect: vi.fn(), disconnect: vi.fn() }) as never,
    });

    const pending = armAudio(1);
    await Promise.resolve();
    await resetAudio();
    resolveMedia(stream);
    await expect(pending).rejects.toThrow('stale');
    expect(track.stop).toHaveBeenCalled();
  });
});

describe('PCM playback boundary', () => {
  it('rejects malformed or stale PCM playback before queueing', () => {
    expect(() => validatePcmPlaybackFrame(playbackFrame({ epoch: 2 }), 1)).toThrow('epoch');
    const malformed = playbackFrame();
    new DataView(malformed).setUint8(5, 99);
    expect(() => validatePcmPlaybackFrame(malformed, 1)).toThrow('type');
  });

  it('enforces byte and duration caps without partially admitting overflow', () => {
    const queue = createPlaybackQueue({ maxBytes: 24, maxDurationMs: 1 });
    const chunk = validatePcmPlaybackFrame(playbackFrame(), 1);
    expect(queue.enqueue(chunk)).toMatchObject({ queuedBytes: 24 });
    expect(() => queue.enqueue(chunk)).toThrow('overflow');
    expect(queue.metrics().queuedBytes).toBe(24);
  });

  it('renders exact Cyrinx stereo with a local zero guard while retaining mono capture evidence', async () => {
    const harness = audioHarness();
    const evidence = await armAudio(1);
    const modem = new Float32Array(62_464);
    modem[0] = 0.18;
    modem[31_232] = -0.18;
    modem[62_463] = 0.125;
    const chunk = validatePcmPlaybackFrame(playbackFrame({ flags: 1, sequence: 21n, payload: modem }), 1);
    const immutableInput = chunk.samples.slice();

    const metrics = enqueuePcmPlayback(chunk);

    expect(harness.context.createBuffer).toHaveBeenCalledWith(2, 62_464 + 14_400, 48_000);
    const [left, right] = harness.buffers[0]!;
    expect(left!.subarray(0, modem.length)).toEqual(modem);
    expect(left!.subarray(modem.length).every((sample) => sample === 0)).toBe(true);
    expect(right!.every((sample) => sample === 0)).toBe(true);
    expect(chunk.samples).toEqual(immutableInput);
    expect(evidence.captureChannels).toBe(1);
    expect(metrics).toMatchObject({
      highWaterBytes: 249_864,
      highWaterDurationMs: (62_464 + 14_400) / 48,
      scheduledSources: 1,
    });
  });

  it('rejects replay, discontinuity, and an overlapping scheduled source without partial admission', async () => {
    const harness = audioHarness();
    await armAudio(1);
    const first = validatePcmPlaybackFrame(playbackFrame({ sequence: 10n, firstSampleIndex: 0n }), 1);
    enqueuePcmPlayback(first);

    expect(() => enqueuePcmPlayback(first)).toThrow(/replay|scheduled/i);
    expect(harness.context.createBufferSource).toHaveBeenCalledTimes(1);
    harness.sources[0]!.end();
    expect(() => enqueuePcmPlayback(first)).toThrow(/replay/i);

    const gap = validatePcmPlaybackFrame(playbackFrame({ sequence: 11n, firstSampleIndex: 99n }), 1);
    expect(() => enqueuePcmPlayback(gap)).toThrow(/discontinuity/i);
    expect(harness.context.createBufferSource).toHaveBeenCalledTimes(1);
  });

  it('clears capture ownership and all audio resources even when one scheduled source cannot stop', async () => {
    const first = audioHarness({ sourceStopThrows: true });
    await armAudio(4);
    let captured = 0;
    setPcmCaptureHandler(() => { captured += 1; });
    first.capture({ epoch: 4 });
    enqueuePcmPlayback(validatePcmPlaybackFrame(playbackFrame({ epoch: 4 }), 4));

    await expect(resetAudio()).resolves.toBe(5);
    expect(first.worklet.disconnect).toHaveBeenCalledOnce();
    expect(first.track.stop).toHaveBeenCalledOnce();
    expect(first.context.close).toHaveBeenCalledOnce();

    const second = audioHarness();
    await armAudio(5);
    second.capture({ epoch: 5 });
    expect(captured).toBe(1);
  });
});

describe('audio lifecycle cleanup', () => {
  it('fully cleans a failed arm so the same epoch can be armed again', async () => {
    const failed = audioHarness({ invalidSettings: true });
    await expect(armAudio(12)).rejects.toThrow('echo cancellation');
    expect(failed.worklet.disconnect).toHaveBeenCalledOnce();
    expect(failed.track.stop).toHaveBeenCalledOnce();
    expect(failed.context.close).toHaveBeenCalledOnce();

    const recovered = audioHarness();
    await expect(armAudio(12)).resolves.toMatchObject({ epoch: 12, captureChannels: 1 });
    expect(recovered.context.resume).toHaveBeenCalledOnce();
  });
});
