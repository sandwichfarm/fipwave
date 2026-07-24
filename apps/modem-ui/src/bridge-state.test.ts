import { describe, expect, it } from 'vitest';

import { reduceBridgeState, validateBridgeSnapshot } from './bridge-state.js';

const valid = {
  role: 'A', configuration: 'ready', browserAudio: 'armed', localBridge: 'ready', soundTransport: 'waiting', epoch: 4,
  queueHealth: 'clear', queueItems: 0, queueBytes: 0, txPackets: 0, rxPackets: 0, soundMtu: 1357, lastEventAt: '2026-07-24T01:00:00.000Z', lastError: null,
};

describe('bridge state validation', () => {
  it('accepts complete safe local facts and rejects partial, secret-bearing, and invalid MTU snapshots', () => {
    expect(validateBridgeSnapshot(valid)).toMatchObject({ epoch: 4, soundMtu: 1357 });
    expect(validateBridgeSnapshot({ ...valid, role: undefined })).toBeUndefined();
    expect(validateBridgeSnapshot({ ...valid, soundMtu: 1356 })).toBeUndefined();
    expect(validateBridgeSnapshot({ ...valid, lastError: 'nsec1private' })).toBeUndefined();
    expect(validateBridgeSnapshot({ ...valid, extra: 'raw-frame' })).toBeUndefined();
  });

  it('requires authoritative reset acknowledgement before clearing volatile state and rejects stale completions', () => {
    const ready = reduceBridgeState(undefined, { type: 'snapshot', snapshot: validateBridgeSnapshot({ ...valid, txPackets: 2, rxPackets: 1 })! });
    const resetting = reduceBridgeState(ready, { type: 'reset-start' });
    expect(resetting.status).toBe('resetting');
    expect(resetting.txPackets).toBe(2);
    const stale = reduceBridgeState(resetting, { type: 'reset-ack', epoch: 4 });
    expect(stale).toEqual(resetting);
    const recovered = reduceBridgeState(resetting, { type: 'reset-ack', epoch: 5 });
    expect(recovered).toMatchObject({ status: 'idle', epoch: 5, txPackets: 0, rxPackets: 0, queueItems: 0, lastError: null });
  });

  it('retains a bounded safe failure and remains retryable after reset timeout', () => {
    const resetting = reduceBridgeState(undefined, { type: 'reset-start' });
    const failed = reduceBridgeState(resetting, { type: 'reset-failed', reason: 'x'.repeat(300) });
    expect(failed.status).toBe('disconnected');
    expect(failed.lastError).toHaveLength(240);
    expect(reduceBridgeState(failed, { type: 'reset-start' }).status).toBe('resetting');
  });
});
