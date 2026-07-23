import { MAX_QUEUE_BYTES, MAX_QUEUE_DURATION_MS, type EvidenceClass, type LiteralDirection } from '../../../packages/bridge/src/report.js';
import type { AdapterResult, QualificationCase } from '../../../packages/bridge/src/codecs/types.js';

export type GateDecision = {
  decision: 'pending' | 'human_needed' | 'rejected' | 'cyrinx' | 'quiet' | 'unqualified';
  reasonCodes: string[];
};

export interface GateOptions { expectedEpoch: number; deadLinkTimeoutMs: number; nowMs?: number; }
export interface SelectionOptions { expectedHosts: readonly [string, string]; evidenceClass?: EvidenceClass; }

const VALID_DIRECTIONS: readonly LiteralDirection[] = ['A → B', 'B → A'];
const QUALIFYING_SMALL = 19;
const QUALIFYING_LARGE = 5;

function invalidResult(result: AdapterResult, options: GateOptions): string | undefined {
  if (result.epoch !== options.expectedEpoch) return 'stale_epoch';
  if (!result.complete) return 'partial_evidence';
  if (!VALID_DIRECTIONS.includes(result.direction) || result.caseId.trim() === '') return 'missing_case';
  if (!/^[a-f0-9]{64}$/i.test(result.digest) || !result.bytePerfect) return 'bad_digest';
  if (result.deliveryCount !== 1) return 'delivery_not_exactly_once';
  if (!result.coldAcquired) return 'cold_acquisition_failed';
  if (!result.audioPassed) return 'audio_preflight_failed';
  if (!Number.isFinite(options.deadLinkTimeoutMs) || options.deadLinkTimeoutMs <= 0) return 'dead_link_timeout_invalid';
  if (result.profile.advertisedMtu < 1357) return 'minimum_mtu_required';
  if (!result.profile.audible) return 'audible_profile_required';
  if (result.airtimeMs < 0 || result.airtimeMs >= options.deadLinkTimeoutMs / 3) return 'airtime_budget_exceeded';
  const queues = result.queues;
  if (queues.captureHighWaterBytes > MAX_QUEUE_BYTES || queues.playbackHighWaterBytes > MAX_QUEUE_BYTES || queues.captureHighWaterMs > MAX_QUEUE_DURATION_MS || queues.playbackHighWaterMs > MAX_QUEUE_DURATION_MS || queues.discontinuities > 0) return 'queue_bound_exceeded';
  return result.reasonCode;
}

/** The sole deterministic reducer for Fixture, native command, and browser WS adapters. */
export class QualificationGate {
  #seen = new Set<string>();
  #decision: GateDecision = { decision: 'pending', reasonCodes: [] };

  constructor(private readonly options: GateOptions) {}

  accept(result: AdapterResult): GateDecision {
    if (this.#decision.decision === 'rejected' || this.#decision.decision === 'unqualified') return this.#decision;
    const invalid = invalidResult(result, this.options);
    const identity = `${result.epoch}\u0000${result.direction}\u0000${result.caseId}`;
    if (invalid) return this.reject(invalid);
    if (this.#seen.has(identity)) return this.reject('duplicate_case');
    this.#seen.add(identity);
    if (result.evidenceClass !== 'Open air') {
      this.#decision = { decision: 'human_needed', reasonCodes: ['non_physical_evidence'] };
    }
    return this.#decision;
  }

  reject(reason: string): GateDecision {
    this.#decision = { decision: 'rejected', reasonCodes: [reason] };
    return this.#decision;
  }
}

export function reduceQualificationEvent(gate: QualificationGate, result: AdapterResult): GateDecision {
  return gate.accept(result);
}

/** Evaluates an evidence set without allowing fixture/loopback paths to create a selection. */
export function evaluateSelection(results: readonly AdapterResult[], options: SelectionOptions): GateDecision {
  if (options.expectedHosts.length !== 2 || options.expectedHosts[0] === options.expectedHosts[1]) return { decision: 'human_needed', reasonCodes: ['exact_hosts_required'] };
  if (!results.length || results.some((result) => result.evidenceClass !== 'Open air')) return { decision: 'human_needed', reasonCodes: ['open_air_evidence_required'] };
  const perDirection = new Map<LiteralDirection, QualificationCase[]>();
  for (const result of results) {
    const bucket = perDirection.get(result.direction) ?? [];
    bucket.push({ id: result.caseId, direction: result.direction, size: result.caseId.includes('1536') ? 1536 : 256, digest: result.digest, payload: new Uint8Array() });
    perDirection.set(result.direction, bucket);
  }
  for (const direction of VALID_DIRECTIONS) {
    const values = perDirection.get(direction) ?? [];
    if (new Set(values.map((value) => value.id)).size !== values.length) return { decision: 'unqualified', reasonCodes: ['duplicate_case'] };
    if (values.filter((value) => value.size === 256).length < QUALIFYING_SMALL || values.filter((value) => value.size === 1536).length < QUALIFYING_LARGE) return { decision: 'human_needed', reasonCodes: ['corpus_incomplete'] };
  }
  const profile = results[0]!.profile;
  if (results.some((result) => result.profile.codec !== profile.codec || result.profile.name !== profile.name)) return { decision: 'unqualified', reasonCodes: ['profile_mismatch'] };
  return { decision: profile.codec === 'cyrinx' ? 'cyrinx' : profile.codec === 'quiet' ? 'quiet' : 'unqualified', reasonCodes: profile.codec === 'cyrinx' || profile.codec === 'quiet' ? [] : ['unsupported_codec'] };
}
