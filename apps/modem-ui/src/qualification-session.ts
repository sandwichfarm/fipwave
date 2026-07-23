export type CyrinxStage = 'idle' | 'build' | 'digital' | 'cold-a-to-b' | 'cold-b-to-a' | 'corpus' | 'quiet' | 'complete' | 'unqualified';
export type CyrinxFailure = 'cyrinx_build_failed' | 'cyrinx_digital_roundtrip_failed' | 'cyrinx_cold_a_to_b_failed' | 'cyrinx_cold_b_to_a_failed' | 'cyrinx_corpus_failed' | 'cyrinx_deadline_expired';
export interface CyrinxSessionSnapshot { codec: 'idle' | 'cyrinx' | 'quiet' | 'unqualified'; stage: CyrinxStage; startedAtMs?: number; deadlineAtMs?: number; elapsedMs?: number; reasonCode?: CyrinxFailure; }
const STAGES: readonly CyrinxStage[] = ['build', 'digital', 'cold-a-to-b', 'cold-b-to-a', 'corpus'];
const REASONS = new Set<CyrinxFailure>(['cyrinx_build_failed', 'cyrinx_digital_roundtrip_failed', 'cyrinx_cold_a_to_b_failed', 'cyrinx_cold_b_to_a_failed', 'cyrinx_corpus_failed', 'cyrinx_deadline_expired']);

/** Browser-display reducer; the runner must mirror this snapshot as the authority in its report. */
export class CyrinxQualificationSession {
  #state: CyrinxSessionSnapshot = { codec: 'idle', stage: 'idle' };
  constructor(private readonly now: () => number = Date.now) {}
  start(now = this.now()): CyrinxSessionSnapshot { if (this.#state.codec === 'idle') this.#state = { codec: 'cyrinx', stage: 'build', startedAtMs: now, deadlineAtMs: now + 5_400_000, elapsedMs: 0 }; return this.snapshot(now); }
  pass(stage: Exclude<CyrinxStage, 'idle' | 'quiet' | 'complete' | 'unqualified'>, now = this.now()): CyrinxSessionSnapshot { this.expire(now); if (this.#state.codec !== 'cyrinx' || this.#state.stage !== stage) throw new Error('qualification stage is out of order'); const next = STAGES[STAGES.indexOf(stage) + 1]; this.#state = { ...this.#state, stage: next ?? 'complete', elapsedMs: now - this.#state.startedAtMs! }; return this.snapshot(now); }
  fail(reason: CyrinxFailure, now = this.now()): CyrinxSessionSnapshot { if (!REASONS.has(reason)) throw new Error('qualification reason is invalid'); if (this.#state.codec === 'cyrinx') this.#state = { codec: 'quiet', stage: 'quiet', startedAtMs: this.#state.startedAtMs!, deadlineAtMs: this.#state.deadlineAtMs!, elapsedMs: Math.max(0, now - this.#state.startedAtMs!), reasonCode: reason }; return this.snapshot(now); }
  expire(now = this.now()): CyrinxSessionSnapshot { if (this.#state.codec === 'cyrinx' && now >= this.#state.deadlineAtMs!) return this.fail('cyrinx_deadline_expired', now); return this.snapshot(now); }
  failQuiet(): CyrinxSessionSnapshot { if (this.#state.codec === 'quiet') this.#state = { ...this.#state, codec: 'unqualified', stage: 'unqualified' }; return this.snapshot(); }
  snapshot(now = this.now()): CyrinxSessionSnapshot { return this.#state.codec === 'cyrinx' ? { ...this.#state, elapsedMs: Math.max(0, now - this.#state.startedAtMs!) } : { ...this.#state }; }
}
