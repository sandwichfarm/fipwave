import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { decodeFrame, encodeFrame, MAX_MESSAGE_BYTES, MessageType, PcmEncoding, RESET_ACK_FLAG } from '../src/protocol.js';
import { createBridgeServer, type BridgeServer, type PacketBridgeState } from '../src/server.js';

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

function packetBridgeState(bridge: BridgeServer): PacketBridgeState {
  return bridge.state() as unknown as PacketBridgeState;
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
    expect(packetBridgeState(bridge)).toMatchObject({
      packetEndpoints: { browser: 'ready', fips: 'ready', worker: 'waiting' },
      lastAcceptedAtMs: expect.any(Number),
    });
    expect(bridge.state()).toMatchObject({ evidenceClass: 'Loopback', acousticReady: false, peerConnected: false, pingReady: false });
    browser.close(); fips.close();
  });

  it('relays current-epoch browser arm and disconnect control to the local FIPS endpoint', async () => {
    const bridge = await createBridge();
    const browser = await openEndpoint(bridge.port, 'browser');
    const fips = await openEndpoint(bridge.port, 'fips');
    const armed = once(fips, 'message');
    browser.send(encodeFrame({ type: MessageType.AUDIO_SETTINGS, epoch: 1, sequence: 1n, payload: Buffer.alloc(0) }));
    const [armFrame] = await armed;
    expect(decodeFrame(Buffer.from(armFrame as Buffer))).toMatchObject({ type: MessageType.BROWSER_ARM, epoch: 1, payload: Buffer.alloc(0) });

    const disarmed = once(fips, 'message');
    browser.close();
    const [disarmFrame] = await disarmed;
    expect(decodeFrame(Buffer.from(disarmFrame as Buffer))).toMatchObject({ type: MessageType.BROWSER_DISARM, epoch: 1, payload: Buffer.alloc(0) });
    fips.close();
  });

  it('serves allowlisted bridge facts instead of browser-local transport estimates', async () => {
    const bridge = await createBridge();
    const response = await fetch(`http://127.0.0.1:${bridge.port}/bridge-status`);
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual(expect.objectContaining({
      role: 'A', configuration: 'ready', browserAudio: 'not-armed', localBridge: 'disconnected',
      soundTransport: 'waiting', epoch: 1, soundMtu: 1357, txPackets: 0, rxPackets: 0,
    }));
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

    expect(packetBridgeState(bridge)).toMatchObject({
      packetQueues: {
        browserToFips: { items: 0, bytes: 0, maxItems: 32, maxBytes: MAX_MESSAGE_BYTES, maxAgeMs: 5_000 },
        fipsToBrowser: { items: 0, bytes: 0, maxItems: 32, maxBytes: MAX_MESSAGE_BYTES, maxAgeMs: 5_000 },
      },
      lastError: { code: 'fips_destination_unavailable' },
      packetCounters: { browserToFips: 0, fipsToBrowser: 0 },
    });

    const error = packetBridgeState(bridge).lastError!;
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
    expect(packetBridgeState(controlBridge).lastError).toMatchObject({ code: 'control_payload_contains_packet_data' });
    expect(packetBridgeState(controlBridge).packetQueues.browserToFips.items).toBe(0);
  });

  it('makes reset the single epoch authority and broadcasts binary acknowledgements to both endpoint roles', async () => {
    const bridge = await createBridge();
    const browser = await openEndpoint(bridge.port, 'browser');
    const fips = await openEndpoint(bridge.port, 'fips');

    const initialToFips = once(fips, 'message');
    browser.send(packet(1, 1n, Buffer.alloc(8, 1)));
    await initialToFips;
    const initialToBrowser = once(browser, 'message');
    fips.send(packet(1, 1n, Buffer.alloc(8, 2)));
    await initialToBrowser;
    expect(bridge.state().packetCounters).toEqual({ browserToFips: 1, fipsToBrowser: 1 });

    const browserAck = once(browser, 'message');
    const fipsAck = once(fips, 'message');
    await expect(bridge.reset()).resolves.toBe(2);
    const [[browserReset], [fipsReset]] = await Promise.all([browserAck, fipsAck]);
    for (const reset of [browserReset, fipsReset]) {
      expect(decodeFrame(Buffer.from(reset as Buffer))).toMatchObject({ type: MessageType.RESET, epoch: 2, sequence: 0n, flags: RESET_ACK_FLAG });
    }
    expect(packetBridgeState(bridge)).toMatchObject({
      epoch: 2,
      rejectedFrames: 0,
      packetCounters: { browserToFips: 0, fipsToBrowser: 0 },
      packetReadiness: { browser: false, fips: false },
      packetEndpoints: { browser: 'ready', fips: 'ready', worker: 'waiting' },
      lastAcceptedAtMs: null,
      lastError: null,
      packetQueues: { browserToFips: { items: 0, bytes: 0 }, fipsToBrowser: { items: 0, bytes: 0 } },
    });

    const afterResetToFips = once(fips, 'message');
    browser.send(packet(2, 1n, Buffer.alloc(8, 3)));
    await afterResetToFips;
    const afterResetToBrowser = once(browser, 'message');
    fips.send(packet(2, 1n, Buffer.alloc(8, 4)));
    await afterResetToBrowser;
    expect(bridge.state().packetCounters).toEqual({ browserToFips: 1, fipsToBrowser: 1 });

    browser.send(encodeFrame({ type: MessageType.RESET, flags: RESET_ACK_FLAG, epoch: 2, sequence: 2n, payload: Buffer.alloc(0) }));
    await once(browser, 'close');
    expect(packetBridgeState(bridge).lastError).toMatchObject({ code: 'reset_ack_not_accepted' });
  });
});
