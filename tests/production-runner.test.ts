import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { encodeFrame, encodePcmPayload, MessageType, PcmEncoding } from '../packages/bridge/src/protocol.js';
import { writeMachineReport, type MachineReport, type TunEvidence } from '../packages/bridge/src/report.js';
import { startProductionRunner, type ProductionRunner } from '../packages/bridge/src/runner.js';
import manifest from '../fixtures/corpus/manifest.json' with { type: 'json' };

const runners: ProductionRunner[] = [];
afterEach(async () => { await Promise.all(runners.splice(0).map((runner) => runner.close())); });

async function fixtureUi(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-ui-')); await mkdir(path.join(directory, 'assets'));
  await writeFile(path.join(directory, 'index.html'), '<main>Arm modem</main>'); await writeFile(path.join(directory, 'assets', 'app.js'), 'window.__fipwave = true;'); return directory;
}
async function reportPath(name: string): Promise<string> { return path.join(await mkdtemp(path.join(tmpdir(), `fipwave-${name}-`)), 'machine.json'); }
function pcm(epoch: number, sequence: bigint): Buffer {
  return encodeFrame({ type: MessageType.PCM_CAPTURE, epoch, sequence, sampleRate: 48_000, channels: 1, encoding: PcmEncoding.FLOAT32_LE, payload: encodePcmPayload(0n, Buffer.alloc(4)) });
}
function frame(type: MessageType, epoch: number, sequence: bigint, payload: object = {}): Buffer {
  return encodeFrame({ type, epoch, sequence, payload: Buffer.from(JSON.stringify(payload)) });
}
function audioSettings(epoch: number, sequence: bigint): Buffer {
  return frame(MessageType.AUDIO_SETTINGS, epoch, sequence, { browserVersion: 'Chromium test', microphoneLabel: 'Test microphone', contextState: 'running', inputDeviceSampleRate: 44_100, inputDeviceChannels: 2, contextSampleRate: 48_000, captureSampleRate: 48_000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false });
}
function qualificationResult(epoch: number, sequence: bigint, caseId: string, overrides: Record<string, unknown> = {}): Buffer {
  const digest = manifest.cases.find((entry) => entry.id === caseId)?.sha256; if (!digest) throw new Error(`missing test corpus case ${caseId}`);
  return frame(MessageType.QUALIFICATION_RESULT, epoch, sequence, { caseId, digest, acquisitionMs: 1, airtimeMs: 1, deliveryCount: 1, bytePerfect: true, coldAcquired: caseId.endsWith('-01'), complete: true, corrupt: false, missing: 0, duplicates: 0, queues: { captureHighWaterBytes: 1, captureHighWaterMs: 1, playbackHighWaterBytes: 1, playbackHighWaterMs: 1, discontinuities: 0 }, ...overrides });
}
function qualifyingCases(direction: 'A → B' | 'B → A'): string[] {
  return manifest.cases.filter((entry) => entry.direction === direction && (entry.size === 1536 || Number(entry.id.slice(-2)) <= 19)).map((entry) => entry.id);
}
async function openSocket(runner: ProductionRunner): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${runner.port}/bridge`, { origin: `http://127.0.0.1:${runner.port}` });
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }); return socket;
}
function nextText(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => socket.on('message', function listener(value, binary) { if (binary) return; socket.off('message', listener); resolve(JSON.parse(value.toString()) as Record<string, unknown>); }));
}
function exactTun(): TunEvidence {
  return { schemaVersion: 1, source: 'exact_host', status: 'passed', image: 'alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c', interfaceName: 'fips-preflight0', ipv6Address: 'fd42:6677:6677::1/64', authorities: { devices: ['/dev/net/tun'], capabilities: ['NET_ADMIN'], securityOptions: ['no-new-privileges:true'], privileged: false, networkMode: 'none', publishedPorts: [] }, checks: { imagePinned: 'passed', tunDevice: 'passed', netAdmin: 'passed', noNewPrivileges: 'passed', notPrivileged: 'passed', sysAdminAbsent: 'passed', hostNetworkAbsent: 'passed', loopbackPortsOnly: 'passed', interfaceCreated: 'passed', ipv6Assigned: 'passed', cleanupComplete: 'passed' }, errors: [] };
}

