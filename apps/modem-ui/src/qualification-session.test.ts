import { describe, expect, it } from 'vitest';
import { CyrinxQualificationSession, type CyrinxSessionSnapshot } from './qualification-session.js';

const primary = (stage: CyrinxSessionSnapshot['stage'] = 'build'): CyrinxSessionSnapshot => ({ codec: 'cyrinx', stage, startedAtMs: 100, deadlineAtMs: 5_400_100, elapsedMs: 0 });
const fallback = (codec: 'quiet' | 'unqualified' = 'quiet'): CyrinxSessionSnapshot => ({ codec, stage: codec === 'quiet' ? 'quiet' : 'unqualified', startedAtMs: 100, deadlineAtMs: 5_400_100, elapsedMs: 20, reasonCode: 'cyrinx_cold_a_to_b_failed' });

describe('runner-owned Cyrinx session display', () => {
  it('accepts only an authoritative immutable deadline and starts Quiet once', () => {
    const session = new CyrinxQualificationSession();
    expect(session.canRequestStart).toBe(true);
    session.apply(primary());
    session.apply(fallback());
    expect(session.shouldStartQuiet).toBe(true);
    session.markQuietStarted();
    expect(session.shouldStartQuiet).toBe(false);
    expect(() => session.apply(primary('cold-b-to-a'))).toThrow('retry');
  });

  it('rejects async-loss, deadline mutation, bad reason, and post-reset restart attempts', () => {
    const session = new CyrinxQualificationSession(); session.apply(primary());
    expect(() => session.apply({ ...primary(), deadlineAtMs: 5_400_101 })).toThrow('deadline');
    expect(() => session.apply({ ...fallback(), reasonCode: 'operator_override' as never })).toThrow('reason');
    session.apply(fallback()); session.markQuietStarted(); session.markQuietFailed();
    expect(session.snapshot).toMatchObject({ codec: 'unqualified', reasonCode: 'cyrinx_cold_a_to_b_failed' });
    expect(() => session.apply(primary())).toThrow('retry');
  });

  it('keeps the first runner fallback through timeout, reset/re-arm, and late messages', () => {
    const session = new CyrinxQualificationSession();
    session.apply(primary('cold-a-to-b'));
    session.apply({
      ...fallback(),
      reasonCode: 'cyrinx_deadline_expired',
      elapsedMs: 5_400_000,
    });
    session.markQuietStarted();

    // A local RESET/re-arm is not authority to make another Cyrinx attempt.
    expect(session.canRequestStart).toBe(false);
    expect(session.shouldStartQuiet).toBe(false);

    // Delayed old-stage and competing-reason messages must fail closed.
    expect(() => session.apply(primary('corpus'))).toThrow('retry');
    expect(() => session.apply({
      ...fallback('unqualified'),
      reasonCode: 'cyrinx_corpus_failed',
      elapsedMs: 5_400_000,
    })).toThrow('first failure reason');

    session.markQuietFailed();
    expect(session.snapshot).toMatchObject({
      codec: 'unqualified',
      stage: 'unqualified',
      reasonCode: 'cyrinx_deadline_expired',
      deadlineAtMs: 5_400_100,
    });
  });
});
