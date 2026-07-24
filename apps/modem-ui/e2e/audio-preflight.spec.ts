import { expect, test } from '@playwright/test';

async function mockBrowserAudio(page: import('@playwright/test').Page, options: { settings?: Record<string, unknown>; bridgeFails?: boolean; label?: string; audioFailure?: string } = {}) {
  await page.addInitScript((config) => {
    const settings = { sampleRate: 48_000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...config.settings };
    const track = { label: config.label ?? 'Built-in microphone', getSettings: () => settings, stop: () => undefined };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
      if (config.audioFailure) throw new Error(config.audioFailure);
      return { getAudioTracks: () => [track], getTracks: () => [track] };
    } } });
    class FakeAudioContext {
      state = 'suspended'; sampleRate = 48_000; currentTime = 0; destination = {};
      audioWorklet = { addModule: async () => undefined };
      async resume() { this.state = 'running'; }
      async close() { this.state = 'closed'; }
      createMediaStreamSource() { return { connect: () => undefined }; }
      createBuffer() { return { copyToChannel: () => undefined }; }
      createBufferSource() { return { connect: () => undefined, addEventListener: () => undefined, start: () => undefined, stop: () => undefined }; }
    }
    class FakeWorklet { port = { onmessage: null }; connect() { return {}; } disconnect() {} }
    class FakeWebSocket extends EventTarget {
      binaryType = 'arraybuffer';
      constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event(config.bridgeFails ? 'error' : 'open'))); }
      send() { if (!config.bridgeFails) queueMicrotask(() => this.dispatchEvent(new Event('message'))); }
      close() {}
    }
    Object.assign(window, { AudioContext: FakeAudioContext, AudioWorkletNode: FakeWorklet, WebSocket: FakeWebSocket });
  }, options);
}

test('shows only the arm action until fact-based preflight succeeds, then exposes qualification', async ({ page }) => {
  await mockBrowserAudio(page);
  await page.goto('http://127.0.0.1:5173/');
  await expect(page.getByText('Modem is not armed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Cyrinx qualification' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Arm modem' }).click();
  await expect(page.getByText('Audio preflight passed on this laptop.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Cyrinx qualification' })).toBeVisible();
  await expect(page.getByText('localhost only')).toBeVisible();
});

test('blocks qualification for incompatible applied settings and gives one reset recovery action', async ({ page }) => {
  await mockBrowserAudio(page, { settings: { channelCount: 3 } });
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: 'Arm modem' }).click();
  await expect(page.getByText(/Audio preflight failed: input-device channel count is 3, not 1 or 2/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Cyrinx qualification' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset and reconnect' })).toBeVisible();
});

test('preserves an explicit disconnected state and keeps long device labels usable at 320px', async ({ page }) => {
  await mockBrowserAudio(page, { bridgeFails: true, label: '<img src=x onerror=alert(1)> unusually long microphone label that must remain text' });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: 'Arm modem' }).click();
  await expect(page.getByText('Local bridge disconnected. Qualification is paused; no result is being inferred.')).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset and reconnect' })).toBeVisible();
  const bounds = await page.getByRole('button', { name: 'Reset and reconnect' }).boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(250);
});

test('collapses raw browser error text to an approved operator message', async ({ page }) => {
  await mockBrowserAudio(page, { audioFailure: 'Error: FWAV frame dump deadbeef at parser' });
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: 'Arm modem' }).click();
  await expect(page.getByText(/Audio preflight failed: browser audio unavailable\./)).toBeVisible();
  await expect(page.getByText(/deadbeef|frame dump|at parser/i)).toHaveCount(0);
});
