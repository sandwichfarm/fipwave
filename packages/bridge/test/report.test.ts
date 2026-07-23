import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import manifest from '../../../fixtures/corpus/manifest.json' with { type: 'json' };
import {
  CYRINX_DEADLINE_MS,
  QUALIFICATION_DEAD_LINK_TIMEOUT_MS,
  QUIET_CODEC,
  mergeSelection,
  readMachineReport,
  validateMachineReport,
  validateTunEvidence,
  writeMachineReport,
  type MachineReport,
  type TunEvidence,
} from '../src/report.js';

function exactTun(): TunEvidence {
  return { schemaVersion: 1, source: 'exact_host', status: 'passed', image: 'alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c', interfaceName: 'fips-preflight0', ipv6Address: 'fd42:6677:6677::1/64', authorities: { devices: ['/dev/net/tun'], capabilities: ['NET_ADMIN'], securityOptions: ['no-new-privileges:true'], privileged: false, networkMode: 'none', publishedPorts: [] }, checks: { imagePinned: 'passed', tunDevice: 'passed', netAdmin: 'passed', noNewPrivileges: 'passed', notPrivileged: 'passed', sysAdminAbsent: 'passed', hostNetworkAbsent: 'passed', loopbackPortsOnly: 'passed', interfaceCreated: 'passed', ipv6Assigned: 'passed', cleanupComplete: 'passed' }, errors: [] };
}

