import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const origin = 'http://127.0.0.1:4173';

test('production Quiet page receives immutable runner identity and only loads the fixed audible profile assets', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(`${origin}/`);
  await expect(page.getByText('Machine: playwright · Role: A · Evidence: Loopback')).toBeVisible();
  await expect(page.getByText('Report target: .artifacts/qualification/playwright.json')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arm modem' })).toBeEnabled();
  expect(requests).toContain(`${origin}/qualification-config`);
  expect(await page.locator('select').count()).toBe(0);
  await expect(page.getByText('audible-7k-channel-0')).toHaveCount(0);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://${location.host}/bridge`); socket.binaryType = 'arraybuffer';
      socket.onopen = () => { const payload = new TextEncoder().encode(JSON.stringify({ browserVersion: navigator.userAgent, contextSampleRate: 48_000, captureSampleRate: 48_000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false })); const frame = new ArrayBuffer(32 + payload.byteLength); const view = new DataView(frame); [0x46, 0x57, 0x41, 0x56].forEach((byte, index) => view.setUint8(index, byte)); view.setUint8(4, 1); view.setUint8(5, 2); view.setUint32(8, payload.byteLength, true); view.setUint32(12, 1, true); new Uint8Array(frame, 32).set(payload); socket.send(frame); };
      socket.onmessage = () => { socket.close(); resolve(); }; socket.onerror = () => reject(new Error('production bridge did not persist diagnostic audio evidence'));
    });
  });
  await expect.poll(async () => JSON.parse(await readFile('.artifacts/qualification/loopback-qualification.json', 'utf8')).reportPath).toContain('loopback-qualification.json');
});
