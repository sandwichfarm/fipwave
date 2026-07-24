import { describe, expect, it } from 'vitest';

import { reduceProofState } from '../src/proof.js';

describe('sound proof state', () => {
  it('clears an old ping result before exposing disarm/reconnect', () => {
    const ready = reduceProofState(undefined, { type: 'snapshot', epoch: 4, pingReady: true, reason: 'ready' });
    const degraded = reduceProofState(ready, { type: 'invalidate', epoch: 5, reason: 'acoustic_disarmed' });
    expect(degraded).toMatchObject({ state: 'degraded', epoch: 5, pingReady: false, result: null, reason: 'acoustic_disarmed' });
  });
});
