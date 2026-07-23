import { createHash } from 'node:crypto';

import manifest from '../../../fixtures/corpus/manifest.json' with { type: 'json' };
import {
  CYRINX_DEADLINE_MS,
  CYRINX_FALLBACK_REASONS,
  type LiteralDirection,
} from './report.js';

export type CyrinxFallbackReason = (typeof CYRINX_FALLBACK_REASONS)[number];
export type CyrinxStage =
  | 'idle'
  | 'build'
  | 'digital'
  | 'cold-a-to-b'
  | 'cold-b-to-a'
  | 'corpus'
  | 'complete'
  | 'quiet'
  | 'unqualified';
export type CyrinxSessionCodec = 'idle' | 'cyrinx' | 'quiet' | 'unqualified';
export type CyrinxInstructionAction = 'transmit' | 'listen';
/**
 * 131072 samples at 48 kHz (2731 ms), plus the viable ~1.3 s cold-start skew
 * and native/browser scheduling headroom. This prevents consecutive
 * same-direction frames from overlapping the peer's capture window.
 */
export const CYRINX_TRANSMIT_SETTLE_MS = 4_500;

export interface CyrinxQualificationCase {
  id: string;
  direction: LiteralDirection;
  payload: Uint8Array;
  digest: string;
  size: 256 | 1536;
  cold: boolean;
}

export interface CyrinxInstruction {
  action: CyrinxInstructionAction;
  caseId: string;
  direction: LiteralDirection;
  cold: boolean;
}

export interface CyrinxSessionSnapshot {
  kind: 'cyrinx-session';
  epoch: number;
  codec: CyrinxSessionCodec;
  stage: CyrinxStage;
  deadline: {
    startedAtMs: number | null;
    deadlineAtMs: number | null;
    elapsedMs: number | null;
  };
  fallback: {
    codecId: 'quiet';
    state: 'available' | 'activated' | 'failed';
    reasonCode: CyrinxFallbackReason | null;
  };
  instruction: CyrinxInstruction | null;
  terminal: boolean;
}

type CorpusManifestCase = {
  id: string;
  direction: LiteralDirection;
  size: 256 | 1536;
  pattern: 'all-zero' | 'all-ff' | 'incrementing' | 'alternating' | 'pseudorandom';
  sha256: string;
};

const CORPUS_SEED = 'fipwave-phase-01-corpus-v1';

function manifestPayload(entry: CorpusManifestCase): Buffer {
  const index = Number(entry.id.slice(-2)) - 1;
  const bytes = Buffer.alloc(entry.size);
  if (entry.pattern === 'all-ff') return bytes.fill(0xff);
  if (entry.pattern === 'incrementing') {
    for (let offset = 0; offset < bytes.length; offset += 1) bytes[offset] = (offset + index) & 0xff;
  } else if (entry.pattern === 'alternating') {
    for (let offset = 0; offset < bytes.length; offset += 1) bytes[offset] = (offset + index) % 2 ? 0x55 : 0xaa;
  } else if (entry.pattern === 'pseudorandom') {
    let state = createHash('sha256')
      .update(`${CORPUS_SEED}:${entry.direction}:${entry.size}:${index}`)
      .digest()
      .readUInt32LE(0);
    for (let offset = 0; offset < bytes.length; offset += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      bytes[offset] = state >>> 24;
    }
  }
  return bytes;
}

function corpusCase(entry: CorpusManifestCase): CyrinxQualificationCase {
  const payload = manifestPayload(entry);
  const digest = createHash('sha256').update(payload).digest('hex');
  if (digest !== entry.sha256) throw new Error(`committed corpus payload drift: ${entry.id}`);
  return {
    id: entry.id,
    direction: entry.direction,
    payload,
    digest,
    size: entry.size,
    cold: false,
  };
}

function coldCase(id: string, direction: LiteralDirection, fill: number): CyrinxQualificationCase {
  const payload = Buffer.alloc(256, fill);
  return {
    id,
    direction,
    payload,
    digest: createHash('sha256').update(payload).digest('hex'),
    size: 256,
    cold: true,
  };
}

