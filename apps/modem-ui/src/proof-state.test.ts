import { describe, expect, it } from 'vitest';
import { parseProofSnapshot, reduceProofState } from './proof-state.js';

const ready = (overrides: Record<string, unknown> = {}) => ({ pingReady: true, reason: 'ready', evidenceClass: 'Fixture', join: { pingReady: true, reason: 'ready', peer: { npub: 'npub1demopeer', connectivity: 'connected', link_id: 7, transport_type: 'sound', authenticated_at_ms: 1, last_seen_ms: 1 }, link: { link_id: 7, transport_id: 3, state: 'active', created_at_ms: 1, stats: {} }, transport: { transport_id: 3, type: 'sound', state: 'active', mtu: 1357, stats: { worker_up: true, acoustic_ready: true, epoch: 4, complete_tx: 2 } } }, ...overrides });

describe('proof state', () => {
  it('accepts only the bounded ProofExecution projection and keeps unavailable counters honest', () => {
    const parsed = parseProofSnapshot(ready());
    expect(parsed?.snapshot?.counters.completeTx).toBe(2);
    expect(parsed?.snapshot?.counters.retries).toBeNull();
    expect(parseProofSnapshot({ ...ready(), raw: 'secret' })).toBeUndefined();
  });
  it('accepts safe millisecond timestamps without weakening counter bounds', () => {
    const value = ready({ join: { ...ready().join, peer: { ...ready().join.peer, authenticated_at_ms: 1_725_000_000_000, last_seen_ms: 1_725_000_000_001 }, link: { ...ready().join.link, created_at_ms: 1_725_000_000_000 } } });
    expect(parseProofSnapshot(value)?.snapshot?.peer.verified).toBe(true);
  });
  it('blocks local-looking states without a current authenticated Sound peer', () => {
    const state = reduceProofState(undefined, { type: 'snapshot', source: 'refresh', value: ready({ pingReady: false, reason: 'peer_missing', evidenceClass: 'human_needed', join: { pingReady: false, reason: 'peer_missing' } }) });
    expect(state.mode).toBe('human-needed');
    expect(state.snapshot?.pingReady).toBe(false);
  });
  it('treats fixture replies as nonphysical and requires a fresh refresh before another ping', () => {
    const state = reduceProofState(undefined, { type: 'snapshot', source: 'ping', value: ready({ result: { exitCode: 0, sequence: 1, latencyMs: 2.4, lossPercent: 0, safeReason: null } }) });
    expect(state.mode).toBe('nonphysical');
    expect(state.needsRefresh).toBe(true);
  });
  it('clears a previous result when the proof epoch changes', () => {
    const first = reduceProofState(undefined, { type: 'snapshot', source: 'ping', value: ready({ result: { exitCode: 0, sequence: 1, latencyMs: 2.4, lossPercent: 0, safeReason: null } }) });
    const next = reduceProofState(first, { type: 'snapshot', source: 'refresh', value: ready({ join: { ...ready().join, transport: { ...ready().join.transport, stats: { worker_up: true, acoustic_ready: true, epoch: 5 } } } }) });
    expect(next.outcome).toBeUndefined();
    expect(next.mode).toBe('blocked');
  });
});
