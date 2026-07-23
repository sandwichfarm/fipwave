import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import manifest from '../../../fixtures/corpus/manifest.json' with { type: 'json' };

export type EvidenceClass = 'Fixture' | 'Loopback' | 'Open air';
export type LiteralDirection = 'A → B' | 'B → A';
export const MAX_QUEUE_BYTES = 256 * 1024;
export const MAX_QUEUE_DURATION_MS = 10_000;
export const QUALIFICATION_DEAD_LINK_TIMEOUT_MS = 30_000;
export const CYRINX_DEADLINE_MS = 90 * 60 * 1_000;
export const QUIET_CODEC = Object.freeze({ id: 'quiet', commit: '72782542a41f1b615a02c2ab43a0edb56edb6ce4', profile: 'audible-7k-channel-0', audible: true, advertisedMtu: 1357 });
export const CYRINX_CODEC = Object.freeze({ id: 'cyrinx', commit: 'ddbd0ce4f78963403f96b0100eb49950b544aef8', profile: 'bulk-qpsk-r1-2-48k-v1', audible: true, advertisedMtu: 1792 });

export interface MachineResult {
  epoch: number;
  direction: LiteralDirection;
  caseId: string;
  size?: 256 | 1536;
  expectedSha256?: string;
  receivedSha256?: string | null;
  /** Legacy nonphysical fixture field. Physical reports use expected/receivedSha256. */
  digest?: string;
  acquisitionMs: number;
  airtimeMs: number;
  deliveryCount: number;
  bytePerfect: boolean;
  coldAcquired?: boolean;
  observed?: boolean;
  complete?: boolean;
  corrupt?: boolean;
  missing?: number;
  duplicates?: number;
}

export interface MachineReport {
  schemaVersion: 1;
  capturedAt: string;
  machine: { hostName: string; os: string; architecture: string; browserVersion: string; commit: string };
  evidenceClass: EvidenceClass;
  epoch: number;
  codec: { id?: string; commit: string; profile: string; audible?: boolean; advertisedMtu: number };
  audio: { microphoneLabel?: string; contextState?: string; inputDeviceSampleRate?: number; contextSampleRate: number; captureSampleRate: number; channels: number; echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean };
  queues: { captureHighWaterBytes: number; captureHighWaterMs: number; playbackHighWaterBytes: number; playbackHighWaterMs: number; discontinuities: number };
  results: MachineResult[];
  complete: boolean;
  reasonCodes?: string[];
  qualification?: {
    deadLinkTimeoutMs: number;
    cyrinxDeadlineMs: number;
    deadline: { startedAtMs: number | null; deadlineAtMs: number | null; elapsedMs: number | null };
    physicalGate: 'not_physical' | 'pending' | 'failed' | 'passed';
    fallback: { codecId: 'quiet'; state: 'available' | 'activated' | 'failed'; reasonCode: string | null };
  };
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

type ManifestCase = { id: string; direction: LiteralDirection; size: 256 | 1536; sha256: string };
const MANIFEST = new Map((manifest.cases as ManifestCase[]).map((entry) => [entry.id, entry]));

export class QualificationReportError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, detail?: string) {
    super(`qualification report ${reasonCode}${detail ? `: ${detail}` : ''}`);
    this.reasonCode = reasonCode;
  }
}
function fail(reasonCode: string, detail?: string): never { throw new QualificationReportError(reasonCode, detail); }
export function qualificationReason(error: unknown, fallback = 'invalid_machine_report'): string {
  return error instanceof QualificationReportError ? error.reasonCode : fallback;
}
function nonEmpty(value: unknown, reasonCode: string): asserts value is string { if (typeof value !== 'string' || value.trim() === '') fail(reasonCode); }
function finiteNonNegative(value: unknown, reasonCode: string): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(reasonCode); }
function integerNonNegative(value: unknown, reasonCode: string): asserts value is number { if (!Number.isInteger(value) || (value as number) < 0) fail(reasonCode); }
function digest(value: unknown, reasonCode: string): asserts value is string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) fail(reasonCode); }
function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function exactTunArray(value: unknown, expected: readonly string[], reasonCode: string): void {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((item, index) => item !== expected[index])) fail(reasonCode);
}