const ORDERED_CASES: readonly CyrinxQualificationCase[] = Object.freeze([
  coldCase('cyrinx-cold-a-to-b', 'A → B', 0x3c),
  coldCase('cyrinx-cold-b-to-a', 'B → A', 0xc3),
  ...(manifest.cases as CorpusManifestCase[]).map(corpusCase),
]);

export function cyrinxDigitalCases(): readonly CyrinxQualificationCase[] {
  const corpus = ORDERED_CASES.slice(2);
  const small = corpus.find((value) => value.size === 256);
  const large = corpus.find((value) => value.size === 1536);
  if (!small || !large) throw new Error('committed corpus is missing digital gate cases');
  return [small, large].map((value) => ({ ...value, payload: Buffer.from(value.payload) }));
}

export class QualificationSessionError extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
  }
}

function reject(reasonCode: string): never {
  throw new QualificationSessionError(reasonCode);
}

function checkedNow(nowMs: number): number {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) reject('qualification_clock_invalid');
  return nowMs;
}

function actionFor(role: 'A' | 'B', direction: LiteralDirection): CyrinxInstructionAction {
  const localDirection: LiteralDirection = role === 'A' ? 'A → B' : 'B → A';
  return direction === localDirection ? 'transmit' : 'listen';
}

function stageForCase(index: number): CyrinxStage {
  if (index === 0) return 'cold-a-to-b';
  if (index === 1) return 'cold-b-to-a';
  return 'corpus';
}

export function failureReasonForStage(stage: CyrinxStage): CyrinxFallbackReason {
  if (stage === 'build') return 'cyrinx_build_failed';
  if (stage === 'digital') return 'cyrinx_digital_roundtrip_failed';
  if (stage === 'cold-a-to-b') return 'cyrinx_cold_a_to_b_failed';
  if (stage === 'cold-b-to-a') return 'cyrinx_cold_b_to_a_failed';
  if (stage === 'corpus') return 'cyrinx_corpus_failed';
  reject('qualification_stage_not_failable');
}

/**
 * Authoritative state for one runner process. Browser messages may acknowledge
 * an instruction, but they cannot choose codec, stage, direction, or timing.
 */
export class CyrinxQualificationSession {
  readonly role: 'A' | 'B';
  #codec: CyrinxSessionCodec = 'idle';
  #stage: CyrinxStage = 'idle';
  #startedAtMs: number | null = null;
  #deadlineAtMs: number | null = null;
  #lastElapsedMs: number | null = null;
  #terminalElapsedMs: number | null = null;
  #fallbackState: 'available' | 'activated' | 'failed' = 'available';
  #fallbackReason: CyrinxFallbackReason | null = null;
  #caseIndex: number | null = null;
  #accepted:
    | { caseIndex: number; mode: CyrinxInstructionAction; acceptedAtMs: number }
    | undefined;
  #coldReceivePassed = false;

  constructor(role: 'A' | 'B') {
    if (role !== 'A' && role !== 'B') reject('qualification_role_invalid');
    this.role = role;
  }

  get stage(): CyrinxStage {
    return this.#stage;
  }

  get codec(): CyrinxSessionCodec {
    return this.#codec;
  }

  get terminal(): boolean {
    return this.#stage === 'complete' || this.#stage === 'quiet' || this.#stage === 'unqualified';
  }

  get coldReceivePassed(): boolean {
    return this.#coldReceivePassed;
  }

  get fallbackReason(): CyrinxFallbackReason | null {
    return this.#fallbackReason;
  }

  get fallbackState(): 'available' | 'activated' | 'failed' {
    return this.#fallbackState;
  }

