import { describe, expect, it } from 'vitest';

import { CyrinxQualificationSession } from './qualification-session.js';

describe('Cyrinx early-abandonment session', () => {
  it('starts one immutable deadline before build and transitions to Quiet on the first failed ordered stage', () => {
    const session = new CyrinxQualificationSession(() => 100);
    expect(session.start()).toMatchObject({ codec: 'cyrinx', stage: 'build', startedAtMs: 100, deadlineAtMs: 5_400_100 });
    expect(() => session.pass('cold-a-to-b')).toThrow('stage');
    expect(session.fail('cyrinx_build_failed', 101)).toMatchObject({ codec: 'quiet', stage: 'quiet', reasonCode: 'cyrinx_build_failed', deadlineAtMs: 5_400_100 });
    expect(session.start()).toMatchObject({ codec: 'quiet', reasonCode: 'cyrinx_build_failed' });
    expect(session.failQuiet()).toMatchObject({ codec: 'unqualified', reasonCode: 'cyrinx_build_failed' });
  });

  it('expires at equality and requires the two cold directions before corpus', () => {
    const session = new CyrinxQualificationSession(() => 0); session.start();
    expect(session.pass('build', 1).stage).toBe('digital');
    expect(session.pass('digital', 2).stage).toBe('cold-a-to-b');
    expect(session.pass('cold-a-to-b', 3).stage).toBe('cold-b-to-a');
    expect(session.pass('cold-b-to-a', 4).stage).toBe('corpus');
    expect(session.expire(5_400_000)).toMatchObject({ codec: 'quiet', reasonCode: 'cyrinx_deadline_expired' });
  });
});
