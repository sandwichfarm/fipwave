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

function packet(epoch: number, sequence: bigint, payload: Buffer): Buffer {
  return encodeFrame({ type: MessageType.FIPS_PACKET, epoch, sequence, payload });
}

describe('FIPS packet bridge', () => {
  it('round-trips opaque packets without PCM metadata and rejects malformed packet frames', () => {
    const payload = Buffer.alloc(1357, (index) => index % 251);
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
    const payload = Buffer.alloc(1357, (index) => index % 251);

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

  it('rejects text, wrong-role, stale, and queue-overflow input before accepted delivery counters change', async () => {
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

    const queueFill = await openEndpoint(bridge.port, 'fips');
    queueFill.send(packet(1, 1n, Buffer.alloc(MAX_MESSAGE_BYTES - 32)));
    queueFill.send(packet(1, 2n, Buffer.alloc(1)));
    await once(queueFill, 'close');

    expect(bridge.state().packetCounters).toEqual({ browserToFips: 0, fipsToBrowser: 0 });
    expect(bridge.state().rejectedFrames).toBeGreaterThanOrEqual(4);
    expect(bridge.state().overflowedQueues).toContain('FIPS_PACKET_TO_BROWSER');
  });
});
