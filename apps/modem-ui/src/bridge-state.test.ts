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
    expect(validateBridgeSnapshot({ ...valid, lastError: 'Error: stack\n at bridge (http://127.0.0.1/?nsec=secret)' })).toBeUndefined();
    expect(validateBridgeSnapshot({ ...valid, lastError: 'Bridge rejected fips_destination_unavailable.' })).toMatchObject({ lastError: 'Bridge rejected fips_destination_unavailable.' });
  });

  it('keeps invalid status data unknown and not-ready rather than fabricating demo facts', () => {
    const state = reduceBridgeState(undefined, { type: 'reset-failed', reason: 'raw FWAV deadbeef?packet=AAAA' });
    expect(state).toMatchObject({
      role: 'Unknown', configuration: 'unknown', browserAudio: 'unknown', localBridge: 'unknown', soundTransport: 'unknown', soundMtu: null,
      status: 'disconnected', lastError: 'Bridge rejected bridge_status_unavailable.',
    });
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

  it('does not allow a raced newer snapshot to leave resetting before the authoritative RESET acknowledgement', () => {
    const ready = reduceBridgeState(undefined, { type: 'snapshot', snapshot: validateBridgeSnapshot(valid)! });
    const resetting = reduceBridgeState(ready, { type: 'reset-start' });
    const raced = reduceBridgeState(resetting, { type: 'snapshot', snapshot: validateBridgeSnapshot({ ...valid, epoch: 5, browserAudio: 'armed', localBridge: 'ready' })! });
    expect(raced).toEqual(resetting);
    expect(reduceBridgeState(raced, { type: 'reset-ack', epoch: 5 })).toMatchObject({ status: 'idle', epoch: 5 });
  });

  it('retains a bounded safe failure and remains retryable after reset timeout', () => {
    const resetting = reduceBridgeState(undefined, { type: 'reset-start' });
    const failed = reduceBridgeState(resetting, { type: 'reset-failed', reason: 'x'.repeat(300) });
    expect(failed.status).toBe('disconnected');
    expect(failed.lastError).toBe('Bridge rejected bridge_status_unavailable.');
    expect(reduceBridgeState(failed, { type: 'reset-start' }).status).toBe('resetting');
  });
});
