import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'fixtures/corpus/manifest.json'), 'utf8'));
const exactTun = { schemaVersion: 1, source: 'exact_host', status: 'passed', image: 'alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c', interfaceName: 'fips-preflight0', ipv6Address: 'fd42:6677:6677::1/64', authorities: { devices: ['/dev/net/tun'], capabilities: ['NET_ADMIN'], securityOptions: ['no-new-privileges:true'], privileged: false, networkMode: 'none', publishedPorts: [] }, checks: { imagePinned: 'passed', tunDevice: 'passed', netAdmin: 'passed', noNewPrivileges: 'passed', notPrivileged: 'passed', sysAdminAbsent: 'passed', hostNetworkAbsent: 'passed', loopbackPortsOnly: 'passed', interfaceCreated: 'passed', ipv6Assigned: 'passed', cleanupComplete: 'passed' }, errors: [] };
function report(hostName, role, profile = 'audible-7k-channel-0') { const direction = role === 'A' ? 'A → B' : 'B → A'; return { schemaVersion: 1, capturedAt: new Date().toISOString(), machine: { hostName, os: 'test', architecture: 'test', browserVersion: 'test', commit: 'test' }, evidenceClass: 'Open air', epoch: 1, codec: { commit: 'quiet-72782542', profile, advertisedMtu: 1357 }, audio: { contextSampleRate: 48000, captureSampleRate: 48000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, queues: { captureHighWaterBytes: 1, captureHighWaterMs: 1, playbackHighWaterBytes: 1, playbackHighWaterMs: 1, discontinuities: 0 }, results: manifest.cases.filter((entry) => entry.direction === direction).map((entry) => ({ epoch: 1, direction: entry.direction, caseId: entry.id, digest: entry.sha256, acquisitionMs: 1, airtimeMs: 1, deliveryCount: 1, bytePerfect: true })), complete: true, runner: { machineId: hostName, role, reportTarget: `${hostName}.json`, evidenceClass: 'Open air', tunEvidence: exactTun } }; }
function run(args) { return spawnSync(process.execPath, ['scripts/qualify.mjs', 'verify', ...args], { cwd: root, encoding: 'utf8' }); }

test('named verifier honors flag order and writes exactly the requested canonical path', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-qualify-')); const a = path.join(directory, 'a.json'); const b = path.join(directory, 'b.json'); const target = path.join(directory, 'nested', 'choice.json');
  await writeFile(a, JSON.stringify(report('alpha', 'A'))); await writeFile(b, JSON.stringify(report('beta', 'B')));
  const result = run(['--selection', target, '--host-b', 'beta', '--machine-a', a, '--host-a', 'alpha', '--machine-b', b]);
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(await readFile(target, 'utf8')).decision, 'quiet');
});

test('fixture or missing evidence cannot select and no-argument/help responses remain human-needed/documented', async () => {
  const none = run([]); assert.match(none.stdout, /human_needed/);
  const help = spawnSync(process.execPath, ['scripts/qualify.mjs', 'verify', '--help'], { cwd: root, encoding: 'utf8' }); assert.equal(help.status, 0); assert.match(help.stdout, /--machine-a/);
  const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-qualify-')); const a = path.join(directory, 'a.json'); const b = path.join(directory, 'b.json'); const target = path.join(directory, 'choice.json'); const bad = report('beta', 'B'); bad.evidenceClass = 'Fixture';
  await writeFile(a, JSON.stringify(report('alpha', 'A'))); await writeFile(b, JSON.stringify(bad)); run(['--machine-a', a, '--machine-b', b, '--host-a', 'alpha', '--host-b', 'beta', '--selection', target]);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).decision, 'human_needed');
});
