import { describe, expect, it } from 'vitest';

import manifest from '../../../fixtures/corpus/manifest.json' with { type: 'json' };
import {
  CyrinxQualificationSession,
  QualificationSessionError,
  failureReasonForStage,
} from '../src/qualification-session.js';
import { CYRINX_DEADLINE_MS } from '../src/report.js';

const startAt = 10_000;

function reachCases(role: 'A' | 'B' = 'A'): CyrinxQualificationSession {
  const session = new CyrinxQualificationSession(role);
  expect(session.start(startAt)).toBe(true);
  session.completeBuild(startAt + 1);
  session.completeDigital(startAt + 2);
  return session;
}

describe('runner-owned Cyrinx qualification session', () => {
  it('stamps one immutable 90 minute deadline and never restarts it', () => {
    const session = new CyrinxQualificationSession('A');
    expect(session.snapshot(7, startAt)).toMatchObject({
      codec: 'idle',
      stage: 'idle',
      deadline: { startedAtMs: null, deadlineAtMs: null, elapsedMs: null },
      fallback: { codecId: 'quiet', state: 'available', reasonCode: null },
      terminal: false,
    });

    expect(session.start(startAt)).toBe(true);
    expect(session.snapshot(7, startAt)).toMatchObject({
      codec: 'cyrinx',
      stage: 'build',
      deadline: {
        startedAtMs: startAt,
        deadlineAtMs: startAt + CYRINX_DEADLINE_MS,
        elapsedMs: 0,
      },
    });
    expect(session.start(startAt + 2_000)).toBe(false);
    expect(session.snapshot(7, startAt + 2_000).deadline).toEqual({
      startedAtMs: startAt,
      deadlineAtMs: startAt + CYRINX_DEADLINE_MS,
      elapsedMs: 2_000,
    });
  });

  it('enforces build, digital, cold A-to-B, cold B-to-A, then exact committed corpus order', () => {
    const session = new CyrinxQualificationSession('A');
    session.start(startAt);
    expect(() => session.completeDigital(startAt + 1)).toThrow(QualificationSessionError);
    session.completeBuild(startAt + 1);
    expect(session.snapshot(1, startAt + 1).stage).toBe('digital');
    session.completeDigital(startAt + 2);

    const seen: Array<{ caseId: string; direction: string; cold: boolean }> = [];
    for (;;) {
      const snapshot = session.snapshot(1, startAt + 3);
      if (!snapshot.instruction) break;
      seen.push({
        caseId: snapshot.instruction.caseId,
        direction: snapshot.instruction.direction,
        cold: snapshot.instruction.cold,
      });
      const accepted = session.acceptInstruction(
        snapshot.instruction.caseId,
        snapshot.instruction.direction,
        startAt + 3,
      );
      session.completeAccepted(accepted.mode, startAt + 4);
    }

    expect(seen.slice(0, 2)).toEqual([
      { caseId: 'cyrinx-cold-a-to-b', direction: 'A → B', cold: true },
      { caseId: 'cyrinx-cold-b-to-a', direction: 'B → A', cold: true },
    ]);
    expect(seen.slice(2)).toEqual(
      (manifest.cases as Array<{ id: string; direction: string }>).map((entry) => ({
        caseId: entry.id,
        direction: entry.direction,
        cold: false,
      })),
    );
    expect(session.snapshot(1, startAt + 5)).toMatchObject({
      codec: 'cyrinx',
      stage: 'complete',
      instruction: null,
      terminal: true,
    });
  });

  it('derives transmit/listen solely from the runner role and rejects self-mic input', () => {
    const roleA = reachCases('A');
    const roleB = reachCases('B');
    const instructionA = roleA.snapshot(1, startAt + 3).instruction!;
    const instructionB = roleB.snapshot(1, startAt + 3).instruction!;

    expect(instructionA).toMatchObject({ direction: 'A → B', action: 'transmit' });
    expect(instructionB).toMatchObject({ direction: 'A → B', action: 'listen' });
    expect(roleA.canReceiveCapture()).toBe(false);
    expect(roleB.canReceiveCapture()).toBe(false);

    roleA.acceptInstruction(instructionA.caseId, instructionA.direction, startAt + 3);
    roleB.acceptInstruction(instructionB.caseId, instructionB.direction, startAt + 3);
    expect(roleA.canReceiveCapture()).toBe(false);
    expect(roleB.canReceiveCapture()).toBe(true);
    expect(() => roleA.completeAccepted('listen', startAt + 4)).toThrow(
      'qualification_instruction_mode_mismatch',
    );

    roleA.completeAccepted('transmit', startAt + 4);
    const reverseA = roleA.snapshot(1, startAt + 4).instruction!;
    expect(reverseA).toMatchObject({ direction: 'B → A', action: 'listen' });
  });

  it('expires at equality, freezes terminal timing, and preserves the first allowlisted cause', () => {
    const session = new CyrinxQualificationSession('A');
    session.start(startAt);
    expect(session.expire(startAt + CYRINX_DEADLINE_MS - 1)).toBe(false);
    expect(session.expire(startAt + CYRINX_DEADLINE_MS)).toBe(true);
    expect(session.activateFallback('cyrinx_build_failed', startAt + CYRINX_DEADLINE_MS + 1)).toBe(false);
    expect(session.snapshot(1, startAt + CYRINX_DEADLINE_MS + 50_000)).toMatchObject({
      codec: 'quiet',
      stage: 'quiet',
      deadline: { elapsedMs: CYRINX_DEADLINE_MS },
      fallback: {
        codecId: 'quiet',
        state: 'activated',
        reasonCode: 'cyrinx_deadline_expired',
      },
      terminal: true,
    });
  });

  it('maps every authoritative stage to a stable fallback reason and makes Quiet failure terminal', () => {
    expect(failureReasonForStage('build')).toBe('cyrinx_build_failed');
    expect(failureReasonForStage('digital')).toBe('cyrinx_digital_roundtrip_failed');
    expect(failureReasonForStage('cold-a-to-b')).toBe('cyrinx_cold_a_to_b_failed');
    expect(failureReasonForStage('cold-b-to-a')).toBe('cyrinx_cold_b_to_a_failed');
    expect(failureReasonForStage('corpus')).toBe('cyrinx_corpus_failed');

    const session = reachCases();
    expect(session.failCurrent(startAt + 50)).toBe(true);
    expect(session.markQuietFailed()).toBe(true);
    expect(session.snapshot(1, startAt + 5_000)).toMatchObject({
      codec: 'unqualified',
      stage: 'unqualified',
      fallback: {
        state: 'failed',
        reasonCode: 'cyrinx_cold_a_to_b_failed',
      },
      terminal: true,
    });
  });

  it('reset aborts only the active case, preserves timing and terminal state, and ignores late results', () => {
    const active = reachCases('B');
    const before = active.snapshot(1, startAt + 20);
    const accepted = active.acceptInstruction(
      before.instruction!.caseId,
      before.instruction!.direction,
      startAt + 20,
    );
    expect(accepted.mode).toBe('listen');
    expect(active.canReceiveCapture()).toBe(true);
    active.abortCase();
    expect(active.canReceiveCapture()).toBe(false);
    expect(active.snapshot(2, startAt + 30)).toMatchObject({
      stage: 'cold-a-to-b',
      deadline: {
        startedAtMs: startAt,
        deadlineAtMs: startAt + CYRINX_DEADLINE_MS,
        elapsedMs: 30,
      },
      terminal: false,
    });
    expect(() => active.completeAccepted('listen', startAt + 31)).toThrow(
      'qualification_instruction_not_accepted',
    );

    active.failCurrent(startAt + 40);
    const terminal = active.snapshot(2, startAt + 50);
    active.abortCase();
    expect(active.snapshot(3, startAt + 500_000)).toEqual({ ...terminal, epoch: 3 });
    expect(() => active.completeAccepted('listen', startAt + 500_001)).toThrow(
      'qualification_instruction_not_accepted',
    );
  });

  it('marks the local cold receive gate only after a successful listen probe', () => {
    const roleA = reachCases('A');
    const outbound = roleA.snapshot(1, startAt + 3).instruction!;
    roleA.acceptInstruction(outbound.caseId, outbound.direction, startAt + 3);
    roleA.completeAccepted('transmit', startAt + 4);
    expect(roleA.coldReceivePassed).toBe(false);

    const inbound = roleA.snapshot(1, startAt + 5).instruction!;
    roleA.acceptInstruction(inbound.caseId, inbound.direction, startAt + 5);
    roleA.completeAccepted('listen', startAt + 6);
    expect(roleA.coldReceivePassed).toBe(true);
  });
});
