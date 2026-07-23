import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { encodeFrame, MessageType, PcmEncoding } from '../packages/bridge/src/protocol.js';
import { startProductionRunner, type ProductionRunner } from '../packages/bridge/src/runner.js';
import manifest from '../fixtures/corpus/manifest.json' with { type: 'json' };

const runners: ProductionRunner[] = [];

afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.close()));
});

async function fixtureUi(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-ui-'));
  await mkdir(path.join(directory, 'assets'));
  await writeFile(path.join(directory, 'index.html'), '<main>Arm modem</main>');
  await writeFile(path.join(directory, 'assets', 'app.js'), 'window.__fipwave = true;');
  return directory;
}

function pcm(epoch: number, sequence: bigint): Buffer {
  return encodeFrame({
    type: MessageType.PCM_CAPTURE,
    epoch,
    sequence,
    sampleRate: 48_000,
    channels: 1,
    encoding: PcmEncoding.FLOAT32_LE,
    payload: Buffer.alloc(4),
  });
}

function frame(type: MessageType, epoch: number, sequence: bigint, payload: object = {}): Buffer {
  return encodeFrame({ type, epoch, sequence, payload: Buffer.from(JSON.stringify(payload)) });
}
function audioSettings(epoch: number, sequence: bigint): Buffer {
  return frame(MessageType.AUDIO_SETTINGS, epoch, sequence, { browserVersion: 'Chromium test', contextSampleRate: 48_000, captureSampleRate: 48_000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false });
}
function qualificationResult(epoch: number, sequence: bigint, caseId: string): Buffer {
  const digest = manifest.cases.find((entry) => entry.id === caseId)?.sha256;
  if (!digest) throw new Error(`missing test corpus case ${caseId}`);
  return frame(MessageType.QUALIFICATION_RESULT, epoch, sequence, { caseId, digest, acquisitionMs: 1, airtimeMs: 1, deliveryCount: 1, bytePerfect: true, queues: { captureHighWaterBytes: 1, captureHighWaterMs: 1, playbackHighWaterBytes: 1, playbackHighWaterMs: 1, discontinuities: 0 } });
}
function cases(): string[] { return [...Array.from({ length: 20 }, (_, index) => `a-to-b-256-${String(index + 1).padStart(2, '0')}`), ...Array.from({ length: 5 }, (_, index) => `a-to-b-1536-${String(index + 1).padStart(2, '0')}`)]; }

