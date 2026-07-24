import type { AcousticSessionSnapshot } from './acoustic-session.js';

export type AcousticEvidenceClass = 'Fixture' | 'Loopback' | 'Open air';
export interface AcousticPublicStatus {
  readonly phase: string;
  readonly evidenceClass: AcousticEvidenceClass;
  readonly peer: 'configured' | 'unknown';
  readonly epoch: number;
  readonly commitAcknowledged: boolean;
  readonly currentHeartbeat: boolean;
  readonly ready: boolean;
  readonly txPackets: number;
  readonly rxPackets: number;
  readonly retries: number;
  readonly dropped: number;
  readonly duplicates: number;
  readonly queuedPackets: number;
  readonly queuedBytes: number;
  readonly reason: string | null;
}

const phases = new Set(['Idle', 'Listening', 'HelloSent', 'HelloAckSent', 'CapsSent', 'CalibratingAToB', 'CalibratingBToA', 'Committing', 'AwaitingHeartbeat', 'Ready', 'Degraded', 'Recovering', 'Error']);
const keys = ['phase', 'evidenceClass', 'peer', 'epoch', 'commitAcknowledged', 'currentHeartbeat', 'ready', 'txPackets', 'rxPackets', 'retries', 'dropped', 'duplicates', 'queuedPackets', 'queuedBytes', 'reason'] as const;
const safeReason = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9_]{1,80}$/.test(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;

/** Exact, scalar-only browser projection. It intentionally cannot carry FIPS bytes, nsecs, nonces, or raw errors. */
export function parseAcousticPublicStatus(input: unknown): AcousticPublicStatus | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key as typeof keys[number]))) return undefined;
  if (typeof value.phase !== 'string' || !phases.has(value.phase) || !['Fixture', 'Loopback', 'Open air'].includes(String(value.evidenceClass)) || (value.peer !== 'configured' && value.peer !== 'unknown') || !count(value.epoch) || typeof value.commitAcknowledged !== 'boolean' || typeof value.currentHeartbeat !== 'boolean' || typeof value.ready !== 'boolean' || !count(value.txPackets) || !count(value.rxPackets) || !count(value.retries) || !count(value.dropped) || !count(value.duplicates) || !count(value.queuedPackets) || !count(value.queuedBytes) || (value.reason !== null && !safeReason(value.reason))) return undefined;
  const ready = value.ready;
  const commitAcknowledged = value.commitAcknowledged;
  const currentHeartbeat = value.currentHeartbeat;
  const phase = value.phase;
  if (ready !== (commitAcknowledged && currentHeartbeat && phase === 'Ready')) return undefined;
  return Object.freeze(value as unknown as AcousticPublicStatus);
}

export function projectAcousticStatus(snapshot: AcousticSessionSnapshot, evidenceClass: AcousticEvidenceClass, txPackets = 0, rxPackets = 0): AcousticPublicStatus {
  const commitAcknowledged = snapshot.settingsDigest !== undefined;
  const currentHeartbeat = snapshot.ready;
  const candidate = {
    phase: snapshot.state, evidenceClass, peer: 'configured' as const, epoch: snapshot.epoch,
    commitAcknowledged, currentHeartbeat, ready: snapshot.ready,
    txPackets, rxPackets, retries: snapshot.counters.retries, dropped: snapshot.counters.dropped,
    duplicates: snapshot.counters.duplicates, queuedPackets: snapshot.counters.queuedPackets,
    queuedBytes: snapshot.counters.queuedBytes, reason: snapshot.reason ?? null,
  };
  const parsed = parseAcousticPublicStatus(candidate);
  if (!parsed) throw new Error('acoustic status projection is invalid');
  return parsed;
}