  start(nowMs: number): boolean {
    checkedNow(nowMs);
    if (this.#stage !== 'idle') return false;
    this.#codec = 'cyrinx';
    this.#stage = 'build';
    this.#startedAtMs = nowMs;
    this.#deadlineAtMs = nowMs + CYRINX_DEADLINE_MS;
    this.#lastElapsedMs = 0;
    return true;
  }

  completeBuild(nowMs: number): void {
    this.#assertStage('build');
    this.#assertBeforeDeadline(nowMs);
    this.#stage = 'digital';
  }

  completeDigital(nowMs: number): void {
    this.#assertStage('digital');
    this.#assertBeforeDeadline(nowMs);
    this.#caseIndex = 0;
    this.#stage = stageForCase(0);
  }

  currentCase(): CyrinxQualificationCase | undefined {
    if (this.#caseIndex === null) return undefined;
    const value = ORDERED_CASES[this.#caseIndex];
    return value ? { ...value, payload: Buffer.from(value.payload) } : undefined;
  }

  acceptInstruction(
    caseId: string,
    direction: LiteralDirection,
    nowMs: number,
  ): { value: CyrinxQualificationCase; mode: CyrinxInstructionAction } {
    this.#assertBeforeDeadline(nowMs);
    const value = this.currentCase();
    if (!value || this.terminal) reject('qualification_instruction_unavailable');
    if (this.#accepted) reject('qualification_instruction_already_accepted');
    if (caseId !== value.id || direction !== value.direction) reject('qualification_instruction_mismatch');
    const mode = actionFor(this.role, value.direction);
    this.#accepted = { caseIndex: this.#caseIndex!, mode, acceptedAtMs: checkedNow(nowMs) };
    return { value, mode };
  }

  canReceiveCapture(): boolean {
    return this.#accepted?.mode === 'listen'
      && this.#accepted.caseIndex === this.#caseIndex
      && !this.terminal;
  }

  transmitSettleRemaining(nowMs: number): number {
    return this.caseSettleRemaining('transmit', nowMs);
  }

  caseSettleRemaining(mode: CyrinxInstructionAction, nowMs: number): number {
    const accepted = this.#accepted;
    if (!accepted || accepted.caseIndex !== this.#caseIndex) {
      reject('qualification_instruction_not_accepted');
    }
    if (accepted.mode !== mode) reject('qualification_instruction_mode_mismatch');
    const elapsed = Math.max(0, checkedNow(nowMs) - accepted.acceptedAtMs);
    return Math.max(0, CYRINX_TRANSMIT_SETTLE_MS - elapsed);
  }

  completeAccepted(mode: CyrinxInstructionAction, nowMs: number): void {
    this.#assertBeforeDeadline(nowMs);
    const accepted = this.#accepted;
    if (!accepted || accepted.caseIndex !== this.#caseIndex) {
      reject('qualification_instruction_not_accepted');
    }
    if (accepted.mode !== mode) reject('qualification_instruction_mode_mismatch');
    const value = this.currentCase();
    if (!value) reject('qualification_instruction_unavailable');
    if (mode === 'listen' && value.cold) this.#coldReceivePassed = true;
    this.#accepted = undefined;
    const nextIndex = accepted.caseIndex + 1;
    if (nextIndex >= ORDERED_CASES.length) {
      this.#caseIndex = null;
      this.#stage = 'complete';
      this.#terminalElapsedMs = this.#elapsed(nowMs);
      return;
    }
    this.#caseIndex = nextIndex;
    this.#stage = stageForCase(nextIndex);
  }

  abortCase(): void {
    this.#accepted = undefined;
  }

  operatorReset(nowMs: number): boolean {
    this.#accepted = undefined;
    if (this.#codec !== 'cyrinx' || this.terminal || this.#stage === 'idle') return false;
    return this.failCurrent(nowMs);
  }

  expire(nowMs: number): boolean {
    if (
      this.#startedAtMs === null
      || this.#deadlineAtMs === null
      || this.terminal
      || this.#codec !== 'cyrinx'
    ) return false;
    const now = checkedNow(nowMs);
    this.#elapsed(now);
    if (now < this.#deadlineAtMs && this.#lastElapsedMs! < CYRINX_DEADLINE_MS) return false;
    return this.#activate('cyrinx_deadline_expired', now);
  }

  forceDeadlineExpiry(nowMs: number): boolean {
    if (
      this.#startedAtMs === null
      || this.terminal
      || this.#codec !== 'cyrinx'
    ) return false;
    return this.#activate('cyrinx_deadline_expired', checkedNow(nowMs));
  }

  activateFallback(reason: CyrinxFallbackReason, nowMs: number): boolean {
    if (!CYRINX_FALLBACK_REASONS.includes(reason)) reject('qualification_fallback_reason_invalid');
    if (
      this.#startedAtMs === null
      || this.terminal
      || this.#codec !== 'cyrinx'
      || this.#fallbackReason !== null
    ) return false;
    const now = checkedNow(nowMs);
    const elapsed = this.#elapsed(now);
    if (
      this.#deadlineAtMs !== null
      && (now >= this.#deadlineAtMs || elapsed >= CYRINX_DEADLINE_MS)
    ) {
      return this.#activate('cyrinx_deadline_expired', now);
    }
    return this.#activate(reason, now);
  }

  failCurrent(nowMs: number): boolean {
    return this.activateFallback(failureReasonForStage(this.#stage), nowMs);
  }

  markQuietFailed(): boolean {
    if (this.#stage !== 'quiet' || this.#fallbackState !== 'activated') return false;
    this.#codec = 'unqualified';
    this.#stage = 'unqualified';
    this.#fallbackState = 'failed';
    return true;
  }

  snapshot(epoch: number, nowMs: number): CyrinxSessionSnapshot {
    if (!Number.isSafeInteger(epoch) || epoch < 0) reject('qualification_epoch_invalid');
    const elapsedMs = this.#startedAtMs === null
      ? null
      : this.#terminalElapsedMs ?? this.#elapsed(nowMs);
    const value = this.currentCase();
    return {
      kind: 'cyrinx-session',
      epoch,
      codec: this.#codec,
      stage: this.#stage,
      deadline: {
        startedAtMs: this.#startedAtMs,
        deadlineAtMs: this.#deadlineAtMs,
        elapsedMs,
      },
      fallback: {
        codecId: 'quiet',
        state: this.#fallbackState,
        reasonCode: this.#fallbackReason,
      },
      instruction: value && !this.terminal && !this.#accepted
        ? {
            action: actionFor(this.role, value.direction),
            caseId: value.id,
            direction: value.direction,
            cold: value.cold,
          }
        : null,
      terminal: this.terminal,
    };
  }

  #assertStage(expected: CyrinxStage): void {
    if (this.#stage !== expected) reject('qualification_stage_order_invalid');
  }

  #assertBeforeDeadline(nowMs: number): void {
    if (this.expire(nowMs)) reject('cyrinx_deadline_expired');
    if (this.terminal || this.#codec !== 'cyrinx') reject('qualification_session_terminal');
  }

  #elapsed(nowMs: number): number {
    const now = checkedNow(nowMs);
    if (this.#startedAtMs === null) reject('qualification_not_started');
    const elapsed = Math.max(0, now - this.#startedAtMs);
    this.#lastElapsedMs = Math.max(this.#lastElapsedMs ?? 0, elapsed);
    return this.#lastElapsedMs;
  }

  #activate(reason: CyrinxFallbackReason, nowMs: number): boolean {
    if (this.#fallbackReason !== null || this.terminal || this.#codec !== 'cyrinx') return false;
    this.#fallbackReason = reason;
    this.#fallbackState = 'activated';
    this.#codec = 'quiet';
    this.#stage = 'quiet';
    this.#accepted = undefined;
    const elapsed = this.#elapsed(nowMs);
    this.#terminalElapsedMs = reason === 'cyrinx_deadline_expired'
      ? Math.max(CYRINX_DEADLINE_MS, elapsed)
      : elapsed;
    return true;
  }
}
