import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { CyrinxBatchWorker } from '../packages/bridge/src/cyrinx-worker.js';
import { encodeFrame, encodePcmPayload, MessageType, PcmEncoding } from '../packages/bridge/src/protocol.js';

const payload = new Uint8Array(256).fill(7); const digest = createHash('sha256').update(payload).digest('hex');
function decoded(meta: Buffer) { const out = Buffer.alloc(289 + payload.byteLength); out.write('CYRR'); out.writeUInt8(1, 4); out.writeUInt32LE(payload.byteLength, 5); out.writeUInt32LE(7, 9); out.writeUInt32LE(7, 13); out.writeUInt32LE(0, 17); out.writeUInt32LE(1302, 21); meta.copy(out, 33); Buffer.from(payload).copy(out, 289); return out; }

describe('bounded Cyrinx worker', () => {
  it('emits one modem-only playback frame and one result after a bounded multi-frame capture window', async () => {
    let capturedMetadata!: Buffer;
    const worker = new CyrinxBatchWorker({ executable: '/pinned/cyrinx', now: () => 1000, run: async ({ command, payload: input }) => {
      if (command === 'encode') { capturedMetadata = Buffer.from(input.subarray(4, 260)); return { exitCode: 0, stdout: Buffer.alloc(249856), stderr: '', timedOut: false }; }
      return { exitCode: 0, stdout: decoded(capturedMetadata), stderr: '', timedOut: false };
    } });
    const playback = await worker.begin({ id: 'a-to-b-256-01', direction: 'A → B', payload, digest }, 4);
    expect(playback.byteLength).toBe(249896);
    const capture = (sequence: bigint, samples: number) => encodeFrame({ type: MessageType.PCM_CAPTURE, epoch: 4, sequence, sampleRate: 48000, channels: 1, encoding: PcmEncoding.FLOAT32_LE, payload: encodePcmPayload(sequence * BigInt(samples), Buffer.alloc(samples * 4)) });
    expect(await worker.receiveCapture(capture(1n, 48000))).toBeUndefined();
    expect(await worker.receiveCapture(capture(2n, 48000))).toMatchObject({ caseId: 'a-to-b-256-01', complete: true, deliveryCount: 1, airtimeMs: 1302 });
  });
});
