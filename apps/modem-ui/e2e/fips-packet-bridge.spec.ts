import { expect, test } from '@playwright/test';

function packet(epoch: number, payload: number[]): number[] {
  const bytes = new Uint8Array(32 + payload.length); const view = new DataView(bytes.buffer);
  bytes.set([0x46, 0x57, 0x41, 0x56]); view.setUint8(4, 1); view.setUint8(5, 9); view.setUint32(8, payload.length, true); view.setUint32(12, epoch, true); view.setBigUint64(16, 1n, true); bytes.set(payload, 32);
  return [...bytes];
}

test('armed browser packet boundary preserves complete bytes and rejects pre-arm traffic', async ({ page }) => {
  await page.addInitScript(() => {
    const track = { label: 'Test microphone', getSettings: () => ({ sampleRate: 48_000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }), stop: () => undefined };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) } });
    class FakeAudioContext { state = 'suspended'; sampleRate = 48_000; destination = {}; audioWorklet = { addModule: async () => undefined }; async resume() { this.state = 'running'; } async close() { this.state = 'closed'; } createMediaStreamSource() { return { connect: () => undefined }; } createBuffer() { return { copyToChannel: () => undefined }; } createBufferSource() { return { connect: () => undefined, addEventListener: () => undefined, start: () => undefined, stop: () => undefined }; } }
    class FakeWorklet { port = { onmessage: null }; connect() { return {}; } disconnect() {} }
    class FakeWebSocket extends EventTarget {
      static instance: FakeWebSocket | undefined; binaryType = 'arraybuffer'; sent: ArrayBuffer[] = [];
      constructor() { super(); FakeWebSocket.instance = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
      send(value: ArrayBuffer) { this.sent.push(value); if (new DataView(value).getUint8(5) === 2) queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ reportPath: '/tmp/loopback.json' }) }))); }
      close() {}
    }
    Object.assign(window, { AudioContext: FakeAudioContext, AudioWorkletNode: FakeWorklet, WebSocket: FakeWebSocket, __fipsTestSocket: () => FakeWebSocket.instance });
  });
  await page.route('**/qualification-config', (route) => route.fulfill({ json: { machineId: 'fipwave-a', role: 'A', reportTarget: '/tmp/report.json', tunEvidence: 'none', evidenceMode: 'Loopback', evidenceClass: 'Loopback' } }));
  await page.goto('http://127.0.0.1:5173/');

  const beforeArm = await page.evaluate(() => {
    const received: number[][] = []; window.addEventListener('fips-packet-received', (event) => received.push([...(event as CustomEvent<Uint8Array>).detail]));
    const socket = (window as unknown as { __fipsTestSocket: () => { dispatchEvent(event: Event): boolean } | undefined }).__fipsTestSocket();
    socket?.dispatchEvent(new MessageEvent('message', { data: new Uint8Array([0]).buffer }));
    return received;
  });
  expect(beforeArm).toEqual([]);

  await page.getByRole('button', { name: 'Arm modem' }).click();
  await expect(page.getByText('Audio preflight passed on this laptop.')).toBeVisible();
  const payload = [0, 1, 2, 255];
  const observed = await page.evaluate((incoming) => new Promise<number[]>((resolve) => {
    window.addEventListener('fips-packet-received', (event) => resolve([...(event as CustomEvent<Uint8Array>).detail]), { once: true });
    const socket = (window as unknown as { __fipsTestSocket: () => { dispatchEvent(event: Event): boolean } }).__fipsTestSocket();
    socket.dispatchEvent(new MessageEvent('message', { data: new Uint8Array(incoming).buffer }));
  }), packet(1, payload));
  expect(observed).toEqual(payload);
  const emitted = await page.evaluate((value) => {
    window.dispatchEvent(new CustomEvent('fips-packet-send', { detail: new Uint8Array(value) }));
    const socket = (window as unknown as { __fipsTestSocket: () => { sent: ArrayBuffer[] } }).__fipsTestSocket();
    return [...new Uint8Array(socket.sent.at(-1)!)] ;
  }, payload);
  expect(emitted).toEqual(packet(1, payload));
});
