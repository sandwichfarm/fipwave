import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type EvidenceClass = 'Fixture' | 'Loopback' | 'Open air';
export type LiteralDirection = 'A → B' | 'B → A';
export const MAX_QUEUE_BYTES = 256 * 1024;
export const MAX_QUEUE_DURATION_MS = 5_000;

export interface MachineReport {
  schemaVersion: 1;
  capturedAt: string;
  machine: { hostName: string; os: string; architecture: string; browserVersion: string; commit: string };
  evidenceClass: EvidenceClass;
  epoch: number;
  codec: { commit: string; profile: string; advertisedMtu: number };
  audio: { contextSampleRate: number; captureSampleRate: number; channels: number; echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean };
  queues: { captureHighWaterBytes: number; captureHighWaterMs: number; playbackHighWaterBytes: number; playbackHighWaterMs: number; discontinuities: number };
  results: Array<{ epoch: number; direction: LiteralDirection; caseId: string; digest: string; acquisitionMs: number; airtimeMs: number; deliveryCount: number; bytePerfect: boolean }>;
  complete: boolean;
}

export interface SelectionReport {
  schemaVersion: 1;
  expectedHosts: readonly [string, string];
  decision: 'selected' | 'human_needed';
  reasonCodes: string[];
  reports: [MachineReport, MachineReport];
}

function fail(message: string): never { throw new Error(`qualification report ${message}`); }
function nonEmpty(value: string, label: string): void { if (typeof value !== 'string' || value.trim() === '') fail(`${label} is required`); }
function finiteNonNegative(value: number, label: string): void { if (!Number.isFinite(value) || value < 0) fail(`${label} is invalid`); }

export function validateMachineReport(candidate: unknown): MachineReport {
  const report = candidate as MachineReport;
  if (!report || report.schemaVersion !== 1) fail('schema version is unsupported');
  if (Number.isNaN(Date.parse(report.capturedAt))) fail('captured timestamp is invalid');
  for (const [label, value] of Object.entries(report.machine ?? {})) nonEmpty(value, `machine ${label}`);
  if (!report.machine || Object.keys(report.machine).length !== 5) fail('machine identity is incomplete');
  if (!['Fixture', 'Loopback', 'Open air'].includes(report.evidenceClass)) fail('evidence class is invalid');
  if (!Number.isInteger(report.epoch) || report.epoch < 0) fail('epoch is invalid');
  nonEmpty(report.codec?.commit, 'codec commit'); nonEmpty(report.codec?.profile, 'codec profile');
  if (!Number.isInteger(report.codec?.advertisedMtu) || report.codec.advertisedMtu <= 0) fail('advertised MTU is invalid');
  const audio = report.audio;
  if (!audio || audio.contextSampleRate !== 48_000 || audio.captureSampleRate !== 48_000 || audio.channels !== 1 || audio.echoCancellation || audio.noiseSuppression || audio.autoGainControl) fail('audio settings are not qualifying');
  for (const [label, value] of Object.entries(report.queues ?? {})) finiteNonNegative(value, `queue ${label}`);
  if (!report.queues || Object.keys(report.queues).length !== 5) fail('queue evidence is incomplete');
  if (report.queues.captureHighWaterBytes > MAX_QUEUE_BYTES || report.queues.playbackHighWaterBytes > MAX_QUEUE_BYTES) fail('queue byte bound is exceeded');
  if (report.queues.captureHighWaterMs > MAX_QUEUE_DURATION_MS || report.queues.playbackHighWaterMs > MAX_QUEUE_DURATION_MS) fail('queue time bound is exceeded');
  if (!report.complete) fail('is not complete');
  if (!Array.isArray(report.results) || report.results.length === 0) fail('results are required');
  const keys = new Set<string>();
  for (const result of report.results) {
    if (result.epoch !== report.epoch) fail('contains stale result evidence');
    if (result.direction !== 'A → B' && result.direction !== 'B → A') fail('direction is invalid');
    nonEmpty(result.caseId, 'case ID');
    if (!/^[a-f0-9]{64}$/i.test(result.digest)) fail('digest is invalid');
    for (const [label, value] of Object.entries({ acquisitionMs: result.acquisitionMs, airtimeMs: result.airtimeMs, deliveryCount: result.deliveryCount })) finiteNonNegative(value, label);
    if (!Number.isInteger(result.deliveryCount) || result.deliveryCount !== 1 || !result.bytePerfect) fail('result delivery is not exactly once and byte-perfect');
    const key = `${result.epoch}\u0000${result.direction}\u0000${result.caseId}`;
    if (keys.has(key)) fail('contains duplicate case evidence');
    keys.add(key);
  }
  return report;
}

export async function writeMachineReport(reportPath: string, report: MachineReport): Promise<string> {
  validateMachineReport(report);
  await mkdir(path.dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, reportPath);
  return reportPath;
}

export async function readMachineReport(reportPath: string): Promise<MachineReport> {
  return validateMachineReport(JSON.parse(await readFile(reportPath, 'utf8')) as unknown);
}

export function mergeSelection(expectedHosts: readonly [string, string], first: MachineReport, second: MachineReport): SelectionReport {
  const reports: [MachineReport, MachineReport] = [validateMachineReport(first), validateMachineReport(second)];
  const reasons: string[] = [];
  if (new Set(expectedHosts).size !== 2 || new Set(reports.map((report) => report.machine.hostName)).size !== 2 || !expectedHosts.every((host) => reports.some((report) => report.machine.hostName === host))) reasons.push('exact_hosts_required');
  if (reports.some((report) => report.evidenceClass !== 'Open air')) reasons.push('open_air_evidence_required');
  if (reports.some((report) => report.codec.advertisedMtu < 1357)) reasons.push('minimum_mtu_required');
  if (reports.some((report) => report.queues.discontinuities !== 0)) reasons.push('queue_discontinuity');
  return { schemaVersion: 1, expectedHosts, decision: reasons.length === 0 ? 'selected' : 'human_needed', reasonCodes: reasons, reports };
}
