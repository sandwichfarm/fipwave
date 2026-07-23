import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { mergeSelection, readMachineReport, validateMachineReport, validateTunEvidence, writeMachineReport, type MachineReport, type TunEvidence } from '../src/report.js';

function exactTun(): TunEvidence {
  return { schemaVersion: 1, source: 'exact_host', status: 'passed', image: 'alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c', interfaceName: 'fips-preflight0', ipv6Address: 'fd42:6677:6677::1/64', authorities: { devices: ['/dev/net/tun'], capabilities: ['NET_ADMIN'], securityOptions: ['no-new-privileges:true'], privileged: false, networkMode: 'none', publishedPorts: [] }, checks: { imagePinned: 'passed', tunDevice: 'passed', netAdmin: 'passed', noNewPrivileges: 'passed', notPrivileged: 'passed', sysAdminAbsent: 'passed', hostNetworkAbsent: 'passed', loopbackPortsOnly: 'passed', interfaceCreated: 'passed', ipv6Assigned: 'passed', cleanupComplete: 'passed' }, errors: [] };
}

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
  it('validates a fixed-shape TunEvidence contract without accepting unknown authority or check keys', () => {
    const evidence = {
      schemaVersion: 1 as const, source: 'static' as const, status: 'passed' as const,
      image: 'alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c',
      interfaceName: 'fips-preflight0', ipv6Address: 'fd42:6677:6677::1/64',
      authorities: { devices: ['/dev/net/tun'], capabilities: ['NET_ADMIN'], securityOptions: ['no-new-privileges:true'], privileged: false, networkMode: 'none', publishedPorts: [] },
      checks: { imagePinned: 'passed', tunDevice: 'passed', netAdmin: 'passed', noNewPrivileges: 'passed', notPrivileged: 'passed', sysAdminAbsent: 'passed', hostNetworkAbsent: 'passed', loopbackPortsOnly: 'passed', interfaceCreated: 'not_run', ipv6Assigned: 'not_run', cleanupComplete: 'not_run' },
      errors: [],
    };
    expect(validateTunEvidence(evidence)).toEqual(evidence);
    expect(() => validateTunEvidence({ ...evidence, authorities: { ...evidence.authorities, capabilities: ['NET_ADMIN', 'SYS_ADMIN'] } })).toThrow('capabilities');
    expect(() => validateTunEvidence({ ...evidence, checks: { ...evidence.checks, surprise: 'passed' } })).toThrow('checks');
  });

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

  it('fails closed unless named exact hosts have runner-stamped roles, exact-host TUN evidence, and complete corpus evidence', () => {
    const alpha = report('alpha');
    const beta = report('beta');
    expect(mergeSelection(['alpha', 'beta'], alpha, beta)).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['runner_authority_required', 'corpus_incomplete']) });
    alpha.runner = { machineId: 'alpha', role: 'A', reportTarget: 'alpha.json', evidenceClass: 'Open air', tunEvidence: exactTun() };
    beta.runner = { machineId: 'beta', role: 'B', reportTarget: 'beta.json', evidenceClass: 'Open air', tunEvidence: { ...exactTun(), source: 'lifecycle' } };
    expect(mergeSelection(['alpha', 'beta'], alpha, beta)).toMatchObject({ decision: 'unqualified', reasonCodes: expect.arrayContaining(['exact_host_tun_required']) });
    expect(mergeSelection(['alpha', 'beta'], alpha, report('beta', 'Fixture'))).toMatchObject({ decision: 'unqualified' });
    expect(mergeSelection(['alpha', 'beta'], alpha, report('other'))).toMatchObject({ decision: 'unqualified' });
  });
});