export function validateTunEvidence(candidate: unknown): TunEvidence {
  const evidence = candidate as TunEvidence;
  if (!evidence || evidence.schemaVersion !== 1) fail('tun_schema_unsupported');
  if (!['static', 'inspect', 'lifecycle', 'exact_host'].includes(evidence.source)) fail('tun_source_invalid');
  if (evidence.status !== 'passed' && evidence.status !== 'failed') fail('tun_status_invalid');
  if (!/^alpine:3\.21\.3@sha256:[a-f0-9]{64}$/.test(evidence.image)) fail('tun_image_not_pinned');
  if (evidence.interfaceName !== 'fips-preflight0' || evidence.ipv6Address !== 'fd42:6677:6677::1/64') fail('tun_interface_invalid');
  if (!evidence.authorities || !exactKeys(evidence.authorities, ['devices', 'capabilities', 'securityOptions', 'privileged', 'networkMode', 'publishedPorts'])) fail('tun_authorities_incomplete');
  exactTunArray(evidence.authorities.devices, ['/dev/net/tun'], 'tun_devices_invalid');
  exactTunArray(evidence.authorities.capabilities, ['NET_ADMIN'], 'tun_capabilities_invalid');
  exactTunArray(evidence.authorities.securityOptions, ['no-new-privileges:true'], 'tun_security_options_invalid');
  if (evidence.authorities.privileged !== false || evidence.authorities.networkMode !== 'none') fail('tun_authority_too_broad');
  if (!Array.isArray(evidence.authorities.publishedPorts) || evidence.authorities.publishedPorts.some((port) => typeof port !== 'string' || !/^(127\.0\.0\.1|\[::1\]):/.test(port))) fail('tun_published_ports_invalid');
  if (!evidence.checks || !exactKeys(evidence.checks, TUN_EVIDENCE_CHECKS) || Object.values(evidence.checks).some((check) => check !== 'passed' && check !== 'failed' && check !== 'not_run')) fail('tun_checks_invalid');
  if (!Array.isArray(evidence.errors) || evidence.errors.some((error) => typeof error !== 'string' || error.trim() === '')) fail('tun_errors_invalid');
  const authorityChecks = TUN_EVIDENCE_CHECKS.slice(0, 8); const lifecycleChecks = TUN_EVIDENCE_CHECKS.slice(8);
  const required = evidence.source === 'static' || evidence.source === 'inspect' ? authorityChecks : evidence.source === 'lifecycle' ? lifecycleChecks : TUN_EVIDENCE_CHECKS;
  const inactive = evidence.source === 'static' || evidence.source === 'inspect' ? lifecycleChecks : evidence.source === 'lifecycle' ? authorityChecks : [];
  if (evidence.status === 'passed' && (required.some((check) => evidence.checks[check] !== 'passed') || inactive.some((check) => evidence.checks[check] !== 'not_run') || evidence.errors.length !== 0)) fail('tun_passed_status_inconsistent');
  return evidence;
}

