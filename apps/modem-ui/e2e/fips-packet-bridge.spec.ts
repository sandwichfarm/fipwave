import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import WebSocket from 'ws';

import { startProductionRunner } from '../../../packages/bridge/src/runner.js';

declare global {
  interface Window {
    __fipsPacketDeliveries?: number[][];
  }
}

function frame(epoch: number, sequence: bigint, payload: number[]): Buffer {
  const output = Buffer.alloc(32 + payload.length);
  output.write('FWAV'); output.writeUInt8(1, 4); output.writeUInt8(9, 5); output.writeUInt32LE(payload.length, 8); output.writeUInt32LE(epoch, 12); output.writeBigUInt64LE(sequence, 16); Buffer.from(payload).copy(output, 32);
  return output;
}
function opened(socket: WebSocket): Promise<void> { return new Promise((resolve, reject) => { socket.once('open', () => resolve()); socket.once('error', reject); }); }
function nextBinary(socket: WebSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    socket.once('message', (value, binary) => {
      if (!binary) return reject(new Error('expected binary FIPS packet'));
      resolve(Buffer.isBuffer(value) ? Buffer.from(value) : Array.isArray(value) ? Buffer.concat(value) : Buffer.from(value));
    });
    socket.once('error', reject);
  });
}

let runner: Awaited<ReturnType<typeof startProductionRunner>>;
let reportDirectory = '';
test.beforeAll(async () => {
  execFileSync('npm', ['run', 'build'], { stdio: 'pipe' });
  reportDirectory = await mkdtemp(path.join(tmpdir(), 'fipwave-browser-'));
  runner = await startProductionRunner({ machineId: 'fipwave-a', role: 'A', port: 0, report: path.join(reportDirectory, 'report.json'), tunEvidence: 'none', evidenceMode: 'Loopback', uiDir: path.resolve('dist/modem-ui') });
});
test.afterAll(async () => { await runner.close(); await rm(reportDirectory, { recursive: true, force: true }); });

test('armed production browser exchanges complete FIPS bytes with the real local WebSocket bridge', async ({ page }) => {
  await page.addInitScript(() => {
    const track = { label: 'Test microphone', getSettings: () => ({ sampleRate: 48_000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }), stop: () => undefined };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) } });
    class FakeAudioContext { state = 'suspended'; sampleRate = 48_000; destination = {}; audioWorklet = { addModule: async () => undefined }; async resume() { this.state = 'running'; } async close() { this.state = 'closed'; } createMediaStreamSource() { return { connect: () => undefined }; } createBuffer() { return { copyToChannel: () => undefined }; } createBufferSource() { return { connect: () => undefined, addEventListener: () => undefined, start: () => undefined, stop: () => undefined }; } }
    class FakeWorklet { port = { onmessage: null }; connect() { return {}; } disconnect() {} }
    Object.assign(window, { AudioContext: FakeAudioContext, AudioWorkletNode: FakeWorklet });
  });
  const port = runner.port;
  const fips = new WebSocket(`ws://127.0.0.1:${port}/bridge/fips`, { origin: `http://127.0.0.1:${port}` });
  await opened(fips);
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(() => {
    window.__fipsPacketDeliveries = [];
    window.addEventListener('fips-packet-received', (event) => {
      window.__fipsPacketDeliveries!.push([...(event as CustomEvent<Uint8Array>).detail]);
    });
  });

  await page.getByRole('button', { name: 'Arm modem' }).click();
  await expect(page.getByText('Audio preflight passed on this laptop.')).toBeVisible();
  const inbound = [0, 1, 2, 255];
  fips.send(frame(1, 0n, inbound));
  await expect.poll(() => page.evaluate(() => window.__fipsPacketDeliveries)).toEqual([inbound]);
  const outbound = [9, 8, 7];
  const bridgeFrame = nextBinary(fips);
  await page.evaluate((payload) => window.dispatchEvent(new CustomEvent('fips-packet-send', { detail: new Uint8Array(payload) })), outbound);
  expect([...await bridgeFrame]).toEqual([...frame(1, 1n, outbound)]);

  // Reset re-arms on a new bridge epoch. A delayed frame from the prior epoch
  // must remain harmless even after the new browser lifecycle becomes ready.
  await page.getByRole('button', { name: 'Reset and reconnect' }).click();
  await expect(page.getByText('Audio preflight passed on this laptop.')).toBeVisible();
  fips.send(frame(1, 2n, [0xbb]));
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() => window.__fipsPacketDeliveries)).toEqual([inbound]);
  fips.close();
});
