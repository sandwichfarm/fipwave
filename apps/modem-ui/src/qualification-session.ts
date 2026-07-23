export type CyrinxStage = 'idle' | 'build' | 'digital' | 'cold-a-to-b' | 'cold-b-to-a' | 'corpus' | 'quiet' | 'complete' | 'unqualified';
export type CyrinxFailure = 'cyrinx_build_failed' | 'cyrinx_digital_roundtrip_failed' | 'cyrinx_cold_a_to_b_failed' | 'cyrinx_cold_b_to_a_failed' | 'cyrinx_corpus_failed' | 'cyrinx_deadline_expired';
export type CyrinxCodec = 'idle' | 'cyrinx' | 'quiet' | 'unqualified';
export interface CyrinxSessionSnapshot { codec: CyrinxCodec; stage: CyrinxStage; startedAtMs?: number; deadlineAtMs?: number; elapsedMs?: number; reasonCode?: CyrinxFailure; }

const REASONS = new Set<CyrinxFailure>(['cyrinx_build_failed', 'cyrinx_digital_roundtrip_failed', 'cyrinx_cold_a_to_b_failed', 'cyrinx_cold_b_to_a_failed', 'cyrinx_corpus_failed', 'cyrinx_deadline_expired']);
const STAGES = new Set<CyrinxStage>(['idle', 'build', 'digital', 'cold-a-to-b', 'cold-b-to-a', 'corpus', 'quiet', 'complete', 'unqualified']);

/**
 * A fail-closed display reducer. It never creates a deadline, chooses a codec,
 * or advances a stage: only the runner can provide those facts.
 */
export class CyrinxQualificationSession {
  #state: CyrinxSessionSnapshot = { codec: 'idle', stage: 'idle' };
  #quietStarted = false;

  get snapshot(): Readonly<CyrinxSessionSnapshot> { return { ...this.#state }; }
  get canRequestStart(): boolean { return this.#state.codec === 'idle'; }
  get shouldStartQuiet(): boolean { return this.#state.codec === 'quiet' && !this.#quietStarted; }

  apply(candidate: CyrinxSessionSnapshot): Readonly<CyrinxSessionSnapshot> {
    if (!STAGES.has(candidate.stage)) throw new Error('runner session stage is invalid');
    if (candidate.codec === 'idle') {
      if (candidate.stage !== 'idle' || this.#state.codec !== 'idle') throw new Error('runner session attempted to restart Cyrinx');
      return this.snapshot;
    }
    const startedAtMs = candidate.startedAtMs; const deadlineAtMs = candidate.deadlineAtMs; const elapsedMs = candidate.elapsedMs;
    if (typeof startedAtMs !== 'number' || typeof deadlineAtMs !== 'number' || typeof elapsedMs !== 'number' || !Number.isInteger(startedAtMs) || !Number.isInteger(deadlineAtMs) || !Number.isInteger(elapsedMs) || startedAtMs < 0 || deadlineAtMs - startedAtMs !== 5_400_000 || elapsedMs < 0) throw new Error('runner session deadline is invalid');
    if (candidate.codec === 'cyrinx' && candidate.reasonCode !== undefined) throw new Error('Cyrinx runner session cannot carry a fallback reason');
    if ((candidate.codec === 'quiet' || candidate.codec === 'unqualified') && (!candidate.reasonCode || !REASONS.has(candidate.reasonCode))) throw new Error('runner fallback reason is invalid');
    if (this.#state.codec !== 'idle') {
      if (candidate.startedAtMs !== this.#state.startedAtMs || candidate.deadlineAtMs !== this.#state.deadlineAtMs) throw new Error('runner session deadline changed');
      if ((this.#state.codec === 'quiet' || this.#state.codec === 'unqualified') && candidate.codec === 'cyrinx') throw new Error('runner session attempted to retry Cyrinx');
      if (this.#state.reasonCode && candidate.reasonCode !== this.#state.reasonCode) throw new Error('runner session changed its first failure reason');
    }
    this.#state = { ...candidate };
    return this.snapshot;
  }

  markQuietStarted(): void {
    if (!this.shouldStartQuiet) throw new Error('Quiet cannot start without an authoritative fallback');
    this.#quietStarted = true;
  }

  markQuietFailed(): void {
    if (this.#state.codec !== 'quiet') throw new Error('Quiet failure has no active fallback');
    this.#state = { ...this.#state, codec: 'unqualified', stage: 'unqualified' };
  }
}