function report(hostName: string, role: 'A' | 'B', options: {
  evidenceClass?: MachineReport['evidenceClass'];
  small?: number;
  corruptCase?: boolean;
  duplicateCase?: boolean;
  codec?: MachineReport['codec'];
  commit?: string;
  p95Boundary?: boolean;
} = {}): MachineReport {
  const evidenceClass = options.evidenceClass ?? 'Open air';
  const direction = role === 'A' ? 'B → A' : 'A → B';
  const small = options.small ?? 19;
  const selected = (manifest.cases as Array<{ id: string; direction: 'A → B' | 'B → A'; size: 256 | 1536; sha256: string }>).filter((entry) => entry.direction === direction);
  const results = selected.map((entry, index) => {
    const observed = entry.size === 1536 || Number(entry.id.slice(-2)) <= small;
    return ({
    epoch: 3,
    direction: entry.direction,
    caseId: entry.id,
    size: entry.size,
    expectedSha256: entry.sha256,
    receivedSha256: !observed ? null : options.corruptCase && index === 0 ? 'f'.repeat(64) : entry.sha256,
    acquisitionMs: 1,
    airtimeMs: options.p95Boundary && index >= selected.length - 2 ? QUALIFICATION_DEAD_LINK_TIMEOUT_MS / 3 : 1,
    deliveryCount: !observed ? 0 : options.duplicateCase && index === 0 ? 2 : 1,
    bytePerfect: observed && !(options.corruptCase && index === 0),
    coldAcquired: observed && index === 0,
    observed,
    complete: observed,
    corrupt: Boolean(options.corruptCase && index === 0),
    missing: observed ? 0 : 1,
    duplicates: options.duplicateCase && index === 0 ? 1 : 0,
  }); });
  const complete = small >= 19 && !options.corruptCase && !options.duplicateCase && !options.p95Boundary;
  return {
    schemaVersion: 1,
    capturedAt: '2026-07-23T10:00:00.000Z',
    machine: { hostName, os: 'macOS', architecture: 'arm64', browserVersion: 'Chromium 1', commit: options.commit ?? 'a'.repeat(40) },
    evidenceClass,
    epoch: 3,
    codec: options.codec ?? { ...QUIET_CODEC },
    audio: { microphoneLabel: 'Test microphone', contextState: 'running', inputDeviceSampleRate: 48_000, contextSampleRate: 48_000, captureSampleRate: 48_000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    queues: { captureHighWaterBytes: 1, captureHighWaterMs: 1, playbackHighWaterBytes: 1, playbackHighWaterMs: 1, discontinuities: 0 },
    results,
    complete,
    reasonCodes: complete ? [] : ['corpus_incomplete'],
    qualification: {
      deadLinkTimeoutMs: QUALIFICATION_DEAD_LINK_TIMEOUT_MS,
      cyrinxDeadlineMs: CYRINX_DEADLINE_MS,
      deadline: { startedAtMs: 1_000, deadlineAtMs: 1_000 + CYRINX_DEADLINE_MS, elapsedMs: 100 },
      physicalGate: evidenceClass === 'Open air' ? (complete ? 'passed' : 'failed') : 'not_physical',
      fallback: { codecId: 'quiet', state: 'activated', reasonCode: 'cyrinx_cold_acquisition_failed' },
    },
    runner: { machineId: hostName, role, reportTarget: `${hostName}.json`, evidenceClass, tunEvidence: exactTun() },
  };
}

describe('canonical qualification reports', () => {
  it('validates every fixed-shape exact-host authority and check field', () => {
    const evidence = exactTun();
    expect(validateTunEvidence(evidence)).toEqual(evidence);
    expect(() => validateTunEvidence({ ...evidence, authorities: { ...evidence.authorities, capabilities: ['NET_ADMIN', 'SYS_ADMIN'] } })).toThrow('capabilities');
    expect(() => validateTunEvidence({ ...evidence, checks: { ...evidence.checks, surprise: 'passed' } })).toThrow('checks');
    expect(() => validateTunEvidence({ ...evidence, checks: { ...evidence.checks, cleanupComplete: 'failed' } })).toThrow('tun_passed_status_inconsistent');
  });

  it('persists valid incomplete and complete reports atomically', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-report-'));
    for (const [name, value] of [['incomplete', report('alpha', 'A', { small: 18 })], ['complete', report('alpha', 'A')]] as const) {
      const reportPath = path.join(directory, `${name}.json`);
      await writeMachineReport(reportPath, value);
      expect(await readMachineReport(reportPath)).toEqual(value);
      expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual(value);
    }
  });

  it('binds every result to the committed manifest instead of case-name or digest claims', () => {
    const invented = report('alpha', 'A');
    invented.results[0] = { ...invented.results[0]!, caseId: 'b-to-a-256-invented' };
    expect(() => validateMachineReport(invented)).toThrow('unknown_case');
    const wrongExpected = report('alpha', 'A');
    wrongExpected.results[0] = { ...wrongExpected.results[0]!, expectedSha256: 'b'.repeat(64) };
    expect(() => validateMachineReport(wrongExpected)).toThrow('manifest_digest_mismatch');
    const wrongSize = report('alpha', 'A');
    wrongSize.results[0] = { ...wrongSize.results[0]!, size: 1536 };
    expect(() => validateMachineReport(wrongSize)).toThrow('manifest_size_mismatch');
  });

  it('selects the ordered exact pair with 19/20 small and 5/5 large independently received cases', () => {
    const selection = mergeSelection(['host-a', 'host-b'], report('host-a', 'A'), report('host-b', 'B'));
    expect(selection).toMatchObject({ decision: 'quiet', reasonCodes: [] });
    expect(selection.reports.map((value) => value.machine.hostName)).toEqual(['host-a', 'host-b']);
  });

  it('makes physical corrupt, duplicate, missing, bad timing, roles, hosts, and builds unqualified', () => {
    expect(mergeSelection(['host-a', 'host-b'], report('host-a', 'A', { small: 18 }), report('host-b', 'B'))).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['corpus_incomplete']) });
    expect(mergeSelection(['host-a', 'host-b'], report('host-a', 'A', { corruptCase: true }), report('host-b', 'B'))).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['bad_digest']) });
    expect(mergeSelection(['host-a', 'host-b'], report('host-a', 'A', { duplicateCase: true }), report('host-b', 'B'))).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['duplicate_case']) });
    expect(mergeSelection(['host-a', 'host-b'], report('host-a', 'A', { p95Boundary: true }), report('host-b', 'B'))).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['airtime_budget_exceeded']) });
    expect(mergeSelection(['host-a', 'host-b'], report('host-a', 'B'), report('host-b', 'A'))).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['ordered_roles_required']) });
    expect(mergeSelection(['host-b', 'host-a'], report('host-a', 'A'), report('host-b', 'B'))).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['ordered_hosts_required']) });
    expect(mergeSelection(['host-a', 'host-b'], report('host-a', 'A'), report('host-b', 'B', { commit: 'b'.repeat(40) }))).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['build_mismatch']) });
  });

  it('allows 10s queue high-water evidence but rejects any duration above that bound', () => {
    const boundary = report('host-a', 'A'); boundary.queues.playbackHighWaterMs = 10_000;
    expect(mergeSelection(['host-a', 'host-b'], boundary, report('host-b', 'B'))).toMatchObject({ decision: 'quiet' });
    const over = report('host-a', 'A'); over.queues.playbackHighWaterMs = 10_001;
    expect(mergeSelection(['host-a', 'host-b'], over, report('host-b', 'B'))).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['queue_bound_exceeded']) });
  });

  it('records controlled 44.1k native input resampling to 48k codec PCM and rejects unknown native rates', () => {
    const native441 = report('host-a', 'A'); native441.audio.inputDeviceSampleRate = 44_100;
    expect(mergeSelection(['host-a', 'host-b'], native441, report('host-b', 'B'))).toMatchObject({ decision: 'quiet' });
    const unsupported = report('host-a', 'A'); unsupported.audio.inputDeviceSampleRate = 32_000;
    expect(mergeSelection(['host-a', 'host-b'], unsupported, report('host-b', 'B'))).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['audio_preflight_failed']) });
  });

  it('uses exact codec IDs/profiles and never recognizes Cyrinx by substring', () => {
    const spoof = { id: 'not-cyrinx', commit: 'd'.repeat(40), profile: 'definitely-cyrinx-fast', audible: true, advertisedMtu: 1792 };
    expect(mergeSelection(['host-a', 'host-b'], report('host-a', 'A', { codec: spoof }), report('host-b', 'B', { codec: spoof }))).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['unsupported_codec']) });
    const unknownQuiet = { ...QUIET_CODEC, profile: 'audible-7k-channel-0-ish' };
    expect(mergeSelection(['host-a', 'host-b'], report('host-a', 'A', { codec: unknownQuiet }), report('host-b', 'B', { codec: unknownQuiet }))).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['unsupported_codec']) });
  });

  it('reserves human-needed for absent/manual or explicitly nonphysical evidence', () => {
    expect(mergeSelection(['host-a', 'host-b'], report('host-a', 'A', { evidenceClass: 'Loopback' }), report('host-b', 'B', { evidenceClass: 'Fixture' }))).toMatchObject({ decision: 'human_needed', reasonCodes: expect.arrayContaining(['non_physical_evidence']) });
  });
});
