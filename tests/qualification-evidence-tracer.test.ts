import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { generateCorpus } from '../scripts/generate-corpus.mjs';
import { decodeFrame, encodeFrame, MessageType } from '../packages/bridge/src/protocol.js';
import { mergeSelection, readMachineReport, writeMachineReport, type MachineReport } from '../packages/bridge/src/report.js';

describe('qualification evidence tracer', () => {
  it('carries a committed 256-byte fixture case through FWAV and an atomic non-physical report', async () => {
    const entry = generateCorpus().cases.find((candidate: { size: number; direction: string }) => candidate.size === 256 && candidate.direction === 'A → B');
    expect(entry).toBeDefined();
    const frame = decodeFrame(encodeFrame({ type: MessageType.QUALIFICATION_CASE, epoch: 1, sequence: 1n, payload: Buffer.from(JSON.stringify(entry)) }));
    expect(JSON.parse(frame.payload.toString('utf8'))).toEqual(entry);
    const report: MachineReport = {
      schemaVersion: 1, capturedAt: '2026-07-23T10:00:00.000Z',
      machine: { hostName: 'fixture', os: 'test', architecture: 'test', browserVersion: 'test', commit: 'test' },
      evidenceClass: 'Fixture', epoch: 1,
      codec: { commit: 'fixture', profile: 'fixture', advertisedMtu: 1357 },
      audio: { contextSampleRate: 48_000, captureSampleRate: 48_000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      queues: { captureHighWaterBytes: 0, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 },
      results: [{ epoch: 1, direction: entry.direction, caseId: entry.id, digest: entry.sha256, acquisitionMs: 0, airtimeMs: 0, deliveryCount: 1, bytePerfect: true }], complete: true,
    };
    const reportPath = path.join(await mkdtemp(path.join(tmpdir(), 'fipwave-tracer-')), 'fixture.json');
    await writeMachineReport(reportPath, report);
    const persisted = await readMachineReport(reportPath);
    expect(mergeSelection(['fixture', 'other'], persisted, persisted)).toMatchObject({ decision: 'human_needed' });
  });
});
