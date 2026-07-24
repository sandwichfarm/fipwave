import { expect, test } from '@playwright/test';

async function mockBrowserAudio(page: import('@playwright/test').Page, microphoneLabel: string, failReset = false) {
  await page.addInitScript(({ label, resetShouldFail }) => {
    const track = {
      label,
      getSettings: () => ({ sampleRate: 48_000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }),
      stop: () => undefined,
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) } });
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
      static OPEN = 1;
      binaryType = 'arraybuffer';
      readyState = 0;
      sends = 0;
      constructor() {
        super();
        queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
      }
      send() {
        this.sends += 1;
        if (this.sends === 1) queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: '{}' })));
        else if (resetShouldFail) window.setTimeout(() => this.dispatchEvent(new Event('error')), 500);
      }
      close() { this.readyState = 3; }
    }
    Object.assign(window, { AudioContext: FakeAudioContext, AudioWorkletNode: FakeWorklet, WebSocket: FakeWebSocket });
  }, { label: microphoneLabel, resetShouldFail: failReset });
}

test('renders the local-only bridge transport definition list and recovery consequence', async ({ page }) => {
  await page.route('**/qualification-config', (route) => route.fulfill({ json: { machineId: 'fipwave-a', role: 'A', reportTarget: '/tmp/report.json', tunEvidence: 'none', evidenceMode: 'Loopback', evidenceClass: 'Loopback' } }));
  await page.goto('http://127.0.0.1:5173/');

  const liveStatus = page.getByRole('status');
  await expect(liveStatus).toHaveAttribute('aria-live', 'polite');
  await expect(liveStatus).toContainText('Idle · Local bridge: not connected');
  await expect(page.getByText('Role: A (gateway)', { exact: false })).toBeVisible();
  const card = page.getByRole('heading', { name: 'Bridge and FIPS transport' }).locator('..');
  await expect(card).toBeVisible();
  await expect(card.locator('dl')).toBeVisible();
  for (const label of ['Configuration', 'Browser audio', 'Local bridge', 'FIPS sound transport', 'Epoch', 'Queue health', 'Last accepted/error', 'Complete packets TX/RX', 'Sound MTU']) await expect(card.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText('No local bridge activity yet')).toBeVisible();
  await expect(page.getByText('Starts a new local epoch and clears unsent local bridge data.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset and reconnect' })).toBeVisible();
  await expect(page.getByText(/peer connected|ready for ping|sound link established/i)).toHaveCount(0);
});

test('keeps long safe content and diagnostic tables inside the viewport', async ({ page }) => {
  const longLabel = `Built-in microphone ${'very-long-public-device-label-'.repeat(10)}`;
  await mockBrowserAudio(page, longLabel);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: 'Arm modem' }).click();
  await expect(page.getByRole('cell', { name: longLabel })).toBeVisible();
  await page.getByRole('button', { name: 'Start Cyrinx qualification' }).click();
  const corpusCase = page.getByRole('cell', { name: 'fixture-epoch-1' });
  await expect(corpusCase).toBeVisible();
  await corpusCase.evaluate((node) => { node.textContent = `case-${'0123456789abcdef'.repeat(24)}`; });
  const lastAcceptedValue = page.getByText('Last accepted/error', { exact: true }).locator('xpath=following-sibling::dd[1]');
  await lastAcceptedValue.evaluate((node) => { node.textContent = `Bridge rejected ${'bounded_safe_reason_'.repeat(10).slice(0, 200)}.`; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole('searchbox', { name: 'Filter corpus cases' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Qualification corpus evidence' })).toBeVisible();
});

test('keeps recovery visible and disabled during reset, then restores retry after failure', async ({ page }) => {
  await mockBrowserAudio(page, 'Built-in microphone', true);
  await page.route('**/qualification-config', (route) => route.fulfill({ json: { machineId: 'fipwave-a', role: 'A', reportTarget: '/tmp/report.json', tunEvidence: 'none', evidenceMode: 'Loopback', evidenceClass: 'Loopback' } }));
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: 'Arm modem' }).click();
  const recovery = page.getByRole('button', { name: 'Reset and reconnect' });
  await recovery.click();
  await expect(recovery).toBeDisabled();
  await expect(page.getByText('Resetting local session…', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Reset and reconnect failed: Local bridge disconnected\./).first()).toBeVisible();
  await expect(recovery).toBeEnabled();
});

test('ignores a retiring socket RESET acknowledgement while the current socket resets', async ({ page }) => {
  await page.addInitScript(() => {
    const track = { label: 'Built-in microphone', getSettings: () => ({ sampleRate: 48_000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }), stop: () => undefined };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) } });
    class FakeAudioContext { state = 'suspended'; sampleRate = 48_000; currentTime = 0; destination = {}; audioWorklet = { addModule: async () => undefined }; async resume() { this.state = 'running'; } async close() { this.state = 'closed'; } createMediaStreamSource() { return { connect: () => undefined }; } createBuffer() { return { copyToChannel: () => undefined }; } createBufferSource() { return { connect: () => undefined, addEventListener: () => undefined, start: () => undefined, stop: () => undefined }; } }
    class FakeWorklet { port = { onmessage: null }; connect() { return {}; } disconnect() {} }
    class FakeWebSocket extends EventTarget {
      static instances: FakeWebSocket[] = [];
      binaryType = 'arraybuffer'; readyState = 0;
      constructor() { super(); FakeWebSocket.instances.push(this); queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }); }
      send(data?: ArrayBuffer) {
        const view = data instanceof ArrayBuffer ? new DataView(data) : undefined;
        if (view?.getUint8(5) === 8) {
          const ack = new ArrayBuffer(32); const bytes = new Uint8Array(ack); const ackView = new DataView(ack);
          bytes.set([0x46, 0x57, 0x41, 0x56]); ackView.setUint8(4, 1); ackView.setUint8(5, 8); ackView.setUint32(12, view.getUint32(12, true) + 1, true);
          const old = FakeWebSocket.instances[0]!; const current = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
          queueMicrotask(() => old.dispatchEvent(new MessageEvent('message', { data: ack })));
          queueMicrotask(() => current.dispatchEvent(new MessageEvent('message', { data: ack })));
          return;
        }
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: '{}' })));
      }
      close() { this.readyState = 3; }
    }
    Object.assign(window, { AudioContext: FakeAudioContext, AudioWorkletNode: FakeWorklet, WebSocket: FakeWebSocket, __retiringSockets: FakeWebSocket.instances });
  });
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: 'Arm modem' }).click();
  await expect(page.getByText('Audio preflight passed on this laptop.')).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __retiringSockets: Array<{ readyState: number }> }).__retiringSockets[0]!.readyState = 3; });
  await page.getByRole('button', { name: 'Reset and reconnect' }).click();
  await expect(page.getByText('Audio preflight passed on this laptop.')).toBeVisible();
  await expect(page.getByText(/Reset and reconnect failed|Local bridge disconnected/)).toHaveCount(0);
});
