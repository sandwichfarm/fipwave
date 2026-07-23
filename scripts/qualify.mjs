import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDirectory = path.join(root, '.artifacts', 'qualification');
const manifestPath = path.join(root, 'fixtures', 'corpus', 'manifest.json');

function fixtureReport(manifest) {
  const entry = manifest.cases.find((candidate) => candidate.id === 'a-to-b-256-01');
  if (!entry) throw new Error('fixture corpus case is missing');
  return {
    schemaVersion: 1, capturedAt: new Date().toISOString(),
    machine: { hostName: 'fixture', os: process.platform, architecture: process.arch, browserVersion: 'fixture', commit: 'workspace' },
    evidenceClass: 'Fixture', epoch: 1,
    codec: { commit: 'fixture', profile: 'fixture-loopback', advertisedMtu: 1357 },
    audio: { contextSampleRate: 48_000, captureSampleRate: 48_000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    queues: { captureHighWaterBytes: 0, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 },
    results: [{ epoch: 1, direction: entry.direction, caseId: entry.id, digest: entry.sha256, acquisitionMs: 0, airtimeMs: 0, deliveryCount: 1, bytePerfect: /^[a-f0-9]{64}$/i.test(entry.sha256) }],
    complete: true,
    qualificationDecision: 'human_needed', reasonCodes: ['non_physical_evidence'],
  };
}

async function runFixture() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const report = fixtureReport(manifest);
  await mkdir(artifactDirectory, { recursive: true });
  const reportPath = path.join(artifactDirectory, 'fixture.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Fixture qualification recorded at ${reportPath} (human_needed; never physical).`);
}

async function verifyReports(firstPath, secondPath, expectedHosts) {
  if (!firstPath || !secondPath || expectedHosts.length !== 2) throw new Error('usage: qualify:verify <machine-a.json> <machine-b.json> <host-a> <host-b>');
  const reports = await Promise.all([firstPath, secondPath].map(async (reportPath) => JSON.parse(await readFile(reportPath, 'utf8'))));
  const reasons = [];
  if (new Set(expectedHosts).size !== 2 || !expectedHosts.every((host) => reports.some((report) => report.machine?.hostName === host))) reasons.push('exact_hosts_required');
  for (const report of reports) {
    if (report.evidenceClass !== 'Open air') reasons.push('open_air_evidence_required');
    if (report.codec?.advertisedMtu < 1357) reasons.push('minimum_mtu_required');
    if (report.audio?.contextSampleRate !== 48000 || report.audio?.captureSampleRate !== 48000 || report.audio?.channels !== 1 || report.audio?.echoCancellation || report.audio?.noiseSuppression || report.audio?.autoGainControl) reasons.push('audio_preflight_failed');
    if (report.queues?.discontinuities !== 0 || report.queues?.captureHighWaterBytes > 262144 || report.queues?.playbackHighWaterBytes > 262144 || report.queues?.captureHighWaterMs > 5000 || report.queues?.playbackHighWaterMs > 5000) reasons.push('queue_bound_exceeded');
    if (!report.complete || !Array.isArray(report.results)) reasons.push('report_incomplete');
  }
  if (reasons.length) throw new Error(`qualification rejected: ${[...new Set(reasons)].join(',')}`);
  console.log(JSON.stringify({ decision: 'selected', expectedHosts, reportDigest: createHash('sha256').update(JSON.stringify(reports)).digest('hex') }));
}

const [command, ...args] = process.argv.slice(2);
if (command === 'fixture') await runFixture();
else if (command === 'verify') await verifyReports(args[0], args[1], args.slice(2));
else throw new Error('usage: qualify.mjs fixture | verify <machine-a.json> <machine-b.json> <host-a> <host-b>');