export function validateMachineReport(candidate: unknown): MachineReport {
  const report = candidate as MachineReport;
  if (!report || report.schemaVersion !== 1) fail('schema_unsupported');
  if (typeof report.capturedAt !== 'string' || Number.isNaN(Date.parse(report.capturedAt))) fail('captured_at_invalid');
  if (!report.machine || !exactKeys(report.machine, ['hostName', 'os', 'architecture', 'browserVersion', 'commit'])) fail('machine_identity_incomplete');
  for (const [key, value] of Object.entries(report.machine)) nonEmpty(value, `machine_${key}_required`);
  if (!['Fixture', 'Loopback', 'Open air'].includes(report.evidenceClass)) fail('evidence_class_invalid');
  integerNonNegative(report.epoch, 'epoch_invalid');
  nonEmpty(report.codec?.commit, 'codec_commit_required'); nonEmpty(report.codec?.profile, 'codec_profile_required');
  if (!Number.isInteger(report.codec?.advertisedMtu) || report.codec.advertisedMtu <= 0) fail('advertised_mtu_invalid');
  const physical = report.evidenceClass === 'Open air';
  const legacyAudioKeys = ['contextSampleRate', 'captureSampleRate', 'channels', 'echoCancellation', 'noiseSuppression', 'autoGainControl'];
  const physicalAudioKeys = ['microphoneLabel', 'contextState', 'inputDeviceSampleRate', ...legacyAudioKeys];
  if (!report.audio || !exactKeys(report.audio, physical ? physicalAudioKeys : legacyAudioKeys) && !exactKeys(report.audio, physicalAudioKeys)) fail('audio_evidence_incomplete');
  for (const [key, value] of Object.entries(report.audio)) {
    if (key.endsWith('Rate') || key === 'channels') finiteNonNegative(value, `audio_${key}_invalid`);
    else if (key === 'microphoneLabel' || key === 'contextState') nonEmpty(value, `audio_${key}_invalid`);
    else if (typeof value !== 'boolean') fail(`audio_${key}_invalid`);
  }
  if (!report.queues || !exactKeys(report.queues, ['captureHighWaterBytes', 'captureHighWaterMs', 'playbackHighWaterBytes', 'playbackHighWaterMs', 'discontinuities'])) fail('queue_evidence_incomplete');
  for (const [key, value] of Object.entries(report.queues)) finiteNonNegative(value, `queue_${key}_invalid`);
  if (typeof report.complete !== 'boolean' || !Array.isArray(report.results)) fail('report_state_invalid');
  if (report.reasonCodes !== undefined && (!Array.isArray(report.reasonCodes) || report.reasonCodes.some((reason) => typeof reason !== 'string' || reason.trim() === ''))) fail('reason_codes_invalid');
  if (physical) {
    if (!/^[a-f0-9]{40}$/.test(report.machine.commit)) fail('build_identity_invalid');
    nonEmpty(report.codec.id, 'codec_id_required');
    if (typeof report.codec.audible !== 'boolean') fail('codec_audibility_required');
    const qualification = report.qualification;
    if (!qualification || qualification.deadLinkTimeoutMs !== QUALIFICATION_DEAD_LINK_TIMEOUT_MS || qualification.cyrinxDeadlineMs !== CYRINX_DEADLINE_MS) fail('qualification_policy_invalid');
    const deadline = qualification.deadline;
    if (!deadline || !exactKeys(deadline, ['startedAtMs', 'deadlineAtMs', 'elapsedMs'])) fail('qualification_deadline_invalid');
    for (const value of [deadline.startedAtMs, deadline.deadlineAtMs, deadline.elapsedMs]) if (value !== null) finiteNonNegative(value, 'qualification_deadline_invalid');
    if ((deadline.startedAtMs === null) !== (deadline.deadlineAtMs === null) || (deadline.startedAtMs !== null && deadline.deadlineAtMs! - deadline.startedAtMs !== CYRINX_DEADLINE_MS)) fail('qualification_deadline_invalid');
    if (!['pending', 'failed', 'passed'].includes(qualification.physicalGate)) fail('physical_gate_invalid');
    if (!qualification.fallback || qualification.fallback.codecId !== 'quiet' || !['available', 'activated', 'failed'].includes(qualification.fallback.state) || (qualification.fallback.reasonCode !== null && (typeof qualification.fallback.reasonCode !== 'string' || qualification.fallback.reasonCode.trim() === ''))) fail('fallback_state_invalid');
  }
  for (const result of report.results) {
    if (result.epoch !== report.epoch) fail('stale_epoch');
    if (result.direction !== 'A → B' && result.direction !== 'B → A') fail('direction_invalid');
    nonEmpty(result.caseId, 'case_id_required');
    const committed = MANIFEST.get(result.caseId);
    if (!committed) fail('unknown_case');
    if (committed.direction !== result.direction) fail('manifest_direction_mismatch');
    finiteNonNegative(result.acquisitionMs, 'acquisition_time_invalid'); finiteNonNegative(result.airtimeMs, 'airtime_invalid'); integerNonNegative(result.deliveryCount, 'delivery_count_invalid');
    if (typeof result.bytePerfect !== 'boolean') fail('byte_perfect_invalid');
    if (physical) {
      if (result.size !== committed.size) fail('manifest_size_mismatch');
      if (result.expectedSha256 !== committed.sha256) fail('manifest_digest_mismatch');
      if (result.receivedSha256 !== null) digest(result.receivedSha256, 'received_digest_invalid');
      if (typeof result.coldAcquired !== 'boolean' || typeof result.observed !== 'boolean' || typeof result.complete !== 'boolean' || typeof result.corrupt !== 'boolean') fail('result_state_incomplete');
      integerNonNegative(result.missing, 'missing_count_invalid'); integerNonNegative(result.duplicates, 'duplicate_count_invalid');
    } else if (result.digest !== undefined) {
      digest(result.digest, 'digest_invalid');
    }
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

function add(reasons: string[], reason: string): void { if (!reasons.includes(reason)) reasons.push(reason); }
function exactCodec(codec: MachineReport['codec']): 'quiet' | 'cyrinx' | undefined {
  for (const candidate of [QUIET_CODEC, CYRINX_CODEC] as const) {
    if (codec.id === candidate.id && codec.commit === candidate.commit && codec.profile === candidate.profile && codec.audible === candidate.audible && codec.advertisedMtu === candidate.advertisedMtu) return candidate.id;
  }
  return undefined;
}
function p95(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
}
function qualifying(result: MachineResult): boolean {
  return result.observed === true && result.complete === true && result.corrupt === false && result.missing === 0 && result.duplicates === 0 && result.deliveryCount === 1 && result.bytePerfect && result.receivedSha256 === result.expectedSha256;
}

export function mergeSelection(expectedHosts: readonly [string, string], machineA: MachineReport, machineB: MachineReport): SelectionReport {
  const reports: [MachineReport, MachineReport] = [validateMachineReport(machineA), validateMachineReport(machineB)];
  const reasons: string[] = [];
  if (expectedHosts.length !== 2 || expectedHosts[0] === expectedHosts[1]) add(reasons, 'exact_hosts_required');
  if (reports[0].machine.hostName !== expectedHosts[0] || reports[1].machine.hostName !== expectedHosts[1]) add(reasons, 'ordered_hosts_required');
  const nonphysical = reports.some((report) => report.evidenceClass !== 'Open air');
  if (nonphysical) add(reasons, 'non_physical_evidence');
  if (reports[0].runner?.role !== 'A' || reports[1].runner?.role !== 'B') add(reasons, 'ordered_roles_required');
  if (reports.some((report) => !report.runner || report.runner.machineId !== report.machine.hostName || report.runner.evidenceClass !== report.evidenceClass || !report.runner.reportTarget)) add(reasons, 'runner_authority_required');
  if (reports[0].machine.commit !== reports[1].machine.commit) add(reasons, 'build_mismatch');
  if (reports.some((report) => !report.audio.microphoneLabel || report.audio.contextState !== 'running' || report.audio.inputDeviceSampleRate !== 44_100 && report.audio.inputDeviceSampleRate !== 48_000 || report.audio.contextSampleRate !== 48_000 || report.audio.captureSampleRate !== 48_000 || report.audio.channels !== 1 || report.audio.echoCancellation || report.audio.noiseSuppression || report.audio.autoGainControl)) add(reasons, 'audio_preflight_failed');
  if (reports.some((report) => report.queues.captureHighWaterBytes > MAX_QUEUE_BYTES || report.queues.playbackHighWaterBytes > MAX_QUEUE_BYTES || report.queues.captureHighWaterMs > MAX_QUEUE_DURATION_MS || report.queues.playbackHighWaterMs > MAX_QUEUE_DURATION_MS)) add(reasons, 'queue_bound_exceeded');
  if (reports.some((report) => report.queues.discontinuities !== 0)) add(reasons, 'queue_discontinuity');
  for (const report of reports) {
    try {
      const tun = validateTunEvidence(report.runner?.tunEvidence);
      if (tun.source !== 'exact_host' || tun.status !== 'passed' || TUN_EVIDENCE_CHECKS.some((check) => tun.checks[check] !== 'passed')) add(reasons, 'exact_host_tun_required');
    } catch { add(reasons, 'exact_host_tun_required'); }
  }
  const firstCodec = reports[0].codec;
  if (reports.some((report) => report.codec.id !== firstCodec.id || report.codec.commit !== firstCodec.commit || report.codec.profile !== firstCodec.profile || report.codec.audible !== firstCodec.audible || report.codec.advertisedMtu !== firstCodec.advertisedMtu)) add(reasons, 'codec_mismatch');
  const selected = exactCodec(firstCodec);
  if (!selected) add(reasons, 'unsupported_codec');
  if (selected === 'quiet' && reports.some((report) => report.qualification?.fallback.state !== 'activated' || !report.qualification.fallback.reasonCode)) add(reasons, 'quiet_fallback_not_activated');
  if (selected === 'cyrinx' && reports.some((report) => report.qualification?.fallback.state === 'activated')) add(reasons, 'unexpected_fallback_activation');
  if (reports.some((report) => report.qualification?.deadline.startedAtMs === null || report.qualification?.deadline.deadlineAtMs === null || report.qualification?.deadline.elapsedMs === null)) add(reasons, 'cyrinx_deadline_evidence_required');
  if (reports.some((report) => report.codec.audible !== true)) add(reasons, 'audible_profile_required');
  if (reports.some((report) => report.codec.advertisedMtu < 1357)) add(reasons, 'minimum_mtu_required');
  for (const [index, report] of reports.entries()) {
    const expectedDirection: LiteralDirection = index === 0 ? 'B → A' : 'A → B';
    if (report.results.some((result) => result.direction !== expectedDirection)) add(reasons, 'independent_direction_required');
    const sameDirection = report.results.filter((result) => result.direction === expectedDirection);
    const expectedCases = [...MANIFEST.values()].filter((entry) => entry.direction === expectedDirection);
    if (sameDirection.length !== expectedCases.length || expectedCases.some((entry) => !sameDirection.some((result) => result.caseId === entry.id))) add(reasons, 'manifest_cases_missing');
    const keys = new Set<string>();
    for (const result of sameDirection) {
      if (keys.has(result.caseId) || result.observed && ((result.duplicates ?? 0) > 0 || result.deliveryCount !== 1)) add(reasons, 'duplicate_case');
      keys.add(result.caseId);
      if (result.observed && (result.receivedSha256 !== result.expectedSha256 || !result.bytePerfect || result.corrupt)) add(reasons, 'bad_digest');
      if (result.observed && (!result.complete || (result.missing ?? 0) > 0)) add(reasons, 'partial_evidence');
    }
    const good = sameDirection.filter(qualifying);
    if (good.filter((result) => result.size === 256).length < 19 || good.filter((result) => result.size === 1536).length < 5) add(reasons, 'corpus_incomplete');
    if (!good.some((result) => result.coldAcquired)) add(reasons, 'cold_acquisition_failed');
    const timeout = report.qualification?.deadLinkTimeoutMs;
    if (timeout !== QUALIFICATION_DEAD_LINK_TIMEOUT_MS || p95(good.map((result) => result.airtimeMs)) >= QUALIFICATION_DEAD_LINK_TIMEOUT_MS / 3) add(reasons, 'airtime_budget_exceeded');
    if (report.qualification?.physicalGate !== 'passed' || !report.complete) add(reasons, 'physical_gate_failed');
  }
  return { schemaVersion: 1, expectedHosts, decision: nonphysical ? 'human_needed' : reasons.length === 0 && selected ? selected : 'unqualified', reasonCodes: reasons, reports };
}
