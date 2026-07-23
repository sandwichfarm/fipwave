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
  /** Present only when the local runner, not the browser, stamped identity and host evidence. */
  runner?: { machineId: string; role: 'A' | 'B'; reportTarget: string; evidenceClass: EvidenceClass; tunEvidence: TunEvidence };
}

export interface SelectionReport {
  schemaVersion: 1;
  expectedHosts: readonly [string, string];
  decision: 'cyrinx' | 'quiet' | 'unqualified' | 'human_needed';
  reasonCodes: string[];
  reports: [MachineReport, MachineReport];
}

export const TUN_EVIDENCE_CHECKS = [
  'imagePinned', 'tunDevice', 'netAdmin', 'noNewPrivileges', 'notPrivileged',
  'sysAdminAbsent', 'hostNetworkAbsent', 'loopbackPortsOnly', 'interfaceCreated',
  'ipv6Assigned', 'cleanupComplete',
] as const;

export type TunCheck = 'passed' | 'failed' | 'not_run';
export type TunEvidenceSource = 'static' | 'inspect' | 'lifecycle' | 'exact_host';

/**
 * A fixed-shape record shared by the static Compose check, fake lifecycle, and
 * exact-host capture. `source` prevents a partial check from being mistaken
 * for a complete host qualification.
 */
export interface TunEvidence {
  schemaVersion: 1;
  source: TunEvidenceSource;
  status: 'passed' | 'failed';
  image: string;
  interfaceName: 'fips-preflight0';
  ipv6Address: 'fd42:6677:6677::1/64';
  authorities: {
    devices: readonly ['/dev/net/tun'];
    capabilities: readonly ['NET_ADMIN'];
    securityOptions: readonly ['no-new-privileges:true'];
    privileged: false;
    networkMode: 'none';
    publishedPorts: readonly string[];
  };
  checks: Record<(typeof TUN_EVIDENCE_CHECKS)[number], TunCheck>;
  errors: string[];
}

function fail(message: string): never { throw new Error(`qualification report ${message}`); }
function nonEmpty(value: string, label: string): void { if (typeof value !== 'string' || value.trim() === '') fail(`${label} is required`); }
function finiteNonNegative(value: number, label: string): void { if (!Number.isFinite(value) || value < 0) fail(`${label} is invalid`); }

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function exactTunArray(value: unknown, expected: readonly string[], label: string): void {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((item, index) => item !== expected[index])) fail(`TunEvidence ${label} is invalid`);
}

export function validateTunEvidence(candidate: unknown): TunEvidence {
  const evidence = candidate as TunEvidence;
  if (!evidence || evidence.schemaVersion !== 1) fail('TunEvidence schema version is unsupported');
  if (!['static', 'inspect', 'lifecycle', 'exact_host'].includes(evidence.source)) fail('TunEvidence source is invalid');
  if (evidence.status !== 'passed' && evidence.status !== 'failed') fail('TunEvidence status is invalid');
  if (!/^alpine:3\.21\.3@sha256:[a-f0-9]{64}$/.test(evidence.image)) fail('TunEvidence image is not pinned');
  if (evidence.interfaceName !== 'fips-preflight0' || evidence.ipv6Address !== 'fd42:6677:6677::1/64') fail('TunEvidence interface is invalid');
  if (!evidence.authorities || !hasExactKeys(evidence.authorities, ['devices', 'capabilities', 'securityOptions', 'privileged', 'networkMode', 'publishedPorts'])) fail('TunEvidence authorities are incomplete');
  exactTunArray(evidence.authorities.devices, ['/dev/net/tun'], 'devices');
  exactTunArray(evidence.authorities.capabilities, ['NET_ADMIN'], 'capabilities');
  exactTunArray(evidence.authorities.securityOptions, ['no-new-privileges:true'], 'security options');
  if (evidence.authorities.privileged !== false || evidence.authorities.networkMode !== 'none') fail('TunEvidence authority is broader than allowed');
  if (!Array.isArray(evidence.authorities.publishedPorts) || evidence.authorities.publishedPorts.some((port) => typeof port !== 'string' || !/^127\.0\.0\.1:|^\[::1\]:/.test(port))) fail('TunEvidence published ports are invalid');
  if (!evidence.checks || !hasExactKeys(evidence.checks, TUN_EVIDENCE_CHECKS) || Object.values(evidence.checks).some((check) => check !== 'passed' && check !== 'failed' && check !== 'not_run')) fail('TunEvidence checks are invalid');
  if (!Array.isArray(evidence.errors) || evidence.errors.some((error) => typeof error !== 'string' || error.trim() === '')) fail('TunEvidence errors are invalid');
  const authorityChecks = TUN_EVIDENCE_CHECKS.slice(0, 8);
  const lifecycleChecks = TUN_EVIDENCE_CHECKS.slice(8);
  const required = evidence.source === 'static' || evidence.source === 'inspect' ? authorityChecks : evidence.source === 'lifecycle' ? lifecycleChecks : TUN_EVIDENCE_CHECKS;
  const inactive = evidence.source === 'static' || evidence.source === 'inspect' ? lifecycleChecks : evidence.source === 'lifecycle' ? authorityChecks : [];
  if (evidence.status === 'passed' && (required.some((check) => evidence.checks[check] !== 'passed') || inactive.some((check) => evidence.checks[check] !== 'not_run') || evidence.errors.length !== 0)) fail('TunEvidence passed status is inconsistent');
  return evidence;
}

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
  const codec = reports[0].codec;
  if (reports.some((report) => report.codec.commit !== codec.commit || report.codec.profile !== codec.profile)) reasons.push('codec_mismatch');
  const roles = new Set(reports.map((report) => report.runner?.role));
  for (const report of reports) {
    const runner = report.runner;
    if (!runner || runner.machineId !== report.machine.hostName || runner.evidenceClass !== report.evidenceClass || runner.evidenceClass !== 'Open air' || !runner.reportTarget || !runner.tunEvidence) { reasons.push('runner_authority_required'); continue; }
    try {
      const tun = validateTunEvidence(runner.tunEvidence);
      if (tun.source !== 'exact_host' || tun.status !== 'passed' || TUN_EVIDENCE_CHECKS.some((check) => tun.checks[check] !== 'passed')) reasons.push('exact_host_tun_required');
    } catch { reasons.push('exact_host_tun_required'); }
  }
  if (roles.size !== 2 || !roles.has('A') || !roles.has('B')) reasons.push('literal_roles_required');
  for (const direction of ['A → B', 'B → A'] as const) {
    const values = reports.flatMap((report) => report.results).filter((result) => result.direction === direction);
    if (new Set(values.map((result) => result.caseId)).size !== values.length || values.some((result) => result.deliveryCount !== 1 || !result.bytePerfect)) reasons.push('duplicate_or_corrupt_case');
    if (values.filter((result) => result.caseId.includes('-256-')).length < 19 || values.filter((result) => result.caseId.includes('-1536-')).length < 5) reasons.push('corpus_incomplete');
  }
  const uniqueReasons = [...new Set(reasons)];
  const selected = codec.profile === 'audible-7k-channel-0' ? 'quiet' : codec.profile.includes('cyrinx') ? 'cyrinx' : 'unqualified';
  return { schemaVersion: 1, expectedHosts, decision: uniqueReasons.length === 0 ? selected : 'human_needed', reasonCodes: uniqueReasons, reports };
}
