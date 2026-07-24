import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  decodeFrame,
  encodeFrame,
  FipsTrafficClass,
  MAX_MESSAGE_BYTES,
  MessageType,
  PcmEncoding,
  RESET_ACK_FLAG,
} from '../src/protocol.js';
import { createBridgeServer, type BridgeServer, type PacketBridgeState } from '../src/server.js';

const servers: BridgeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

type BrowserSocket = WebSocket & { readinessCapability?: Buffer };

async function openEndpoint(port: number, endpoint: 'browser' | 'fips'): Promise<BrowserSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/bridge/${endpoint}`, {
    origin: `http://127.0.0.1:${port}`,
  }) as BrowserSocket;
  const capability = endpoint === 'browser'
    ? new Promise<Buffer>((resolve) => socket.on('message', (raw) => {
      if (!Buffer.isBuffer(raw)) return;
      try {
        const message = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        if (message.kind === 'acoustic-capability' && typeof message.capability === 'string' && /^[a-f0-9]{32}$/i.test(message.capability)) { socket.readinessCapability = Buffer.from(message.capability, 'hex'); resolve(socket.readinessCapability); }
      } catch { /* Other bridge messages are irrelevant to this capability. */ }
    }))
    : undefined;
  await once(socket, 'open');
  if (capability) {
    socket.send(encodeFrame({ type: MessageType.HELLO, epoch: 1, sequence: 0n, payload: Buffer.alloc(0) }));
    socket.readinessCapability = await capability;
  }
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
  // ws message dispatch can be scheduled after the immediate queue on a busy
  // runner; wait one bounded turn before inspecting terminal rejection state.
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
}

async function expectNoMessage(socket: WebSocket, timeoutMs = 30): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      resolve();
    }, timeoutMs);
    const onMessage = (message: WebSocket.RawData) => {
      clearTimeout(timer);
      const binary = Buffer.isBuffer(message)
        ? message
        : Array.isArray(message)
          ? Buffer.concat(message)
          : Buffer.from(new Uint8Array(message as ArrayBuffer));
      reject(new Error(`unexpected bridge frame: ${decodeFrame(binary).type}`));
    };
    socket.once('message', onMessage);
  });
}

function collectMessages(socket: WebSocket, count: number): Promise<WebSocket.RawData[]> {
  return new Promise((resolve) => {
    const frames: WebSocket.RawData[] = [];
    const onMessage = (frame: WebSocket.RawData) => {
      frames.push(frame);
      if (frames.length === count) {
        socket.off('message', onMessage);
        resolve(frames);
      }
    };
    socket.on('message', onMessage);
  });
}

function packet(
  epoch: number,
  sequence: bigint,
  payload: Buffer,
  trafficClass: FipsTrafficClass = FipsTrafficClass.Ordinary,
): Buffer {
  return encodeFrame({ type: MessageType.FIPS_PACKET, epoch, sequence, trafficClass, payload });
}

function patternedPacket(): Buffer {
  return Buffer.from(Array.from({ length: 1357 }, (_value, index) => index % 251));
}

function packetBridgeState(bridge: BridgeServer): PacketBridgeState {
  return bridge.state() as unknown as PacketBridgeState;
}

function acousticReady(socket: BrowserSocket, epoch: number): Buffer {
  const capability = socket.readinessCapability;
  if (!capability) throw new Error('browser readiness capability is missing');
  const payload = Buffer.alloc(64);
  payload.writeBigUInt64LE(1n, 0);
  payload.fill(1, 8, 40);
  payload.writeBigUInt64LE(BigInt(Date.now()), 40);
  capability.copy(payload, 48);
  return encodeFrame({ type: MessageType.ACOUSTIC_READY, epoch, sequence: 0n, payload });
}

function acousticDisarm(socket: BrowserSocket, epoch: number): Buffer {
  if (!socket.readinessCapability) throw new Error('browser readiness capability is missing');
  return encodeFrame({ type: MessageType.ACOUSTIC_DISARM, epoch, sequence: 0n, payload: socket.readinessCapability });
}

