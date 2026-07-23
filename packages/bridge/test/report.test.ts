import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { mergeSelection, readMachineReport, validateMachineReport, writeMachineReport, type MachineReport } from '../src/report.js';

function report(hostName = 'alpha', evidenceClass: MachineReport['evidenceClass'] = 'Open air'): MachineReport {
  return {
    schemaVersion: 1,
    capturedAt: '2026-07-23T10:00:00.000Z',
    machine: { hostName, os: 'macOS', architecture: 'arm64', browserVersion: 'Chromium 1', commit: 'abc123' },
    evidenceClass,
    epoch: 3,
    codec: { commit: 'codec-1', profile: 'audible-fast', advertisedMtu: 1357 },
    audio: { contextSampleRate: 48_000, captureSampleRate: 48_000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    queues: { captureHighWaterBytes: 1, captureHighWaterMs: 1, playbackHighWaterBytes: 1, playbackHighWaterMs: 1, discontinuities: 0 },
    results: [{ epoch: 3, direction: 'A → B', caseId: 'case-a', digest: 'a'.repeat(64), acquisitionMs: 1, airtimeMs: 1, deliveryCount: 1, bytePerfect: true }],
    complete: true,
  };
}

describe('canonical qualification reports', () => {
  it('persists validated reports atomically', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-report-'));
    const reportPath = path.join(directory, 'alpha.json');
    await writeMachineReport(reportPath, report());
    expect(await readMachineReport(reportPath)).toEqual(report());
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual(report());
  });

  it('rejects incomplete, duplicate, stale, and malformed evidence', () => {
    expect(() => validateMachineReport({ ...report(), complete: false })).toThrow('complete');
    expect(() => validateMachineReport({ ...report(), results: [...report().results, report().results[0]!] })).toThrow('duplicate');
    expect(() => validateMachineReport({ ...report(), results: [{ ...report().results[0]!, epoch: 2 }] })).toThrow('stale');
    expect(() => validateMachineReport({ ...report(), machine: { ...report().machine, hostName: '' } })).toThrow('host');
    expect(() => validateMachineReport({ ...report(), queues: { ...report().queues, playbackHighWaterBytes: 256 * 1024 + 1 } })).toThrow('bound');
  });

  it('fails closed unless named exact hosts have unique Open air evidence', () => {
    const alpha = report('alpha');
    const beta = report('beta');
    expect(mergeSelection(['alpha', 'beta'], alpha, beta)).toMatchObject({ decision: 'selected' });
    expect(mergeSelection(['alpha', 'beta'], alpha, report('beta', 'Fixture'))).toMatchObject({ decision: 'human_needed' });
    expect(mergeSelection(['alpha', 'beta'], alpha, report('other'))).toMatchObject({ decision: 'human_needed' });
  });
});