describe('production runner', () => {
  it('serves the built UI and runner-owned immutable qualification config over one loopback origin', async () => {
    const runner = await startProductionRunner({
      machineId: 'laptop-a', role: 'A', port: 0, report: '.artifacts/qualification/laptop-a.json',
      tunEvidence: 'evidence/tun.json', evidenceMode: 'Loopback', uiDir: await fixtureUi(),
    });
    runners.push(runner);

    const page = await fetch(`http://127.0.0.1:${runner.port}/assets/app.js`);
    expect(page.headers.get('content-type')).toContain('application/javascript');
    expect(await page.text()).toContain('__fipwave');
    const first = await (await fetch(`http://127.0.0.1:${runner.port}/qualification-config`)).json();
    const second = await (await fetch(`http://127.0.0.1:${runner.port}/qualification-config`)).json();
    expect(first).toEqual({ machineId: 'laptop-a', role: 'A', reportTarget: '.artifacts/qualification/laptop-a.json', tunEvidence: 'evidence/tun.json', evidenceMode: 'Loopback', evidenceClass: 'Loopback' });
    expect(second).toEqual(first);

    const socket = new WebSocket(`ws://127.0.0.1:${runner.port}/bridge`, { origin: `http://127.0.0.1:${runner.port}` });
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.close();
  });

  it('defaults to deterministic Loopback and rejects open-air startup without validated exact-host evidence', async () => {
    const defaultRunner = await startProductionRunner({ machineId: 'laptop-a', role: 'A', port: 0, report: 'report.json', tunEvidence: 'none', uiDir: await fixtureUi() });
    runners.push(defaultRunner);
    expect(defaultRunner.config.evidenceMode).toBe('Loopback');
    await expect(startProductionRunner({ machineId: 'laptop-a', role: 'A', port: 0, report: 'report.json', tunEvidence: 'none', evidenceMode: 'Fixture', physicalOpenAir: true, uiDir: await fixtureUi() })).rejects.toThrow('exact_host');
  });

  it('rejects browser-owned authority fields and routes current-epoch FWAV data through separate bounded queues', async () => {
    const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: 'report.json', tunEvidence: 'none', uiDir: await fixtureUi() });
    runners.push(runner);
    const socket = new WebSocket(`ws://127.0.0.1:${runner.port}/bridge`, { origin: `http://127.0.0.1:${runner.port}` });
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(frame(MessageType.QUALIFICATION_RESULT, 1, 1n, { caseId: 'case-1', role: 'A' }));
    await new Promise((resolve) => socket.once('close', resolve));
    expect(runner.state().rejectedFrames).toBe(1);

    const valid = new WebSocket(`ws://127.0.0.1:${runner.port}/bridge`, { origin: `http://127.0.0.1:${runner.port}` });
    await new Promise<void>((resolve, reject) => { valid.once('open', resolve); valid.once('error', reject); });
    valid.send(pcm(1, 1n));
    valid.send(frame(MessageType.QUALIFICATION_CASE, 1, 2n, { caseId: 'case-1' }));
    valid.send(qualificationResult(1, 3n, 'a-to-b-256-01'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runner.state().queueCounts).toMatchObject({ PCM_CAPTURE: 1, QUALIFICATION_CASE: 1, QUALIFICATION_RESULT: 1 });
    expect(runner.state().stampedResults[0]).toMatchObject({ machineId: 'laptop-b', role: 'B', evidenceClass: 'Loopback' });
    valid.close();
  });

  it('atomically persists only coherent current-epoch runner-stamped Loopback evidence', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-machine-report-')); const reportPath = path.join(directory, 'machine.json');
    const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: reportPath, tunEvidence: 'none', uiDir: await fixtureUi() }); runners.push(runner);
    const socket = new WebSocket(`ws://127.0.0.1:${runner.port}/bridge`, { origin: `http://127.0.0.1:${runner.port}` });
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(audioSettings(1, 1n));
    for (const [index, caseId] of cases().entries()) socket.send(qualificationResult(1, BigInt(index + 2), caseId));
    const response = await new Promise<string>((resolve, reject) => { socket.on('message', (value) => { const text = value.toString(); if (text.includes(reportPath)) resolve(text); }); socket.once('error', reject); });
    expect(JSON.parse(response)).toMatchObject({ reportPath, complete: true, physicalQualification: false });
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    expect(report).toMatchObject({ evidenceClass: 'Loopback', complete: true, machine: { hostName: 'laptop-b' }, runner: { machineId: 'laptop-b', role: 'B', evidenceClass: 'Loopback' } });
    expect(report.results).toHaveLength(25); socket.close();
  });

  it('rejects stale, duplicate, incomplete, and corpus-spoofed report inputs before persistence', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-reject-report-')); const reportPath = path.join(directory, 'machine.json');
    const runner = await startProductionRunner({ machineId: 'laptop-b', role: 'B', port: 0, report: reportPath, tunEvidence: 'none', uiDir: await fixtureUi() }); runners.push(runner);
    const socket = new WebSocket(`ws://127.0.0.1:${runner.port}/bridge`, { origin: `http://127.0.0.1:${runner.port}` }); await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(audioSettings(1, 1n)); socket.send(frame(MessageType.QUALIFICATION_RESULT, 1, 2n, { caseId: 'a-to-b-256-01', digest: 'b'.repeat(64), acquisitionMs: 1, airtimeMs: 1, deliveryCount: 1, bytePerfect: true, queues: { captureHighWaterBytes: 1, captureHighWaterMs: 1, playbackHighWaterBytes: 1, playbackHighWaterMs: 1, discontinuities: 0 } }));
    await new Promise((resolve) => socket.once('close', resolve));
    await expect(readFile(reportPath, 'utf8')).rejects.toThrow(); expect(runner.state().rejectedFrames).toBe(1);
  });
});
