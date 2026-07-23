import { expect, test } from '@playwright/test';

async function mockBrowserAudio(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const track = { label: 'Built-in microphone with an intentionally long diagnostic label for overflow coverage', getSettings: () => ({ sampleRate: 48_000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }), stop: () => undefined };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) } });
    class FakeAudioContext { state = 'suspended'; sampleRate = 48_000; currentTime = 0; destination = {}; audioWorklet = { addModule: async () => undefined }; async resume() { this.state = 'running'; } async close() { this.state = 'closed'; } createMediaStreamSource() { return { connect: () => undefined }; } createBuffer() { return { copyToChannel: () => undefined }; } createBufferSource() { return { connect: () => undefined, addEventListener: () => undefined, start: () => undefined, stop: () => undefined }; } }
    class FakeWorklet { port = { onmessage: null }; connect() { return {}; } disconnect() {} }
    class FakeWebSocket extends EventTarget { binaryType = 'arraybuffer'; constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); } send() { queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: '{}' }))); } close() {} }
    Object.assign(window, { AudioContext: FakeAudioContext, AudioWorkletNode: FakeWorklet, WebSocket: FakeWebSocket });
  });
}

test('renders explicit empty evidence, all qualification cards, and no manual selection controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('http://127.0.0.1:5173/');

  await expect(page.getByRole('heading', { name: 'Cyrinx qualification gate' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Corpus evidence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Docker and TUN projection' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Decision and report' })).toBeVisible();
  await expect(page.getByText('No corpus results have been recorded for this epoch.')).toBeVisible();
  await expect(page.getByRole('button', { name: /select|pass|retry|extend/i })).toHaveCount(0);
});

test('shows an irreversible 90-minute Cyrinx countdown with a non-physical fixture row', async ({ page }) => {
  await mockBrowserAudio(page);
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: 'Arm modem' }).click();
  await page.getByRole('button', { name: 'Start Cyrinx qualification' }).click();

  await expect(page.getByText('Cyrinx qualification is in progress.')).toBeVisible();
  await expect(page.getByText('Cyrinx gate closes in 1:30:00')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Fixture' })).toBeVisible();
  await expect(page.getByText('Fixture evidence is diagnostic only and cannot select a codec.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Qualification corpus evidence' })).toBeVisible();
});