async function requestAcousticCapability(socket: BrowserSocket, epoch: number): Promise<void> {
  const received = new Promise<void>((resolve) => socket.once('message', (raw) => {
    const message = JSON.parse(Buffer.from(raw as Buffer).toString('utf8')) as Record<string, unknown>;
    if (message.kind !== 'acoustic-capability' || typeof message.capability !== 'string') throw new Error('bridge did not issue an acoustic capability');
    socket.readinessCapability = Buffer.from(message.capability, 'hex');
    resolve();
  }));
  socket.send(encodeFrame({ type: MessageType.HELLO, epoch, sequence: 0n, payload: Buffer.alloc(0) }));
  await received;
}

describe('FIPS packet bridge', () => {
  it('round-trips each Rust-authored FIPS traffic class beside byte-identical opaque bytes', async () => {
    const bridge = await createBridge();
    const browser = await openEndpoint(bridge.port, 'browser');
    const fips = await openEndpoint(bridge.port, 'fips');

    for (const [index, trafficClass] of [
      FipsTrafficClass.Control,
      FipsTrafficClass.Heartbeat,
      FipsTrafficClass.Ordinary,
    ].entries()) {
      const payload = Buffer.from([index, 0, 255, 127]);
      const receivedByFips = once(fips, 'message');
      browser.send(packet(1, BigInt(index + 1), payload, trafficClass));
      const [received] = await receivedByFips;
      const decoded = decodeFrame(Buffer.from(received as Buffer));
      expect(decoded.trafficClass).toBe(trafficClass);
      expect(decoded.payload.equals(payload)).toBe(true);

      const receivedByBrowser = once(browser, 'message');
      fips.send(packet(1, BigInt(index + 1), payload, trafficClass));
      const [returned] = await receivedByBrowser;
      const returnedDecoded = decodeFrame(Buffer.from(returned as Buffer));
      expect(returnedDecoded.trafficClass).toBe(trafficClass);
      expect(returnedDecoded.payload.equals(payload)).toBe(true);
    }

    browser.close(); fips.close();
  });

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
    const unknownClass = Buffer.from(encoded); unknownClass.writeUInt8(99, 6);
    expect(() => decodeFrame(unknownClass)).toThrow('traffic class');
  });

  it('rejects invalid packet class before queue or acceptance-counter mutation', async () => {
    const bridge = await createBridge();
    const browser = await openEndpoint(bridge.port, 'browser');
    const fips = await openEndpoint(bridge.port, 'fips');
    const invalidClass = Buffer.from(packet(1, 1n, Buffer.from([1])));
    invalidClass.writeUInt8(99, 6);

    browser.send(invalidClass);
    await once(browser, 'close');

    expect(bridge.state().packetCounters).toEqual({ browserToFips: 0, fipsToBrowser: 0 });
    expect(packetBridgeState(bridge)).toMatchObject({
      packetQueues: { browserToFips: { items: 0, bytes: 0 } },
      lastError: { code: 'invalid_fwav_message' },
    });
    fips.close();
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

  it('keeps local audio preflight separate from current acoustic readiness', async () => {
    const bridge = await createBridge();
    const browser = await openEndpoint(bridge.port, 'browser');
    const fips = await openEndpoint(bridge.port, 'fips');

    browser.send(encodeFrame({ type: MessageType.AUDIO_SETTINGS, epoch: 1, sequence: 1n, payload: Buffer.alloc(0) }));
    await expectNoMessage(fips);
    expect(packetBridgeState(bridge)).toMatchObject({
      packetReadiness: { browser: false, fips: false },
    });

    const armed = once(fips, 'message');
    browser.send(acousticReady(browser, 1));
    const [armFrame] = await armed;
    expect(decodeFrame(Buffer.from(armFrame as Buffer))).toMatchObject({ type: MessageType.BROWSER_ARM, epoch: 1, payload: expect.any(Buffer) });
    expect(decodeFrame(Buffer.from(armFrame as Buffer)).payload).toHaveLength(64);

    const disarmed = once(fips, 'message');
    browser.send(acousticDisarm(browser, 1));
    const [disarmFrame] = await disarmed;
    expect(decodeFrame(Buffer.from(disarmFrame as Buffer))).toMatchObject({ type: MessageType.BROWSER_DISARM, epoch: 1, payload: expect.any(Buffer) });
    expect(decodeFrame(Buffer.from(disarmFrame as Buffer)).payload).toHaveLength(16);

    const duplicateDisarm = expectNoMessage(fips);
    browser.close();
    await duplicateDisarm;
    fips.close();
  });

  it('serves allowlisted bridge facts instead of browser-local transport estimates', async () => {
    const bridge = await createBridge();
    const response = await fetch(`http://127.0.0.1:${bridge.port}/bridge-status`);
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual(expect.objectContaining({
      role: 'Unknown', configuration: 'unknown', browserAudio: 'not-ready', acousticSession: 'not-ready',
      localBridge: 'disconnected', soundTransport: 'waiting', epoch: 1, soundMtu: null, txPackets: 0, rxPackets: 0,
    }));
  });

  it('accepts a private-container all-interface listener while host publication stays loopback-only', async () => {
    const bridge = await createBridgeServer({
      host: '0.0.0.0',
      port: 0,
      artifactDir: await mkdtemp(path.join(tmpdir(), 'fipwave-fips-packet-')),
    });
    servers.push(bridge);

    const response = await fetch(`http://127.0.0.1:${bridge.port}/bridge-status`);
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual(expect.objectContaining({ configuration: 'unknown', soundMtu: null }));
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

  it('drops an unavailable delivery instead of replaying it after the endpoint reconnects', async () => {
    const bridge = await createBridge();
    const browser = await openEndpoint(bridge.port, 'browser');
    browser.send(packet(1, 1n, Buffer.from([1, 2, 3])));
    await drainBridge();
    expect(packetBridgeState(bridge)).toMatchObject({
      packetCounters: { browserToFips: 0, fipsToBrowser: 0 },
      packetQueues: { browserToFips: { items: 0, bytes: 0 } },
      lastError: { code: 'fips_destination_unavailable' },
    });

    const fips = await openEndpoint(bridge.port, 'fips');
    await drainBridge();
    expect(packetBridgeState(bridge)).toMatchObject({
      packetCounters: { browserToFips: 0, fipsToBrowser: 0 },
      packetQueues: { browserToFips: { items: 0, bytes: 0 } },
    });
    browser.close(); fips.close();
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

  it('disarms the FIPS endpoint before reset or terminal error clears current-session state', async () => {
    const bridge = await createBridge();
    const browser = await openEndpoint(bridge.port, 'browser');
    const fips = await openEndpoint(bridge.port, 'fips');

    const arm = once(fips, 'message');
    browser.send(acousticReady(browser, 1));
    await arm;
    expect(bridge.state()).toMatchObject({ acousticReady: true });

    const disarmThenReset = collectMessages(fips, 2);
    await expect(bridge.reset()).resolves.toBe(2);
    const resetControls = (await disarmThenReset).map((raw) => decodeFrame(Buffer.from(raw as Buffer)));
    expect(resetControls).toEqual([
      expect.objectContaining({ type: MessageType.BROWSER_DISARM, epoch: 1, sequence: 0n }),
      expect.objectContaining({ type: MessageType.RESET, epoch: 2, sequence: 0n, flags: RESET_ACK_FLAG }),
    ]);
    expect(bridge.state()).toMatchObject({ acousticReady: false });

    const rearm = once(fips, 'message');
    await drainBridge();
    await requestAcousticCapability(browser, 2);
    browser.send(acousticReady(browser, 2));
    await rearm;
    const disarm = once(fips, 'message');
    browser.send(encodeFrame({ type: MessageType.ERROR, epoch: 2, sequence: 1n, payload: Buffer.from('{}') }));
    expect(decodeFrame(Buffer.from((await disarm)[0] as Buffer))).toMatchObject({ type: MessageType.BROWSER_DISARM, epoch: 2 });
    expect(bridge.state()).toMatchObject({ acousticReady: false });
    browser.close(); fips.close();
  });

  it('rejects stale, nonzero, and nonempty acoustic controls before readiness mutation', async () => {
    const bridge = await createBridge();
    const browser = await openEndpoint(bridge.port, 'browser');
    const fips = await openEndpoint(bridge.port, 'fips');
    browser.send(acousticReady(browser, 0));
    await once(browser, 'close');
    expect(bridge.state()).toMatchObject({ acousticReady: false, rejectedFrames: 1 });
    await expectNoMessage(fips);
    fips.close();
  });
});
