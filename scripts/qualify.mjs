import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeSelection, qualificationReason, validateMachineReport } from '../packages/bridge/src/report.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDirectory = path.join(root, '.artifacts', 'qualification');
const manifestPath = path.join(root, 'fixtures', 'corpus', 'manifest.json');

function fixtureReport(manifest) {
  const entry = manifest.cases.find((candidate) => candidate.id === 'a-to-b-256-01');
  if (!entry) throw new Error('fixture corpus case is missing');
  return { schemaVersion: 1, capturedAt: new Date().toISOString(), machine: { hostName: 'fixture', os: process.platform, architecture: process.arch, browserVersion: 'fixture', commit: 'workspace' }, evidenceClass: 'Fixture', epoch: 1, codec: { commit: 'fixture', profile: 'fixture-loopback', advertisedMtu: 1357 }, audio: { contextSampleRate: 48_000, captureSampleRate: 48_000, channels: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, queues: { captureHighWaterBytes: 0, captureHighWaterMs: 0, playbackHighWaterBytes: 0, playbackHighWaterMs: 0, discontinuities: 0 }, results: [{ epoch: 1, direction: entry.direction, caseId: entry.id, digest: entry.sha256, acquisitionMs: 0, airtimeMs: 0, deliveryCount: 1, bytePerfect: true }], complete: true };
}

async function writeAtomically(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

async function runFixture() {
  const report = fixtureReport(JSON.parse(await readFile(manifestPath, 'utf8')));
  const reportPath = path.join(artifactDirectory, 'fixture.json'); await writeAtomically(reportPath, report);
  console.log(`Fixture qualification recorded at ${reportPath} (human_needed; never physical).`);
}

function usage() { return 'usage: qualify.mjs fixture | verify --machine-a A.json --machine-b B.json --host-a HOST --host-b HOST --selection PATH'; }

function named(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index]; if (key === '--help') return { help: true };
    const value = values[index + 1];
    if (!['--machine-a', '--machine-b', '--host-a', '--host-b', '--selection'].includes(key) || !value || result.has(key)) throw new Error(usage());
    result.set(key, value); index += 1;
  }
  return { machineA: result.get('--machine-a'), machineB: result.get('--machine-b'), hostA: result.get('--host-a'), hostB: result.get('--host-b'), selection: result.get('--selection') };
}

async function verifyReports(args) {
  const options = named(args);
  if (options.help) { console.log(usage()); return; }
  if (!options.machineA && !options.machineB && !options.hostA && !options.hostB && !options.selection) { console.log(JSON.stringify({ decision: 'human_needed', reasonCodes: ['machine_reports_required'] })); return; }
  if (!options.machineA || !options.machineB || !options.hostA || !options.hostB || !options.selection) throw new Error(usage());
  const readCanonical = async (reportPath) => {
    let text;
    try { text = await readFile(reportPath, 'utf8'); }
    catch (error) { if (error && typeof error === 'object' && error.code === 'ENOENT') return { missing: true }; return { reason: 'machine_report_unreadable' }; }
    let value;
    try { value = JSON.parse(text); } catch { return { reason: 'invalid_json' }; }
    try { return { report: validateMachineReport(value) }; } catch (error) { return { reason: qualificationReason(error) }; }
  };
  const [a, b] = await Promise.all([readCanonical(options.machineA), readCanonical(options.machineB)]);
  let selection;
  if (a.missing || b.missing) {
    selection = { schemaVersion: 1, expectedHosts: [options.hostA, options.hostB], decision: 'human_needed', reasonCodes: ['machine_reports_required'], reports: [] };
  } else if (a.reason || b.reason) {
    selection = { schemaVersion: 1, expectedHosts: [options.hostA, options.hostB], decision: 'unqualified', reasonCodes: [...new Set([a.reason, b.reason].filter(Boolean))], reports: [] };
  } else {
    selection = mergeSelection([options.hostA, options.hostB], a.report, b.report);
  }
  await writeAtomically(options.selection, selection);
  console.log(JSON.stringify(selection));
}

const [command, ...args] = process.argv.slice(2);
if (command === 'fixture') await runFixture();
else if (command === 'verify') await verifyReports(args);
else if (command === '--help' || command === undefined) console.log(usage());
else throw new Error(usage());
