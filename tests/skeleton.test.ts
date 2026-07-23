import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  AUDIO_SETTINGS_MESSAGE_TYPE,
  MAX_MESSAGE_BYTES,
  createBridgeServer,
  parseAudioSettingsFrame,
  readQualificationReport,
  type BridgeServer,
} from '../packages/bridge/src/server.js';

const servers: BridgeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function audioSettingsFrame(payload = Buffer.from([0x01, 0x00])): Buffer {
  const frame = Buffer.alloc(32 + payload.length);
  frame.write('FWAV', 0, 'ascii');
  frame.writeUInt8(1, 4);
  frame.writeUInt8(AUDIO_SETTINGS_MESSAGE_TYPE, 5);
  frame.writeUInt32LE(payload.length, 8);
  frame.writeUInt32LE(7, 12);
  frame.writeBigUInt64LE(11n, 16);
  payload.copy(frame, 32);
  return frame;
}

async function openLoopbackSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/bridge`, {
    origin: `http://localhost:${port}`,
  });
  await once(socket, 'open');
  return socket;
}

describe('walking skeleton', () => {
  it('sends one FWAV binary settings frame through loopback and reads a non-physical report', async () => {
    const artifactDir = await mkdtemp(path.join(tmpdir(), 'fipwave-skeleton-'));
    const bridge = await createBridgeServer({ host: '127.0.0.1', port: 0, artifactDir });
    servers.push(bridge);

    const page = await fetch(`http://127.0.0.1:${bridge.port}/`);
    expect(await page.text()).toContain('Arm modem');

    const socket = await openLoopbackSocket(bridge.port);
    const reportMessage = once(socket, 'message');
    socket.send(audioSettingsFrame());
    const [rawReport] = await reportMessage;
    socket.close();

    const { reportPath } = JSON.parse(Buffer.from(rawReport as Buffer).toString('utf8')) as {
      reportPath: string;
    };
    const report = await readQualificationReport(reportPath);

    expect(report).toMatchObject({
      schemaVersion: 1,
      evidencePath: 'Loopback',
      physicalQualification: false,
      qualificationStatus: 'not-physical',
    });
    expect(await readdir(artifactDir)).toEqual(['loopback-qualification.json']);
  });

  it('fails closed for non-loopback servers and malformed, mismatched, or oversized frames', async () => {
    await expect(
      createBridgeServer({ host: '0.0.0.0' as never, port: 0, artifactDir: tmpdir() }),
    ).rejects.toThrow('127.0.0.1');

    const malformed = audioSettingsFrame();
    malformed.write('NOPE', 0, 'ascii');
    expect(() => parseAudioSettingsFrame(malformed)).toThrow('magic');

    const mismatchedLength = audioSettingsFrame();
    mismatchedLength.writeUInt32LE(9, 8);
    expect(() => parseAudioSettingsFrame(mismatchedLength)).toThrow('length');

    expect(() => parseAudioSettingsFrame(Buffer.alloc(MAX_MESSAGE_BYTES + 1))).toThrow('256 KiB');
  });
});
