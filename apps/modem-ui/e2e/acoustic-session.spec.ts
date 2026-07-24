import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import { startProductionRunner } from '../../../packages/bridge/src/runner.js';

/**
 * The browser receives no test transport here. Fixture means deterministic
 * local code evidence only; it is never an inter-laptop WebSocket shortcut.
 */
let runner: Awaited<ReturnType<typeof startProductionRunner>>;
let reportDirectory = '';
test.beforeAll(async () => {
  reportDirectory = await mkdtemp(path.join(tmpdir(), 'fipwave-acoustic-fixture-'));
  runner = await startProductionRunner({ machineId: 'fipwave-a', role: 'A', port: 0, report: path.join(reportDirectory, 'report.json'), tunEvidence: 'none', evidenceMode: 'Fixture', uiDir: path.resolve('dist/modem-ui') });
});
test.afterAll(async () => { await runner?.close(); await rm(reportDirectory, { recursive: true, force: true }); });

test('built browser reports Fixture-status acoustic readiness as fail-closed before an actual peer session', async ({ page }) => {
  await page.addInitScript(() => {
    const track = { label: 'Fixture microphone', getSettings: () => ({ sampleRate: 48_000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }), stop: () => undefined };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) } });
    class FakeAudioContext { state = 'suspended'; sampleRate = 48_000; destination = {}; audioWorklet = { addModule: async () => undefined }; async resume() { this.state = 'running'; } async close() { this.state = 'closed'; } createMediaStreamSource() { return { connect: () => undefined }; } createBuffer() { return { copyToChannel: () => undefined }; } createBufferSource() { return { connect: () => undefined, addEventListener: () => undefined, start: () => undefined, stop: () => undefined }; } }
    class FakeWorklet { port = { onmessage: null }; connect() { return {}; } disconnect() {} }
    Object.assign(window, { AudioContext: FakeAudioContext, AudioWorkletNode: FakeWorklet });
  });
  await page.goto(`http://127.0.0.1:${runner.port}/`);
  await page.getByRole('button', { name: 'Arm modem' }).click();
  await expect(page.getByText('Audio preflight passed on this laptop.')).toBeVisible();
  await expect(page.getByText(/Not started — microphone preflight does not claim an acoustic peer or FIPS readiness/)).toBeVisible();
  await expect(page.getByText(/Evidence: Fixture/)).toBeVisible();
});
