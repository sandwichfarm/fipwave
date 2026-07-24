import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { startProductionRunner } from '../../../packages/bridge/src/runner.js';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

let runner: Awaited<ReturnType<typeof startProductionRunner>>;
let reportDirectory = '';
test.beforeAll(async () => {
  reportDirectory = await mkdtemp(path.join(tmpdir(), 'fipwave-demo-start-'));
  runner = await startProductionRunner({
    machineId: 'fipwave-a', role: 'A', port: 0,
    report: path.join(reportDirectory, 'report.json'), tunEvidence: 'none', evidenceMode: 'Loopback',
    uiDir: path.resolve('dist/modem-ui'),
  });
});
test.afterAll(async () => { await runner?.close(); await rm(reportDirectory, { recursive: true, force: true }); });

test('one demo Start / Connect enters Quiet acoustic startup without requesting Cyrinx', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const sentTypes: number[] = [];
    class RecordingWebSocket extends NativeWebSocket {
      override send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (data instanceof ArrayBuffer && data.byteLength >= 6) sentTypes.push(new DataView(data).getUint8(5));
        super.send(data as never);
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: RecordingWebSocket });
    Object.defineProperty(window, '__fipwaveSentTypes', { configurable: true, value: sentTypes });
  });
  // Runner static routes reject query strings; the UI supports the same mode
  // selector in the hash without changing the HTTP request.
  await page.goto(`http://127.0.0.1:${runner.port}/#demo=1`);
  const start = page.getByRole('button', { name: 'Start / Connect' });
  await expect(start).toBeVisible();
  await expect(start).toBeEnabled();
  await start.click();

  await expect(page.getByText('Profile: quiet-audible-7k-v1')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Handshake' })).toBeVisible();
  await expect(page.getByText(/^Acoustic: (Listening|HelloSent) — not yet ready$/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fipwaveSentTypes: number[] }).__fipwaveSentTypes)).not.toContain(5);
});