describe('production runner', () => {
  it('serves built UI plus immutable runner-owned codec, timeout, build, role, path, and evidence authority', async () => {
    const runner = await startProductionRunner({ machineId: 'laptop-a', role: 'A', port: 0, report: await reportPath('config'), tunEvidence: 'evidence/tun.json', evidenceMode: 'Loopback', uiDir: await fixtureUi() }); runners.push(runner);
    expect(await (await fetch(`http://127.0.0.1:${runner.port}/assets/app.js`)).text()).toContain('__fipwave');
    const first = await (await fetch(`http://127.0.0.1:${runner.port}/qualification-config`)).json();
    expect(first).toMatchObject({ machineId: 'laptop-a', role: 'A', evidenceClass: 'Loopback', tunEvidenceSource: 'static', codec: { id: 'quiet', profile: 'audible-7k-channel-0', audible: true, advertisedMtu: 1357 }, qualification: { deadLinkTimeoutMs: 30_000, cyrinxDeadlineMs: 5_400_000, fallback: { state: 'available' } } });
    expect(first.buildCommit).not.toBe('workspace');
    expect(await (await fetch(`http://127.0.0.1:${runner.port}/qualification-config`)).json()).toEqual(first);
  });

  it('acks every accepted result exactly and persists a selectable-threshold 24-case Loopback report with one Missing placeholder', async () => {
    const target = await reportPath('complete'); const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: target, tunEvidence: 'none', uiDir: await fixtureUi() }); runners.push(runner);
    const socket = await openSocket(runner); const settingsAck = nextText(socket); socket.send(audioSettings(1, 0n)); expect(await settingsAck).toMatchObject({ physicalQualification: false });
    let sequence = 1n;
    for (const caseId of qualifyingCases('A → B')) {
      const ack = nextText(socket); socket.send(qualificationResult(1, sequence++, caseId));
      expect(await ack).toEqual({ kind: 'qualification-result', caseId, epoch: 1, accepted: true });
    }
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report).toMatchObject({ evidenceClass: 'Loopback', complete: true, machine: { hostName: 'laptop-b' }, audio: { microphoneLabel: 'Test microphone', contextState: 'running', inputDeviceSampleRate: 44_100, inputDeviceChannels: 2, contextSampleRate: 48_000, captureSampleRate: 48_000, channels: 1 }, runner: { role: 'B' } });
    expect(report.results).toHaveLength(25);
    expect(report.results.filter((entry) => entry.observed)).toHaveLength(24);
    expect(report.results.find((entry) => entry.caseId === 'a-to-b-256-20')).toMatchObject({ observed: false, receivedSha256: null, missing: 1 });
    socket.close();
  });

  it('preserves corrupt and duplicate evidence with precise reasons instead of dropping the report', async () => {
    const target = await reportPath('failed'); const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: target, tunEvidence: 'none', uiDir: await fixtureUi() }); runners.push(runner);
    const socket = await openSocket(runner); const settingsAck = nextText(socket); socket.send(audioSettings(1, 0n)); await settingsAck;
    const caseId = 'a-to-b-256-01'; const corruptAck = nextText(socket);
    socket.send(qualificationResult(1, 1n, caseId, { digest: 'f'.repeat(64), bytePerfect: false, corrupt: true })); expect(await corruptAck).toEqual({ kind: 'qualification-result', caseId, epoch: 1, accepted: true });
    socket.send(qualificationResult(1, 2n, caseId)); await new Promise((resolve) => socket.once('close', resolve));
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report.reasonCodes).toEqual(expect.arrayContaining(['bad_digest', 'duplicate_case']));
    expect(report.results.find((entry) => entry.caseId === caseId)).toMatchObject({ observed: true, duplicates: 1, deliveryCount: 2 });
  });

  it('serializes writes and leaves a new-epoch invalidating report after a reset races an older write', async () => {
    const target = await reportPath('race'); let release!: () => void; let started!: () => void; let blocked = false;
    const gate = new Promise<void>((resolve) => { release = resolve; }); const writeStarted = new Promise<void>((resolve) => { started = resolve; });
    const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: target, tunEvidence: 'none', uiDir: await fixtureUi(), reportWriterForTests: async (file, report) => { if (!blocked && report.epoch === 1 && report.results.some((entry) => entry.observed)) { blocked = true; started(); await gate; } return writeMachineReport(file, report); } }); runners.push(runner);
    const socket = await openSocket(runner); const settingsAck = nextText(socket); socket.send(audioSettings(1, 0n)); await settingsAck;
    socket.send(qualificationResult(1, 1n, 'a-to-b-256-01')); await writeStarted;
    const reset = runner.reset(); release(); expect(await reset).toBe(2);
    const report = JSON.parse(await readFile(target, 'utf8')) as MachineReport;
    expect(report).toMatchObject({ epoch: 2, complete: false });
    expect(report.results.every((entry) => entry.observed === false)).toBe(true);
    socket.close();
  });

  it('prevents multi-tab evidence combination and permits reconnect only after RESET', async () => {
    const target = await reportPath('tabs'); const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: target, tunEvidence: 'none', uiDir: await fixtureUi() }); runners.push(runner);
    const first = await openSocket(runner); const settingsAck = nextText(first); first.send(audioSettings(1, 0n)); await settingsAck;
    const second = await openSocket(runner); await new Promise((resolve) => second.once('close', resolve));
    first.close(); await new Promise((resolve) => first.once('close', resolve));
    const premature = await openSocket(runner); await new Promise((resolve) => premature.once('close', resolve));
    await runner.reset();
    const afterReset = await openSocket(runner); expect(afterReset.readyState).toBe(WebSocket.OPEN); afterReset.close();
  });

  it('does not count routine control-frame aging as an acoustic discontinuity', async () => {
    let now = 0; const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: await reportPath('aging'), tunEvidence: 'none', uiDir: await fixtureUi(), nowForTests: () => now }); runners.push(runner);
    const socket = await openSocket(runner); socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 0n, { caseId: 'one' })); await new Promise((resolve) => setTimeout(resolve, 10));
    now = 6_000; socket.send(frame(MessageType.QUALIFICATION_CASE, 1, 1n, { caseId: 'two' })); await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runner.state()).toMatchObject({ discontinuities: 0, queueCounts: { QUALIFICATION_CASE: 1 } }); socket.close();
  });

  it('fails physical mode closed for dirty/default build identities and any non-passed exact-host field', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-physical-')); const tunPath = path.join(directory, 'tun.json'); await writeFile(tunPath, JSON.stringify(exactTun()));
    const base = { machineId: 'laptop-a', role: 'A' as const, port: 0, report: path.join(directory, 'machine.json'), tunEvidence: tunPath, physicalOpenAir: true, uiDir: await fixtureUi() };
    await expect(startProductionRunner({ ...base, buildIdentityForTests: { commit: 'workspace', os: 'test', architecture: 'test', dirty: false } })).rejects.toThrow('clean resolved git HEAD');
    await expect(startProductionRunner({ ...base, buildIdentityForTests: { commit: 'a'.repeat(40), os: 'test', architecture: 'test', dirty: true } })).rejects.toThrow('clean resolved git HEAD');
    const failed = exactTun(); failed.checks.cleanupComplete = 'failed'; await writeFile(tunPath, JSON.stringify(failed));
    await expect(startProductionRunner({ ...base, buildIdentityForTests: { commit: 'a'.repeat(40), os: 'test', architecture: 'test', dirty: false } })).rejects.toThrow('tun_passed_status_inconsistent');
  });
});
