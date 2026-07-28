import { describe, expect, it, vi } from 'vitest';

import type { FipsControlClient } from '../src/fips-control-client.js';
import { reconcileFipsPeer } from '../src/fips-peer-reconciler.js';

const peer = Object.freeze({
  npub: 'npub1f49ke5fkzqev4x7j46uajq92f4zan6kcpty5yvm5c3g6wf2dqanqn7qsy2',
  address: 'sound-b',
  transport: 'sound',
} as const);

function controlWith(
  peers: readonly Record<string, unknown>[],
  links: readonly Record<string, unknown>[] = [],
): Pick<FipsControlClient, 'query' | 'connectPeer'> {
  return {
    query: vi.fn(async (kind) => (
      kind === 'peers'
        ? { peers }
        : kind === 'links'
          ? { links }
          : { transports: [{ transport_id: 3, type: 'sound', state: 'up', mtu: 1_357, stats: {} }] }
    ) as never),
    connectPeer: vi.fn(async (request) => request),
  };
}

describe('FIPS peer reconciler', () => {
  it('does not inspect or mutate FIPS before acoustic readiness', async () => {
    const control = controlWith([]);
    await expect(reconcileFipsPeer({ control, peer, acousticReady: () => false })).resolves.toBe('waiting_for_acoustic');
    expect(control.query).not.toHaveBeenCalled();
    expect(control.connectPeer).not.toHaveBeenCalled();
  });

  it('initiates the fixed sound peer once acoustic readiness exists', async () => {
    const control = controlWith([]);
    await expect(reconcileFipsPeer({ control, peer, acousticReady: () => true })).resolves.toBe('connect_initiated');
    expect(control.query).toHaveBeenCalledWith('peers');
    expect(control.connectPeer).toHaveBeenCalledWith(peer);
  });

  it('leaves an authenticated sound peer untouched', async () => {
    const control = controlWith([{
      npub: peer.npub,
      connectivity: 'connected',
      link_id: 1,
      transport_type: 'sound',
      authenticated_at_ms: 1,
      last_seen_ms: 1,
    }]);
    await expect(reconcileFipsPeer({ control, peer, acousticReady: () => true })).resolves.toBe('connected');
    expect(control.connectPeer).not.toHaveBeenCalled();
  });

  it('does not stack another handshake on an in-progress sound link', async () => {
    const control = controlWith([], [{
      link_id: 7,
      transport_id: 3,
      state: 'connected',
      created_at_ms: 1,
      stats: {},
    }]);
    await expect(reconcileFipsPeer({ control, peer, acousticReady: () => true })).resolves.toBe('connecting');
    expect(control.connectPeer).not.toHaveBeenCalled();
  });
});
