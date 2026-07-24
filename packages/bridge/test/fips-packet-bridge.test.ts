import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { decodeFrame, encodeFrame, MAX_MESSAGE_BYTES, MessageType, PcmEncoding } from '../src/protocol.js';
import { createBridgeServer, type BridgeServer } from '../src/server.js';

const servers: BridgeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function openEndpoint(port: number, endpoint: 'browser' | 'fips'): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/bridge/${endpoint}`, {
    origin: `http://127.0.0.1:${port}`,
  });
  await once(socket, 'open');
  return socket;
}

async function createBridge(): Promise<BridgeServer> {
  const bridge = await createBridgeServer({
    host: '127.0.0.1',
    port: 0,
    artifactDir: await mkdtemp(path.join(tmpdir(), 'fipwave-fips-packet-')),
  });
  servers.push(bridge);
  return bridge;
}

async function drainBridge(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function packet(epoch: number, sequence: bigint, payload: Buffer): Buffer {
  return encodeFrame({ type: MessageType.FIPS_PACKET, epoch, sequence, payload });
}

function patternedPacket(): Buffer {
  return Buffer.from(Array.from({ length: 1357 }, (_value, index) => index % 251));
}

describe('FIPS packet bridge', () => {
  it('round-trips opaque packets without PCM metadata and rejects malformed packet frames', () => {
    const payload = patternedPacket();
    const encoded = packet(1, 9n, payload);
    const decoded = decodeFrame(encoded);

    expect(decoded).toMatchObject({ type: MessageType.FIPS_PACKET, epoch: 1, sequence: 9n, sampleRate: 0, channels: 0, encoding: PcmEncoding.NONE });
    expect(decoded.payload.equals(payload)).toBe(true);
    expect(() => encodeFrame({ type: MessageType.FIPS_PACKET, epoch: 1, sequence: 1n, sampleRate: 48_000, payload })).toThrow('non-PCM');
    const unknown = Buffer.from(encoded); unknown.writeUInt8(99, 5);
    expect(() => decodeFrame(unknown)).toThrow('unsupported');
    const wrongLength = Buffer.from(encoded); wrongLength.writeUInt32LE(payload.byteLength - 1, 8);
    expect(() => decodeFrame(wrongLength)).toThrow('declared payload length');
    expect(() => packet(1, 1n, Buffer.alloc(MAX_MESSAGE_BYTES))).toThrow('256 KiB');
  });

  it('relays exactly 1357 opaque bytes in both directions for distinct endpoint roles', async () => {
    const bridge = await createBridge();
    const browser = await openEndpoint(bridge.port, 'browser');
    const fips = await openEndpoint(bridge.port, 'fips');
    const payload = patternedPacket();

    const receivedByFips = once(fips, 'message');
    browser.send(packet(1, 1n, payload));
    const [toFips] = await receivedByFips;
    expect(decodeFrame(Buffer.from(toFips as Buffer)).payload.equals(payload)).toBe(true);

    const receivedByBrowser = once(browser, 'message');
    fips.send(packet(1, 1n, payload));
    const [toBrowser] = await receivedByBrowser;
    expect(decodeFrame(Buffer.from(toBrowser as Buffer)).payload.equals(payload)).toBe(true);

    expect(bridge.state().packetCounters).toEqual({ browserToFips: 1, fipsToBrowser: 1 });
    expect(bridge.state()).toMatchObject({ evidenceClass: 'Loopback', acousticReady: false, peerConnected: false, pingReady: false });
    browser.close(); fips.close();
  });

  it('rejects text, wrong-role, stale, and unavailable-destination input before accepted delivery counters change', async () => {
    const bridge = await createBridge();
    const browser = await openEndpoint(bridge.port, 'browser');
    browser.send('not a binary packet');
    await once(browser, 'close');

    const wrongRole = await openEndpoint(bridge.port, 'fips');
    wrongRole.send(encodeFrame({ type: MessageType.PCM_CAPTURE, epoch: 1, sequence: 1n, sampleRate: 48_000, channels: 1, encoding: PcmEncoding.FLOAT32_LE, payload: Buffer.alloc(12) }));
    await once(wrongRole, 'close');

    const stale = await openEndpoint(bridge.port, 'fips');
    stale.send(packet(0, 1n, Buffer.alloc(1)));
    await once(stale, 'close');

    expect(bridge.state().packetCounters).toEqual({ browserToFips: 0, fipsToBrowser: 0 });
    expect(bridge.state().rejectedFrames).toBeGreaterThanOrEqual(3);
  });

  it('exposes bounded per-direction packet queues and safely rejects unavailable or bulk-control input', async () => {
    const bridge = await createBridge();
    const browser = await openEndpoint(bridge.port, 'browser');
    browser.send(packet(1, 1n, Buffer.alloc(64)));
    await drainBridge();

    expect(bridge.state()).toMatchObject({
      packetQueues: {
        browserToFips: { items: 0, bytes: 0, maxItems: 32, maxBytes: MAX_MESSAGE_BYTES, maxAgeMs: 5_000 },
        fipsToBrowser: { items: 0, bytes: 0, maxItems: 32, maxBytes: MAX_MESSAGE_BYTES, maxAgeMs: 5_000 },
      },
      lastError: { code: 'fips_destination_unavailable' },
      packetCounters: { browserToFips: 0, fipsToBrowser: 0 },
    });

    const error = bridge.state().lastError!;
    expect(error.message).toMatch(/^[^\r\n]{1,240}$/);
    expect(error.message).not.toContain('64');

    const controlBridge = await createBridge();
    const control = await openEndpoint(controlBridge.port, 'browser');
    control.send(encodeFrame({
      type: MessageType.QUALIFICATION_CASE,
      epoch: 1,
      sequence: 1n,
      payload: Buffer.from(JSON.stringify({ action: 'start_cyrinx', packet: Buffer.alloc(64).toString('base64') })),
    }));
    await drainBridge();
    expect(controlBridge.state().lastError).toMatchObject({ code: 'control_payload_contains_packet_data' });
    expect(controlBridge.state().packetQueues.browserToFips.items).toBe(0);
  });
});
