import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  armAudio,
  configureAudioEnvironmentForTests,
  createPlaybackQueue,
  evaluateAppliedSettings,
  resetAudio,
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

function playbackFrame(options: { epoch?: number; sampleRate?: number; channels?: number; payload?: Float32Array } = {}) {
  const payload = options.payload ?? new Float32Array([0, 0.25, -0.25, 0]);
  const frame = new ArrayBuffer(32 + payload.byteLength);
  const view = new DataView(frame);
  new Uint8Array(frame, 0, 4).set([0x46, 0x57, 0x41, 0x56]);
  view.setUint8(4, 1);
  view.setUint8(5, 4);
  view.setUint32(8, payload.byteLength, true);
  view.setUint32(12, options.epoch ?? 1, true);
  view.setBigUint64(16, 12n, true);
  view.setUint32(24, options.sampleRate ?? 48_000, true);
  view.setUint16(28, options.channels ?? 1, true);
  view.setUint16(30, 1, true);
  new Float32Array(frame, 32).set(payload);
  return frame;
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
    ['track sample rate', { trackSampleRate: 44_100 }],
    ['channel count', { channelCount: 2 }],
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
      trackSampleRate: 48_000,
      channelCount: 1,
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
    const queue = createPlaybackQueue({ maxBytes: 16, maxDurationMs: 1 });
    const chunk = validatePcmPlaybackFrame(playbackFrame(), 1);
    expect(queue.enqueue(chunk)).toMatchObject({ queuedBytes: 16 });
    expect(() => queue.enqueue(chunk)).toThrow('overflow');
    expect(queue.metrics().queuedBytes).toBe(16);
  });
});
