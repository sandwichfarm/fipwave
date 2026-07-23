import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'fixtures/corpus/manifest.json'), 'utf8'));
const quiet = { id: 'quiet', commit: '72782542a41f1b615a02c2ab43a0edb56edb6ce4', profile: 'audible-7k-channel-0', audible: true, advertisedMtu: 1357 };
const exactTun = { schemaVersion: 1, source: 'exact_host', status: 'passed', image: 'alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c', interfaceName: 'fips-preflight0', ipv6Address: 'fd42:6677:6677::1/64', authorities: { devices: ['/dev/net/tun'], capabilities: ['NET_ADMIN'], securityOptions: ['no-new-privileges:true'], privileged: false, networkMode: 'none', publishedPorts: [] }, checks: { imagePinned: 'passed', tunDevice: 'passed', netAdmin: 'passed', noNewPrivileges: 'passed', notPrivileged: 'passed', sysAdminAbsent: 'passed', hostNetworkAbsent: 'passed', loopbackPortsOnly: 'passed', interfaceCreated: 'passed', ipv6Assigned: 'passed', cleanupComplete: 'passed' }, errors: [] };
function report(hostName, role, options = {}) {
  const direction = role === 'A' ? 'B → A' : 'A → B'; const small = options.small ?? 19;
  const results = manifest.cases.filter((entry) => entry.direction === direction).map((entry, index) => {
    const observed = entry.size === 1536 || Number(entry.id.slice(-2)) <= small;
    return { epoch: 1, direction, caseId: entry.id, size: entry.size, expectedSha256: entry.sha256, receivedSha256: observed ? entry.sha256 : null, acquisitionMs: observed ? 1 : 0, airtimeMs: observed ? 1 : 0, deliveryCount: observed ? 1 : 0, bytePerfect: observed, coldAcquired: observed && index === 0, observed, complete: observed, corrupt: false, missing: observed ? 0 : 1, duplicates: 0 };
  });
  const evidenceClass = options.evidenceClass ?? 'Open air'; const complete = small >= 19;
  return { schemaVersion: 1, capturedAt: new Date().toISOString(), machine: { hostName, os: 'test', architecture: 'test', browserVersion: 'Chromium test', commit: options.commit ?? 'a'.repeat(40) }, evidenceClass, epoch: 1, codec: options.codec ?? quiet, audio: { microphoneLabel: 'Test microphone', contextState: 'running', inputDeviceSampleRate: 48000, contextSampleRate: 48000, captureSampleRate: 48000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, queues: { captureHighWaterBytes: 1, captureHighWaterMs: 1, playbackHighWaterBytes: 1, playbackHighWaterMs: 1, discontinuities: 0 }, results, complete, reasonCodes: complete ? [] : ['corpus_incomplete'], qualification: { deadLinkTimeoutMs: 30000, cyrinxDeadlineMs: 5400000, deadline: { startedAtMs: 1000, deadlineAtMs: 5401000, elapsedMs: 100 }, physicalGate: complete ? 'passed' : 'failed', fallback: { codecId: 'quiet', state: 'activated', reasonCode: 'cyrinx_cold_acquisition_failed' } }, runner: { machineId: hostName, role, reportTarget: `${hostName}.json`, evidenceClass, tunEvidence: exactTun } };
}
function run(args) { return spawnSync(process.execPath, ['scripts/qualify.mjs', 'verify', ...args], { cwd: root, encoding: 'utf8' }); }
async function files(first, second) {
  const directory = await mkdtemp(path.join(tmpdir(), 'fipwave-qualify-')); const a = path.join(directory, 'a.json'); const b = path.join(directory, 'b.json'); const target = path.join(directory, 'nested', 'choice.json');
  await writeFile(a, JSON.stringify(first)); await writeFile(b, JSON.stringify(second)); return { a, b, target };
}
function args({ a, b, target }, hosts = ['alpha', 'beta']) { return ['--selection', target, '--host-b', hosts[1], '--machine-a', a, '--host-a', hosts[0], '--machine-b', b]; }

test('named verifier honors flag order and writes exactly the requested ordered canonical path', async () => {
  const paths = await files(report('alpha', 'A'), report('beta', 'B')); const result = run(args(paths));
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(await readFile(paths.target, 'utf8')).decision, 'quiet');
});

test('19/20 plus 5/5 selects while 18/20 remains precisely unqualified', async () => {
  const paths = await files(report('alpha', 'A', { small: 18 }), report('beta', 'B')); const result = run(args(paths)); assert.equal(result.status, 0, result.stderr);
  const selection = JSON.parse(await readFile(paths.target, 'utf8')); assert.equal(selection.decision, 'unqualified'); assert(selection.reasonCodes.includes('corpus_incomplete'));
});

test('ordered roles/hosts, matching builds, and exact codec IDs fail closed', async () => {
  for (const [first, second, hosts, reason] of [
    [report('alpha', 'B'), report('beta', 'A'), ['alpha', 'beta'], 'ordered_roles_required'],
    [report('alpha', 'A'), report('beta', 'B'), ['beta', 'alpha'], 'ordered_hosts_required'],
    [report('alpha', 'A'), report('beta', 'B', { commit: 'b'.repeat(40) }), ['alpha', 'beta'], 'build_mismatch'],
    [report('alpha', 'A', { codec: { ...quiet, id: 'not-cyrinx', profile: 'cyrinx-spoof' } }), report('beta', 'B', { codec: { ...quiet, id: 'not-cyrinx', profile: 'cyrinx-spoof' } }), ['alpha', 'beta'], 'unsupported_codec'],
  ]) {
    const paths = await files(first, second); run(args(paths, hosts)); const selection = JSON.parse(await readFile(paths.target, 'utf8'));
    assert.equal(selection.decision, 'unqualified'); assert(selection.reasonCodes.includes(reason), `${reason}: ${selection.reasonCodes}`);
  }
});

test('invented manifest cases and expected digests retain precise invalid-input reasons', async () => {
  for (const [mutate, reason] of [
    [(value) => { value.results[0].caseId = 'invented-case'; }, 'unknown_case'],
    [(value) => { value.results[0].expectedSha256 = 'f'.repeat(64); }, 'manifest_digest_mismatch'],
  ]) {
    const first = report('alpha', 'A'); mutate(first); const paths = await files(first, report('beta', 'B')); run(args(paths)); const selection = JSON.parse(await readFile(paths.target, 'utf8'));
    assert.equal(selection.decision, 'unqualified'); assert.deepEqual(selection.reasonCodes, [reason]);
  }
});

test('human-needed is reserved for absent or explicitly nonphysical/manual evidence', async () => {
  const none = run([]); assert.match(none.stdout, /human_needed/);
  const help = spawnSync(process.execPath, ['scripts/qualify.mjs', 'verify', '--help'], { cwd: root, encoding: 'utf8' }); assert.equal(help.status, 0); assert.match(help.stdout, /--machine-a/);
  const missingDirectory = await mkdtemp(path.join(tmpdir(), 'fipwave-missing-')); const missingTarget = path.join(missingDirectory, 'selection.json');
  const missing = run(['--machine-a', path.join(missingDirectory, 'no-a.json'), '--machine-b', path.join(missingDirectory, 'no-b.json'), '--host-a', 'alpha', '--host-b', 'beta', '--selection', missingTarget]);
  assert.equal(missing.status, 0, missing.stderr); assert.equal(JSON.parse(await readFile(missingTarget, 'utf8')).decision, 'human_needed');
  const paths = await files(report('alpha', 'A', { evidenceClass: 'Loopback' }), report('beta', 'B', { evidenceClass: 'Fixture' })); run(args(paths));
  assert.equal(JSON.parse(await readFile(paths.target, 'utf8')).decision, 'human_needed');
});
